#include "GC_and_WL_Unit_Base.h"
#include "../exec/Simulation_Events.h"
#include "../sim/Engine.h"

namespace SSD_Components
{
	GC_and_WL_Unit_Base* GC_and_WL_Unit_Base::_my_instance;
	
	GC_and_WL_Unit_Base::GC_and_WL_Unit_Base(const sim_object_id_type& id,
		Address_Mapping_Unit_Base* address_mapping_unit, Flash_Block_Manager_Base* block_manager, TSU_Base* tsu, NVM_PHY_ONFI* flash_controller,
		GC_Block_Selection_Policy_Type block_selection_policy, double gc_threshold, bool preemptible_gc_enabled, double gc_hard_threshold,
		unsigned int channel_count, unsigned int chip_no_per_channel, unsigned int die_no_per_chip, unsigned int plane_no_per_die,
		unsigned int block_no_per_plane, unsigned int page_no_per_block, unsigned int sector_no_per_page, 
		bool use_copyback, double rho, unsigned int max_ongoing_gc_reqs_per_plane, bool dynamic_wearleveling_enabled, bool static_wearleveling_enabled, unsigned int static_wearleveling_threshold, int seed) :
		Sim_Object(id), address_mapping_unit(address_mapping_unit), block_manager(block_manager), tsu(tsu), flash_controller(flash_controller), force_gc(false),
		block_selection_policy(block_selection_policy), gc_threshold(gc_threshold),	use_copyback(use_copyback), 
		preemptible_gc_enabled(preemptible_gc_enabled), gc_hard_threshold(gc_hard_threshold),
		random_generator(seed), max_ongoing_gc_reqs_per_plane(max_ongoing_gc_reqs_per_plane),
		channel_count(channel_count), chip_no_per_channel(chip_no_per_channel), die_no_per_chip(die_no_per_chip), plane_no_per_die(plane_no_per_die),
		block_no_per_plane(block_no_per_plane), pages_no_per_block(page_no_per_block), sector_no_per_page(sector_no_per_page),
		dynamic_wearleveling_enabled(dynamic_wearleveling_enabled), static_wearleveling_enabled(static_wearleveling_enabled), static_wearleveling_threshold(static_wearleveling_threshold)
	{
		_my_instance = this;
		block_pool_gc_threshold = (unsigned int)(gc_threshold * (double)block_no_per_plane);
		if (block_pool_gc_threshold < 1) {
			block_pool_gc_threshold = 1;
		}
		block_pool_gc_hard_threshold = (unsigned int)(gc_hard_threshold * (double)block_no_per_plane);
		if (block_pool_gc_hard_threshold < 1) {
			block_pool_gc_hard_threshold = 1;
		}
		random_pp_threshold = (unsigned int)(rho * pages_no_per_block);
		if (block_pool_gc_threshold < max_ongoing_gc_reqs_per_plane) {
			block_pool_gc_threshold = max_ongoing_gc_reqs_per_plane;
		}
	}

	void GC_and_WL_Unit_Base::Setup_triggers()
	{
		Sim_Object::Setup_triggers();
		flash_controller->ConnectToTransactionServicedSignal(handle_transaction_serviced_signal_from_PHY);
	}

	void GC_and_WL_Unit_Base::handle_transaction_serviced_signal_from_PHY(NVM_Transaction_Flash* transaction)
	{
		PlaneBookKeepingType* pbke = &(_my_instance->block_manager->plane_manager[transaction->Address.ChannelID][transaction->Address.ChipID][transaction->Address.DieID][transaction->Address.PlaneID]);

		switch (transaction->Source) {
			case Transaction_Source_Type::USERIO:
			case Transaction_Source_Type::MAPPING:
			case Transaction_Source_Type::CACHE:
				// BUG FIX (this project): a user transaction released from a
				// GC/WL LPA barrier (Address_Mapping_Unit_Page_Level::Remove_
				// barrier_for_accessing_lpa()) is signaled serviced without
				// ever having been translated - its Address is still the
				// default (block 0 of plane 0/0/0/0) and no *_transaction_
				// issued() was ever counted for it, so "un-counting" it here
				// drove that block's Ongoing_user_program_count negative.
				if (!transaction->Physical_address_determined) {
					return;
				}
				switch (transaction->Type)
				{
					case Transaction_Type::READ:
						_my_instance->block_manager->Read_transaction_serviced(transaction->Address);
						break;
					case Transaction_Type::WRITE:
						_my_instance->block_manager->Program_transaction_serviced(transaction->Address);
						break;
					default:
						PRINT_ERROR("Unexpected situation in the GC_and_WL_Unit_Base function!")
				}
				if (_my_instance->block_manager->Block_has_ongoing_gc_wl(transaction->Address)) {
					if (_my_instance->block_manager->Can_execute_gc_wl(transaction->Address)) {
						// Deferred rather than executed here directly - this
						// runs as a side effect of transaction's own
						// completion (an unrelated read/write), so doing it
						// in-line would bunch that transaction's own
						// notification with this block's GC/WL start into
						// one event-group/UI step - see EXECUTE_PARKED_GC_WL's
						// doc comment in GC_and_WL_Unit_Base.h.
						Simulator->Register_sim_event(Simulator->Time() + 1, _my_instance,
							new Execute_Parked_Gc_Wl_Params{ transaction->Address }, (int)GC_Deferred_Event_Type::EXECUTE_PARKED_GC_WL);
					}
				}

				return;
		}

		switch (transaction->Type) {
			case Transaction_Type::READ:
			{
				PPA_type ppa;
				MPPN_type mppa;
				page_status_type page_status_bitmap;
				// Fired here, not when GC first decided to migrate this page: this is
				// the migration read actually completing, which - unlike the eager
				// decision-time loop this replaced - gives each page's notification
				// its own real simulated completion time, spread across separate
				// simulator event-groups instead of bunched into one. transaction's
				// own Address is still the *source* page (a read's address never
				// gets reallocated, unlike RelatedWrite's) - fired *after*
				// Allocate_new_page_for_gc() below, since that's the one call that
				// determines RelatedWrite's destination address (it mutates
				// RelatedWrite->Address in place via Allocate_block_and_page_in_
				// plane_for_gc_write) - both addresses are only known together at
				// that point, and only within this same synchronous handler (no
				// separate event/simulated delay in between).
				bool is_wl = pbke->Blocks[transaction->Address.BlockID].Is_wl_triggered;
				if (pbke->Blocks[transaction->Address.BlockID].Holds_mapping_data) {
					_my_instance->address_mapping_unit->Get_translation_mapping_info_for_gc(transaction->Stream_id, (MVPN_type)transaction->LPA, mppa, page_status_bitmap);
					//There has been no write on the page since GC start, and it is still valid
					if (mppa == transaction->PPA) {
						_my_instance->tsu->Prepare_for_transaction_submit();
						((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->write_sectors_bitmap = FULL_PROGRAMMED_PAGE;
						((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->LPA = transaction->LPA;
						((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->RelatedRead = NULL;
						_my_instance->address_mapping_unit->Allocate_new_page_for_gc(((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite, pbke->Blocks[transaction->Address.BlockID].Holds_mapping_data);
						if (is_wl) {
							Simulation_Events::Notify_wl_page_migrated(transaction->Stream_id, transaction->LPA, transaction->Address, ((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->Address);
						} else {
							Simulation_Events::Notify_gc_page_migrated(transaction->Stream_id, transaction->LPA, transaction->Address, ((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->Address);
						}
						_my_instance->tsu->Submit_transaction(((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite);
						_my_instance->tsu->Schedule();
					} else {
						PRINT_ERROR("Inconsistency found when moving a page for GC/WL!")
					}
				} else {
					_my_instance->address_mapping_unit->Get_data_mapping_info_for_gc(transaction->Stream_id, transaction->LPA, ppa, page_status_bitmap);

					//There has been no write on the page since GC start, and it is still valid
					if (ppa == transaction->PPA) {
						_my_instance->tsu->Prepare_for_transaction_submit();
						((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->write_sectors_bitmap = page_status_bitmap;
						((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->LPA = transaction->LPA;
						((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->RelatedRead = NULL;
						_my_instance->address_mapping_unit->Allocate_new_page_for_gc(((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite, pbke->Blocks[transaction->Address.BlockID].Holds_mapping_data);
						if (is_wl) {
							Simulation_Events::Notify_wl_page_migrated(transaction->Stream_id, transaction->LPA, transaction->Address, ((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->Address);
						} else {
							Simulation_Events::Notify_gc_page_migrated(transaction->Stream_id, transaction->LPA, transaction->Address, ((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite->Address);
						}
						_my_instance->tsu->Submit_transaction(((NVM_Transaction_Flash_RD*)transaction)->RelatedWrite);
						_my_instance->tsu->Schedule();
					} else {
						PRINT_ERROR("Inconsistency found when moving a page for GC/WL!")
					}
				}
				break;
			}
			case Transaction_Type::WRITE:
				if (pbke->Blocks[((NVM_Transaction_Flash_WR*)transaction)->RelatedErase->Address.BlockID].Holds_mapping_data) {
					_my_instance->address_mapping_unit->Remove_barrier_for_accessing_mvpn(transaction->Stream_id, (MVPN_type)transaction->LPA);
					DEBUG(Simulator->Time() << ": MVPN=" << (MVPN_type)transaction->LPA << " unlocked!!");
				} else {
					_my_instance->address_mapping_unit->Remove_barrier_for_accessing_lpa(transaction->Stream_id, transaction->LPA);
					DEBUG(Simulator->Time() << ": LPA=" << (MVPN_type)transaction->LPA << " unlocked!!");
				}
				pbke->Blocks[((NVM_Transaction_Flash_WR*)transaction)->RelatedErase->Address.BlockID].Erase_transaction->Page_movement_activities.remove((NVM_Transaction_Flash_WR*)transaction);
				// BUG FIX (this project, upstream MQSim): pairs with the
				// program_transaction_issued() call added in Allocate_block_and_
				// page_in_plane_for_gc_write() (Flash_Block_Manager.cpp) - without
				// this, Ongoing_user_program_count would only ever increment for
				// GC migration writes and never decrement, permanently blocking
				// any block that ever received one from future GC candidacy.
				_my_instance->block_manager->Program_transaction_serviced(transaction->Address);
				break;
			case Transaction_Type::ERASE:
				if (pbke->Blocks[transaction->Address.BlockID].Is_wl_triggered) {
					Simulation_Events::Notify_wl_block_erased(transaction->Address);
				} else {
					Simulation_Events::Notify_gc_block_erased(transaction->Address);
				}
				pbke->Ongoing_erase_operations.erase(pbke->Ongoing_erase_operations.find(transaction->Address.BlockID));
				_my_instance->block_manager->Add_erased_block_to_pool(transaction->Address);
				_my_instance->block_manager->GC_WL_finished(transaction->Address);
				if (_my_instance->check_static_wl_required(transaction->Address)) {
					Simulator->Register_sim_event(Simulator->Time() + 1, _my_instance,
						new Run_Static_Wl_Params{ transaction->Address }, (int)GC_Deferred_Event_Type::RUN_STATIC_WEARLEVELING);
				}
				_my_instance->address_mapping_unit->Start_servicing_writes_for_overfull_plane(transaction->Address);//Must be inovked after above statements since it may lead to flash page consumption for waiting program transactions

				if (_my_instance->Stop_servicing_writes(transaction->Address)) {
					Simulator->Register_sim_event(Simulator->Time() + 1, _my_instance,
						new Check_Gc_Required_Params{ pbke->Get_free_block_pool_size(), transaction->Address }, (int)GC_Deferred_Event_Type::CHECK_GC_REQUIRED);
				}
				break;
			} //switch (transaction->Type)
	}

	// Extracted verbatim from handle_transaction_serviced_signal_from_PHY's
	// own top section (see EXECUTE_PARKED_GC_WL's doc comment in
	// GC_and_WL_Unit_Base.h) - re-derives everything from block_address
	// instead of the transaction whose completion originally triggered this,
	// since by the time this deferred event fires that transaction is long
	// gone.
	void GC_and_WL_Unit_Base::execute_parked_gc_wl_if_ready(const NVM::FlashMemory::Physical_Page_Address& block_address)
	{
		PlaneBookKeepingType* pbke = &(block_manager->plane_manager[block_address.ChannelID][block_address.ChipID][block_address.DieID][block_address.PlaneID]);
		if (!block_manager->Block_has_ongoing_gc_wl(block_address) || !block_manager->Can_execute_gc_wl(block_address)) {
			return;
		}
		NVM::FlashMemory::Physical_Page_Address gc_wl_candidate_address(block_address);
		Block_Pool_Slot_Type* block = &pbke->Blocks[block_address.BlockID];
		bool is_wl = block->Is_wl_triggered;
		// BUG FIX (this project, upstream MQSim): upstream counted a parked
		// static-WL execution resuming here as a GC execution.
		if (is_wl) {
			Stats::Total_wl_executions++;
		} else {
			Stats::Total_gc_executions++;
		}
		if (is_wl) {
			// The target itself is the minimum here (see get_static_wl_erase_
			// info()) - it's already marked Has_ongoing_gc_wl, so it would no
			// longer be picked up as an eligible candidate if recomputed now.
			Flash_Block_Manager_Base::MinMaxEraseInfo erase_info = block_manager->Get_min_max_erase_info(block_address);
			Simulation_Events::Notify_wl_started(block->Stream_id, gc_wl_candidate_address,
				block->Erase_count, erase_info.MaxEraseCount, erase_info.MaxEraseBlockId, static_wearleveling_threshold);
		} else {
			Simulation_Events::Notify_gc_started(block->Stream_id, gc_wl_candidate_address);
		}
		tsu->Prepare_for_transaction_submit();
		NVM_Transaction_Flash_ER* gc_wl_erase_tr = new NVM_Transaction_Flash_ER(Transaction_Source_Type::GC_WL, block->Stream_id, gc_wl_candidate_address);

		//If there are some valid pages in block, then prepare flash transactions for page movement
		if (block->Current_page_write_index - block->Invalid_page_count > 0) {
			NVM_Transaction_Flash_RD* gc_wl_read = NULL;
			NVM_Transaction_Flash_WR* gc_wl_write = NULL;
			for (flash_page_ID_type pageID = 0; pageID < block->Current_page_write_index; pageID++) {
				if (block_manager->Is_page_valid(block, pageID)) {
					if (is_wl) {
						Stats::Total_page_movements_for_wl++;
					} else {
						Stats::Total_page_movements_for_gc++;
					}
					gc_wl_candidate_address.PageID = pageID;
					// Notify_*_page_migrated() fires from this class's own READ
					// completion case above, once each page's migration read has
					// actually finished - see that case's own comment for why.
					if (use_copyback) {
						gc_wl_write = new NVM_Transaction_Flash_WR(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
							NO_LPA, address_mapping_unit->Convert_address_to_ppa(gc_wl_candidate_address), NULL, 0, NULL, 0, INVALID_TIME_STAMP);
						gc_wl_write->ExecutionMode = WriteExecutionModeType::COPYBACK;
						tsu->Submit_transaction(gc_wl_write);
					} else {
						gc_wl_read = new NVM_Transaction_Flash_RD(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
							NO_LPA, address_mapping_unit->Convert_address_to_ppa(gc_wl_candidate_address), gc_wl_candidate_address, NULL, 0, NULL, 0, INVALID_TIME_STAMP);
						gc_wl_write = new NVM_Transaction_Flash_WR(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
							NO_LPA, NO_PPA, gc_wl_candidate_address, NULL, 0, gc_wl_read, 0, INVALID_TIME_STAMP);
						gc_wl_write->ExecutionMode = WriteExecutionModeType::SIMPLE;
						gc_wl_write->RelatedErase = gc_wl_erase_tr;
						gc_wl_read->RelatedWrite = gc_wl_write;
						tsu->Submit_transaction(gc_wl_read);//Only the read transaction would be submitted. The Write transaction is submitted when the read transaction is finished and the LPA of the target page is determined
					}
					gc_wl_erase_tr->Page_movement_activities.push_back(gc_wl_write);
				}
			}
		}
		block->Erase_transaction = gc_wl_erase_tr;
		// BUG FIX (this project, upstream MQSim): upstream never submitted
		// the erase on this parked path (both direct paths - GC_and_WL_Unit_
		// Page_Level::Check_gc_required() and run_static_wearleveling() - do).
		// A GC/WL parked behind an in-flight user read/program therefore never
		// erased its block: the block stayed Has_ongoing_gc_wl forever, the
		// plane lost it for good, and once the free pool ran low the writes
		// parked in Write_transactions_for_overfull_planes were never
		// released - the event queue emptied with requests still outstanding.
		tsu->Submit_transaction(gc_wl_erase_tr);
		tsu->Schedule();
	}

	void GC_and_WL_Unit_Base::Start_simulation()
	{
	}

	void GC_and_WL_Unit_Base::Validate_simulation_config()
	{
	}

	// Dispatches the deferred Check_gc_required()/run_static_wearleveling()
	// calls scheduled by Flash_Block_Manager.cpp and this file's own ERASE-
	// completion case - see the GC_Deferred_Event_Type doc comment in
	// GC_and_WL_Unit_Base.h for why these are deferred events rather than
	// direct calls.
	void GC_and_WL_Unit_Base::Execute_simulator_event(MQSimEngine::Sim_Event* ev)
	{
		switch ((GC_Deferred_Event_Type)ev->Type) {
			case GC_Deferred_Event_Type::CHECK_GC_REQUIRED: {
				Check_Gc_Required_Params* params = (Check_Gc_Required_Params*)ev->Parameters;
				PlaneBookKeepingType* pbke = block_manager->Get_plane_bookkeeping_entry(params->Plane_address);
				size_t ongoing_erases_before = pbke->Ongoing_erase_operations.size();
				Check_gc_required(params->Free_block_pool_size, params->Plane_address);
				if (pbke->Ongoing_erase_operations.size() == ongoing_erases_before && params->Retry_count < GC_MAX_RETRIES
					&& gc_retry_needed(params->Plane_address)) {
					Simulator->Register_sim_event(Simulator->Time() + GC_RETRY_DELAY, this,
						new Check_Gc_Required_Params{ pbke->Get_free_block_pool_size(), params->Plane_address, params->Retry_count + 1 }, (int)GC_Deferred_Event_Type::CHECK_GC_REQUIRED);
				}
				delete params;
				break;
			}
			case GC_Deferred_Event_Type::RUN_STATIC_WEARLEVELING: {
				Run_Static_Wl_Params* params = (Run_Static_Wl_Params*)ev->Parameters;
				run_static_wearleveling(params->Plane_address);
				delete params;
				break;
			}
			case GC_Deferred_Event_Type::EXECUTE_PARKED_GC_WL: {
				Execute_Parked_Gc_Wl_Params* params = (Execute_Parked_Gc_Wl_Params*)ev->Parameters;
				execute_parked_gc_wl_if_ready(params->Block_address);
				delete params;
				break;
			}
		}
	}

	// BUG FIX (this project, upstream MQSim): a GC check only ever runs when
	// something triggers it - a write frontier rolling over onto a new block,
	// or an erase completing. If a check starts nothing (e.g. RGA's random
	// sample of rga_set_size full blocks happened to contain only blocks
	// with zero invalid pages - at this project's scale, with only a couple
	// of reclaimable blocks per plane, that's a ~1-in-5 event) at a moment
	// when every write for the plane is already parked in Write_transactions_
	// for_overfull_planes and no erase is in flight, nothing will ever
	// trigger another check: no write can allocate, no erase can complete,
	// and the simulation's event queue empties with those writes still
	// outstanding. Upstream never hits this at real-SSD block counts. The
	// last check before such a stall usually runs *before* the first write
	// gets parked (right after an erase, while the plane still has a few
	// free pages), so the Address Mapping Unit also requests a check the
	// moment a plane's first write is parked (mange_unsuccessful_
	// translation()); from then on, this retry keeps it going.
	// Retrying (instead of, say, making RGA fall back to greedy) keeps every
	// selection policy's own behavior unchanged. Only retries while a
	// reclaimable block actually exists, and at most GC_MAX_RETRIES times in
	// a row - a policy with a blind spot (FIFO had one) must not turn a
	// stall into a simulation that never ends.
	// DEVIATION FROM UPSTREAM MQSim (needed because of this project's own
	// max_ongoing_gc_reqs_per_plane scale tweak - see SSD_Device.cpp):
	// upstream never checks, before starting a GC/WL, whether the plane has
	// room for the pages it is about to move. It relied on the free-pool
	// floor (max_ongoing_gc_reqs_per_plane, 10 upstream) that blocks user
	// writes: each concurrent GC moves at most one block's worth of pages,
	// so a floor of N covers N concurrent GCs. This project lowered that
	// floor to 3, a user write frontier can still take a block at exactly
	// 3 (leaving 2), and a multi-flow preset has one GC write frontier per
	// flow - so 3 concurrent GCs with mostly-valid victims (RANDOM_P/
	// RANDOM_PP pick any full block) ran the pool dry: "Requesting a free
	// block from an empty pool!". Admits a GC/WL only if the free pool can
	// hold every page still to be moved by the ones already running plus
	// this victim's valid pages. A victim with no valid pages always
	// passes - erasing it only ever gives space back.
	bool GC_and_WL_Unit_Base::has_room_to_migrate(const PlaneBookKeepingType* pbke, const flash_block_ID_type victim_block_id)
	{
		const Block_Pool_Slot_Type& victim = pbke->Blocks[victim_block_id];
		unsigned int pages_to_move = victim.Current_page_write_index - victim.Invalid_page_count;
		if (pages_to_move == 0) {
			return true;
		}
		for (flash_block_ID_type block_id : pbke->Ongoing_erase_operations) {
			const Block_Pool_Slot_Type& block = pbke->Blocks[block_id];
			// A parked GC/WL (no erase transaction yet) still has all its
			// valid pages to move; a running one has whatever migrations
			// haven't completed.
			pages_to_move += block.Erase_transaction == NULL
				? block.Current_page_write_index - block.Invalid_page_count
				: (unsigned int)block.Erase_transaction->Page_movement_activities.size();
		}
		return pages_to_move <= pbke->Free_block_pool.size() * pages_no_per_block;
	}

	void GC_and_WL_Unit_Base::Request_gc_check(const NVM::FlashMemory::Physical_Page_Address& plane_address)
	{
		Simulator->Register_sim_event(Simulator->Time() + 1, this,
			new Check_Gc_Required_Params{ block_manager->Get_pool_size(plane_address), plane_address }, (int)GC_Deferred_Event_Type::CHECK_GC_REQUIRED);
	}

	bool GC_and_WL_Unit_Base::gc_retry_needed(const NVM::FlashMemory::Physical_Page_Address& plane_address)
	{
		PlaneBookKeepingType* pbke = block_manager->Get_plane_bookkeeping_entry(plane_address);
		if (!pbke->Ongoing_erase_operations.empty()
			|| pbke->Get_free_block_pool_size() >= block_pool_gc_threshold
			|| !address_mapping_unit->Has_writes_waiting_for_free_space(plane_address)) {
			return false;
		}
		for (flash_block_ID_type block_id = 0; block_id < block_no_per_plane; block_id++) {
			if (pbke->Blocks[block_id].Current_page_write_index == pages_no_per_block
				&& pbke->Blocks[block_id].Invalid_page_count > 0
				&& is_safe_gc_wl_candidate(pbke, block_id)) {
				return true;
			}
		}
		return false;
	}

	GC_Block_Selection_Policy_Type GC_and_WL_Unit_Base::Get_gc_policy()
	{
		return block_selection_policy;
	}

	unsigned int GC_and_WL_Unit_Base::Get_GC_policy_specific_parameter()
	{
		switch (block_selection_policy) {
			case GC_Block_Selection_Policy_Type::RGA:
				return rga_set_size;
			case GC_Block_Selection_Policy_Type::RANDOM_PP:
				return random_pp_threshold;
		}

		return 0;
	}

	unsigned int GC_and_WL_Unit_Base::Get_minimum_number_of_free_pages_before_GC()
	{
		return block_pool_gc_threshold;
		/*if (preemptible_gc_enabled)
			return block_pool_gc_hard_threshold;
		else return block_pool_gc_threshold;*/
	}

	bool GC_and_WL_Unit_Base::Use_dynamic_wearleveling()
	{
		return dynamic_wearleveling_enabled;
	}

	// BUILD FIX (this project): was `inline` - meaningless (and actively
	// harmful) on an out-of-line definition that lives in exactly one .cpp
	// file. `inline` only matters for definitions repeated across multiple
	// translation units via a header; here it let the compiler decide not
	// to emit an externally-linkable symbol at all, since nothing else in
	// this file happened to need one - which broke the moment a unit test
	// in a different .cpp tried to call it directly (see engine/tests/unit).
	bool GC_and_WL_Unit_Base::Use_static_wearleveling()
	{
		return static_wearleveling_enabled;
	}
	
	bool GC_and_WL_Unit_Base::Stop_servicing_writes(const NVM::FlashMemory::Physical_Page_Address& plane_address)
	{
		PlaneBookKeepingType* pbke = &(_my_instance->block_manager->plane_manager[plane_address.ChannelID][plane_address.ChipID][plane_address.DieID][plane_address.PlaneID]);
		return block_manager->Get_pool_size(plane_address) < max_ongoing_gc_reqs_per_plane;
	}

	bool GC_and_WL_Unit_Base::is_safe_gc_wl_candidate(const PlaneBookKeepingType* plane_record, const flash_block_ID_type gc_wl_candidate_block_id)
	{
		//The block shouldn't be a current write frontier
		for (unsigned int stream_id = 0; stream_id < address_mapping_unit->Get_no_of_input_streams(); stream_id++) {
			if ((&plane_record->Blocks[gc_wl_candidate_block_id]) == plane_record->Data_wf[stream_id]
				|| (&plane_record->Blocks[gc_wl_candidate_block_id]) == plane_record->Translation_wf[stream_id]
				|| (&plane_record->Blocks[gc_wl_candidate_block_id]) == plane_record->GC_wf[stream_id]) {
				return false;
			}
		}

		//The block shouldn't have an ongoing program request (all pages must already be written)
		if (plane_record->Blocks[gc_wl_candidate_block_id].Ongoing_user_program_count > 0) {
			return false;
		}

		if (plane_record->Blocks[gc_wl_candidate_block_id].Has_ongoing_gc_wl) {
			return false;
		}

		return true;
	}

	// BUILD FIX (this project): same stray `inline` issue as Use_static_
	// wearleveling() above - see that comment.
	bool GC_and_WL_Unit_Base::check_static_wl_required(const NVM::FlashMemory::Physical_Page_Address plane_address)
	{
		if (!static_wearleveling_enabled) {
			return false;
		}
		flash_block_ID_type min_block_id, max_block_id;
		unsigned int min_erase_count, max_erase_count;
		return get_static_wl_erase_info(plane_address, min_block_id, min_erase_count, max_block_id, max_erase_count)
			&& (max_erase_count - min_erase_count >= static_wearleveling_threshold);
	}

	// DEVIATION FROM UPSTREAM MQSim: upstream compared the plane-wide
	// max/min erase counts (Get_min_max_erase_difference()) and always
	// targeted the plane-wide coldest block (Get_coldest_block_id(), lowest
	// block ID on ties), then silently gave up if that one block failed
	// is_safe_gc_wl_candidate(). The coldest block is very often one that
	// can never be a valid static-WL target:
	//   - a write frontier that is never written at all (e.g. a stream's
	//     Translation_wf when the whole mapping table fits in the CMT, or a
	//     GC_wf of a stream GC never touches) - permanently erase count 0
	//     and permanently unsafe, so once it is the coldest block, static WL
	//     can never fire again for the rest of the simulation, and
	//   - a free-pool block - it holds no cold data to move, and erasing it
	//     re-inserts it into Free_block_pool a second time on completion
	//     (Add_erased_block_to_pool() never removes it first).
	// Only blocks that actually hold written data and are safe GC/WL
	// candidates are considered for the minimum (and therefore the target);
	// the maximum still spans the whole plane. Returns false if no block
	// qualifies.
	bool GC_and_WL_Unit_Base::get_static_wl_erase_info(const NVM::FlashMemory::Physical_Page_Address& plane_address,
		flash_block_ID_type& min_block_id, unsigned int& min_erase_count, flash_block_ID_type& max_block_id, unsigned int& max_erase_count)
	{
		PlaneBookKeepingType* pbke = block_manager->Get_plane_bookkeeping_entry(plane_address);
		bool found = false;
		min_block_id = 0;
		min_erase_count = 0;
		max_block_id = 0;
		max_erase_count = pbke->Blocks[0].Erase_count;
		for (flash_block_ID_type block_id = 0; block_id < block_no_per_plane; block_id++) {
			const Block_Pool_Slot_Type& block = pbke->Blocks[block_id];
			if (block.Erase_count > max_erase_count) {
				max_erase_count = block.Erase_count;
				max_block_id = block_id;
			}
			if (block.Current_page_write_index == 0 || !is_safe_gc_wl_candidate(pbke, block_id)) {
				continue;
			}
			if (!found || block.Erase_count < min_erase_count) {
				min_erase_count = block.Erase_count;
				min_block_id = block_id;
				found = true;
			}
		}
		return found;
	}

	void GC_and_WL_Unit_Base::run_static_wearleveling(const NVM::FlashMemory::Physical_Page_Address plane_address)
	{
		PlaneBookKeepingType* pbke = block_manager->Get_plane_bookkeeping_entry(plane_address);
		flash_block_ID_type wl_candidate_block_id, max_erase_block_id;
		unsigned int min_erase_count, max_erase_count;
		// Re-checked here, not just when this deferred event was scheduled -
		// the plane may have changed in between (see get_static_wl_erase_info()).
		if (!get_static_wl_erase_info(plane_address, wl_candidate_block_id, min_erase_count, max_erase_block_id, max_erase_count)
			|| max_erase_count - min_erase_count < static_wearleveling_threshold
			|| !has_room_to_migrate(pbke, wl_candidate_block_id)) {
			return;
		}

		NVM::FlashMemory::Physical_Page_Address wl_candidate_address(plane_address);
		wl_candidate_address.BlockID = wl_candidate_block_id;
		Block_Pool_Slot_Type* block = &pbke->Blocks[wl_candidate_block_id];

		//Run the state machine to protect against race condition
		block->Is_wl_triggered = true;
		block_manager->GC_WL_started(wl_candidate_address);
		pbke->Ongoing_erase_operations.insert(wl_candidate_block_id);
		address_mapping_unit->Set_barrier_for_accessing_physical_block(wl_candidate_address);//Lock the block, so no user request can intervene while the GC is progressing
		if (block_manager->Can_execute_gc_wl(wl_candidate_address)) {//If there are ongoing requests targeting the candidate block, the gc execution should be postponed
			Stats::Total_wl_executions++;
			Simulation_Events::Notify_wl_started(block->Stream_id, wl_candidate_address,
				min_erase_count, max_erase_count, max_erase_block_id, static_wearleveling_threshold);
			tsu->Prepare_for_transaction_submit();

			NVM_Transaction_Flash_ER* wl_erase_tr = new NVM_Transaction_Flash_ER(Transaction_Source_Type::GC_WL, pbke->Blocks[wl_candidate_block_id].Stream_id, wl_candidate_address);
			if (block->Current_page_write_index - block->Invalid_page_count > 0) {//If there are some valid pages in block, then prepare flash transactions for page movement
				NVM_Transaction_Flash_RD* wl_read = NULL;
				NVM_Transaction_Flash_WR* wl_write = NULL;
				for (flash_page_ID_type pageID = 0; pageID < block->Current_page_write_index; pageID++) {
					if (block_manager->Is_page_valid(block, pageID)) {
						// BUG FIX (this project, upstream MQSim): upstream counted
						// static-WL page movements as GC page movements, leaving
						// Average_Page_Movement_For_WL permanently 0.
						Stats::Total_page_movements_for_wl++;
						wl_candidate_address.PageID = pageID;
						// Notify_wl_page_migrated() fires from this function's own READ
						// completion case (handle_transaction_serviced_signal_from_PHY,
						// above) instead - see the matching comment in
						// GC_and_WL_Unit_Page_Level.cpp's Check_gc_required for why
						// (this eager decision-time loop bunched every page of a
						// static-WL cycle into one simulator event-group; missed in the
						// first pass at this fix since static WL's own entry point here
						// is separate from Check_gc_required and this class's other
						// eager loop).
						if (use_copyback) {
							wl_write = new NVM_Transaction_Flash_WR(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
								NO_LPA, address_mapping_unit->Convert_address_to_ppa(wl_candidate_address), NULL, 0, NULL, 0, INVALID_TIME_STAMP);
							wl_write->ExecutionMode = WriteExecutionModeType::COPYBACK;
							tsu->Submit_transaction(wl_write);
						} else {
							wl_read = new NVM_Transaction_Flash_RD(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
								NO_LPA, address_mapping_unit->Convert_address_to_ppa(wl_candidate_address), wl_candidate_address, NULL, 0, NULL, 0, INVALID_TIME_STAMP);
							wl_write = new NVM_Transaction_Flash_WR(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
								NO_LPA, NO_PPA, wl_candidate_address, NULL, 0, wl_read, 0, INVALID_TIME_STAMP);
							wl_write->ExecutionMode = WriteExecutionModeType::SIMPLE;
							wl_write->RelatedErase = wl_erase_tr;
							wl_read->RelatedWrite = wl_write;
							tsu->Submit_transaction(wl_read);//Only the read transaction would be submitted. The Write transaction is submitted when the read transaction is finished and the LPA of the target page is determined
						}
						wl_erase_tr->Page_movement_activities.push_back(wl_write);
					}
				}
			}
			block->Erase_transaction = wl_erase_tr;
			tsu->Submit_transaction(wl_erase_tr);

			tsu->Schedule();
		}
	}
}
