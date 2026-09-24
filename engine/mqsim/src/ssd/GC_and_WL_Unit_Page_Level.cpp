#include <limits>
#include <math.h>
#include <vector>
#include <set>
#include "GC_and_WL_Unit_Page_Level.h"
#include "Flash_Block_Manager.h"
#include "FTL.h"
#include "../exec/Simulation_Events.h"

namespace SSD_Components
{

	GC_and_WL_Unit_Page_Level::GC_and_WL_Unit_Page_Level(const sim_object_id_type& id,
		Address_Mapping_Unit_Base* address_mapping_unit, Flash_Block_Manager_Base* block_manager, TSU_Base* tsu, NVM_PHY_ONFI* flash_controller, 
		GC_Block_Selection_Policy_Type block_selection_policy, double gc_threshold, bool preemptible_gc_enabled, double gc_hard_threshold,
		unsigned int ChannelCount, unsigned int chip_no_per_channel, unsigned int die_no_per_chip, unsigned int plane_no_per_die,
		unsigned int block_no_per_plane, unsigned int Page_no_per_block, unsigned int sectors_per_page, 
		bool use_copyback, double rho, unsigned int max_ongoing_gc_reqs_per_plane, bool dynamic_wearleveling_enabled, bool static_wearleveling_enabled, unsigned int static_wearleveling_threshold, int seed)
		: GC_and_WL_Unit_Base(id, address_mapping_unit, block_manager, tsu, flash_controller, block_selection_policy, gc_threshold, preemptible_gc_enabled, gc_hard_threshold,
		ChannelCount, chip_no_per_channel, die_no_per_chip, plane_no_per_die, block_no_per_plane, Page_no_per_block, sectors_per_page, use_copyback, rho, max_ongoing_gc_reqs_per_plane, 
			dynamic_wearleveling_enabled, static_wearleveling_enabled, static_wearleveling_threshold, seed)
	{
		rga_set_size = (unsigned int)log2(block_no_per_plane);
	}
	
	bool GC_and_WL_Unit_Page_Level::GC_is_in_urgent_mode(const NVM::FlashMemory::Flash_Chip* chip)
	{
		if (!preemptible_gc_enabled) {
			return true;
		}

		NVM::FlashMemory::Physical_Page_Address addr;
		addr.ChannelID = chip->ChannelID; addr.ChipID = chip->ChipID;
		for (unsigned int die_id = 0; die_id < die_no_per_chip; die_id++) {
			for (unsigned int plane_id = 0; plane_id < plane_no_per_die; plane_id++) {
				addr.DieID = die_id; addr.PlaneID = plane_id;
				if (block_manager->Get_pool_size(addr) < block_pool_gc_hard_threshold)
					return true;
			}
		}

		return false;
	}

	void GC_and_WL_Unit_Page_Level::Check_gc_required(const unsigned int free_block_pool_size, const NVM::FlashMemory::Physical_Page_Address& plane_address)
	{
		if (free_block_pool_size < block_pool_gc_threshold) {
			flash_block_ID_type gc_candidate_block_id = block_manager->Get_coldest_block_id(plane_address);
			PlaneBookKeepingType* pbke = block_manager->Get_plane_bookkeeping_entry(plane_address);

			if (pbke->Ongoing_erase_operations.size() >= max_ongoing_gc_reqs_per_plane) {
				return;
			}

			switch (block_selection_policy) {
				case SSD_Components::GC_Block_Selection_Policy_Type::GREEDY://Find the set of blocks with maximum number of invalid pages and no free pages
				{
					// BUG FIX (this project, upstream MQSim): the initial pick
					// (block 0, or 1 if 0 is mid-erase) was never itself checked
					// against is_safe_gc_wl_candidate() - only later replacement
					// candidates were. At real MQSim's intended scale, block 0/1
					// is essentially never still a live write frontier by the
					// time GC first runs (thousands of other blocks exist to
					// serve as frontiers instead); at this project's small demo
					// scale, block 0 or 1 can easily *be* the current frontier,
					// and if no other block ever has strictly more invalid pages
					// while also being full and safe, that unsafe initial pick
					// survives untouched and gets used - selecting a block still
					// being actively written to as GC's victim, which crashes
					// with "Inconsistency in the global mapping table when
					// locking an LPA!". Now scans every block for the best
					// full+safe+not-already-erasing candidate from scratch, and
					// skips this GC opportunity entirely if none exists - same
					// "never fall through with an unverified pick" fix already
					// applied to RGA below.
					bool found_candidate = false;
					for (flash_block_ID_type block_id = 0; block_id < block_no_per_plane; block_id++) {
						if (pbke->Blocks[block_id].Current_page_write_index == pages_no_per_block
							&& pbke->Ongoing_erase_operations.find(block_id) == pbke->Ongoing_erase_operations.end()
							&& is_safe_gc_wl_candidate(pbke, block_id)
							&& (!found_candidate || pbke->Blocks[block_id].Invalid_page_count > pbke->Blocks[gc_candidate_block_id].Invalid_page_count)) {
							gc_candidate_block_id = block_id;
							found_candidate = true;
						}
					}
					if (!found_candidate) {
						return;
					}
					break;
				}
				case SSD_Components::GC_Block_Selection_Policy_Type::RGA:
				{
					std::set<flash_block_ID_type> random_set;
					// BUG FIX (this project, upstream MQSim): this loop had no bound
					// at all - unlike every other policy below (RANDOM/RANDOM_P/
					// RANDOM_PP all cap retries at block_no_per_plane), it just spun
					// forever if fewer than rga_set_size distinct blocks were ever
					// simultaneously safe. At real MQSim's intended scale (thousands
					// of blocks per plane) that's effectively impossible; at this
					// project's beginner-facing demo scale (as few as ~8 blocks,
					// further split per chip once multi-chip is selected) it's a
					// real, reachable hang - see /ftl-visual-simulator/reference/
					// tweaked-code/ for how this was found. Bounded to
					// block_no_per_plane^2 attempts (cheap even at max scale, and
					// overwhelmingly enough draws to find every available candidate
					// at this project's block counts) - if that's exhausted with
					// fewer than rga_set_size found, proceed with whatever safe
					// candidates *were* found rather than demanding the full set;
					// if literally none were found, skip this GC opportunity
					// entirely (see the empty-set return below) rather than ever
					// falling through with a candidate that was never verified safe.
					// BUG FIX (this project, upstream MQSim): this sampling loop
					// never required a candidate to actually be full
					// (Current_page_write_index == pages_no_per_block) - only
					// is_safe_gc_wl_candidate() (not-a-frontier, no ongoing op).
					// RANDOM_P/RANDOM_PP just below both explicitly require a full
					// block in their own retry condition; RGA is the one policy in
					// this switch that didn't, even though its own "pick the best"
					// loop further down already assumes full blocks (it only ever
					// replaces the initial pick with one that's both more-invalid
					// AND full). At real MQSim's intended scale, a block sampled
					// once free space is genuinely low is essentially always
					// already full (the device has cycled through nearly all its
					// capacity many times over by then), so this went unnoticed;
					// at this project's small demo scale, an empty (never-written)
					// block can easily be "safe" too and get sampled instead of the
					// one block that actually has garbage - wasting the one GC
					// opportunity a short-lived demo gets. See
					// /ftl-visual-simulator/reference/bug-list/ for the
					// investigation this came from.
					unsigned int rga_attempts = 0;
					const unsigned int rga_max_attempts = block_no_per_plane * block_no_per_plane;
					while (random_set.size() < rga_set_size && rga_attempts++ < rga_max_attempts) {
						flash_block_ID_type block_id = random_generator.Uniform_uint(0, block_no_per_plane - 1);
						if (pbke->Blocks[block_id].Current_page_write_index == pages_no_per_block
							&& pbke->Ongoing_erase_operations.find(block_id) == pbke->Ongoing_erase_operations.end()
							&& is_safe_gc_wl_candidate(pbke, block_id)) {
							random_set.insert(block_id);
							}
					}
					if (random_set.empty()) {
						return;
					}
					gc_candidate_block_id = *random_set.begin();
					for(auto &block_id : random_set) {
						if (pbke->Blocks[block_id].Invalid_page_count > pbke->Blocks[gc_candidate_block_id].Invalid_page_count
							&& pbke->Blocks[block_id].Current_page_write_index == pages_no_per_block) {
							gc_candidate_block_id = block_id;
						}
					}
					break;
				}
				case SSD_Components::GC_Block_Selection_Policy_Type::RANDOM:
				{
					gc_candidate_block_id = random_generator.Uniform_uint(0, block_no_per_plane - 1);
					unsigned int repeat = 0;

					//A write frontier block should not be selected for garbage collection
					while (!is_safe_gc_wl_candidate(pbke, gc_candidate_block_id) && repeat++ < block_no_per_plane) {
						gc_candidate_block_id = random_generator.Uniform_uint(0, block_no_per_plane - 1);
					}
					// BUG FIX (this project, upstream MQSim): the loop gives up
					// after block_no_per_plane draws and upstream then used
					// whatever it last drew, safe or not - a live write
					// frontier picked this way crashes with "Inconsistency in
					// the global mapping table when locking an LPA!" (seen at
					// 8 blocks x 4 chips). Same "never fall through with an
					// unverified pick" fix as GREEDY/FIFO/RGA: skip this GC
					// opportunity instead. Same for RANDOM_P/RANDOM_PP below.
					if (!is_safe_gc_wl_candidate(pbke, gc_candidate_block_id)) {
						return;
					}
					break;
				}
				case SSD_Components::GC_Block_Selection_Policy_Type::RANDOM_P:
				{
					gc_candidate_block_id = random_generator.Uniform_uint(0, block_no_per_plane - 1);
					unsigned int repeat = 0;

					//A write frontier block or a block with free pages should not be selected for garbage collection
					while ((pbke->Blocks[gc_candidate_block_id].Current_page_write_index < pages_no_per_block || !is_safe_gc_wl_candidate(pbke, gc_candidate_block_id))
						&& repeat++ < block_no_per_plane) {
						gc_candidate_block_id = random_generator.Uniform_uint(0, block_no_per_plane - 1);
					}
					if (pbke->Blocks[gc_candidate_block_id].Current_page_write_index < pages_no_per_block || !is_safe_gc_wl_candidate(pbke, gc_candidate_block_id)) {
						return;
					}
					break;
				}
				case SSD_Components::GC_Block_Selection_Policy_Type::RANDOM_PP:
				{
					gc_candidate_block_id = random_generator.Uniform_uint(0, block_no_per_plane - 1);
					unsigned int repeat = 0;

					//The selected gc block should have a minimum number of invalid pages
					while ((pbke->Blocks[gc_candidate_block_id].Current_page_write_index < pages_no_per_block 
						|| pbke->Blocks[gc_candidate_block_id].Invalid_page_count < random_pp_threshold
						|| !is_safe_gc_wl_candidate(pbke, gc_candidate_block_id))
						&& repeat++ < block_no_per_plane) {
						gc_candidate_block_id = random_generator.Uniform_uint(0, block_no_per_plane - 1);
					}
					if (pbke->Blocks[gc_candidate_block_id].Current_page_write_index < pages_no_per_block
						|| pbke->Blocks[gc_candidate_block_id].Invalid_page_count < random_pp_threshold
						|| !is_safe_gc_wl_candidate(pbke, gc_candidate_block_id)) {
						return;
					}
					break;
				}
				case SSD_Components::GC_Block_Selection_Policy_Type::COST_BENEFIT:
				{
					// Not in upstream MQSim (this project): LFS cost-benefit.
					// benefit/cost = (1 - u) / (2u) x age - (1 - u) is the space
					// reclaimed, 2u the cost of reading and rewriting the valid
					// fraction u, and age (time since the block was allocated as
					// a write frontier) favors blocks whose data has been stable,
					// since their remaining valid pages are less likely to be
					// invalidated soon anyway. A fully invalid block (u = 0) is
					// free to reclaim and always wins. Same candidate rules as
					// GREEDY/FIFO (full, safe, not already erasing, something to
					// reclaim, room to migrate).
					bool found_candidate = false;
					double best_score = -1;
					for (flash_block_ID_type block_id = 0; block_id < block_no_per_plane; block_id++) {
						const Block_Pool_Slot_Type& block = pbke->Blocks[block_id];
						if (block.Current_page_write_index != pages_no_per_block || block.Invalid_page_count == 0
							|| pbke->Ongoing_erase_operations.find(block_id) != pbke->Ongoing_erase_operations.end()
							|| !is_safe_gc_wl_candidate(pbke, block_id) || !has_room_to_migrate(pbke, block_id)) {
							continue;
						}
						double u = double(pages_no_per_block - block.Invalid_page_count) / double(pages_no_per_block);
						double age = double(Simulator->Time() - block.Allocation_time) + 1.0;
						double score = u == 0 ? std::numeric_limits<double>::max() : (1.0 - u) / (2.0 * u) * age;
						if (!found_candidate || score > best_score) {
							best_score = score;
							gc_candidate_block_id = block_id;
							found_candidate = true;
						}
					}
					if (!found_candidate) {
						return;
					}
					break;
				}
				case SSD_Components::GC_Block_Selection_Policy_Type::FIFO:
				{
					// BUG FIX (this project, upstream MQSim): popped the front
					// of the allocation-order queue unconditionally - no check
					// that the queue was even non-empty (undefined behavior on
					// std::queue::front() otherwise), and no check that the
					// oldest-allocated block is actually a safe GC candidate
					// (not a live write frontier, not mid-erase). At real
					// MQSim's intended scale, the oldest-allocated block has
					// almost always long since stopped being any block's
					// current frontier by the time GC first runs; at this
					// project's small demo scale, it can easily still *be* one,
					// which crashes the same way GREEDY's equivalent gap did
					// (see that case's comment above). Now cycles through the
					// queue (re-queueing anything not yet eligible, so it's
					// reconsidered on its next natural turn) up to its own
					// size, and skips this GC opportunity entirely if nothing
					// in it is eligible yet.
					bool found_candidate = false;
					const size_t attempts = pbke->Block_usage_history.size();
					for (size_t attempt = 0; attempt < attempts; attempt++) {
						std::pair<flash_block_ID_type, unsigned int> entry = pbke->Block_usage_history.front();
						pbke->Block_usage_history.pop();
						flash_block_ID_type candidate_block_id = entry.first;
						if (entry.second != pbke->Blocks[candidate_block_id].Allocation_seq) {
							continue;//Stale entry - see Block_usage_history's comment
						}
						// BUG FIX (this project, upstream MQSim): the candidate
						// must also have something to reclaim. Popping a block
						// with zero invalid pages here made the shared "No
						// invalid page to erase" check below return with the
						// block already removed from Block_usage_history - it
						// was never re-queued, so once it later gained invalid
						// pages FIFO could never pick it again (a stall once
						// it was the plane's only reclaimable block). For the
						// same reason every other check that could still reject
						// it after the switch (has_room_to_migrate()) is done
						// here, while it can still be re-queued.
						if (pbke->Blocks[candidate_block_id].Current_page_write_index == pages_no_per_block
							&& pbke->Blocks[candidate_block_id].Invalid_page_count > 0
							&& pbke->Ongoing_erase_operations.find(candidate_block_id) == pbke->Ongoing_erase_operations.end()
							&& is_safe_gc_wl_candidate(pbke, candidate_block_id)
							&& has_room_to_migrate(pbke, candidate_block_id)) {
							gc_candidate_block_id = candidate_block_id;
							found_candidate = true;
							break;
						}
						pbke->Block_usage_history.push(entry);
					}
					if (!found_candidate) {
						return;
					}
					break;
				}
				default:
					break;
			}

			//This should never happen, but we check it here for safty
			if (pbke->Ongoing_erase_operations.find(gc_candidate_block_id) != pbke->Ongoing_erase_operations.end()) {
				return;
			}
			
			NVM::FlashMemory::Physical_Page_Address gc_candidate_address(plane_address);
			gc_candidate_address.BlockID = gc_candidate_block_id;
			Block_Pool_Slot_Type* block = &pbke->Blocks[gc_candidate_block_id];

			//No invalid page to erase
			if (block->Current_page_write_index == 0 || block->Invalid_page_count == 0) {
				return;
			}
			if (!has_room_to_migrate(pbke, gc_candidate_block_id)) {
				return;
			}
			
			//Run the state machine to protect against race condition
			block->Is_wl_triggered = false;
			block_manager->GC_WL_started(gc_candidate_address);
			pbke->Ongoing_erase_operations.insert(gc_candidate_block_id);
			address_mapping_unit->Set_barrier_for_accessing_physical_block(gc_candidate_address);//Lock the block, so no user request can intervene while the GC is progressing
			
			//If there are ongoing requests targeting the candidate block, the gc execution should be postponed
			if (block_manager->Can_execute_gc_wl(gc_candidate_address)) {
				Stats::Total_gc_executions++;
				Simulation_Events::Notify_gc_started(pbke->Blocks[gc_candidate_block_id].Stream_id, gc_candidate_address,
					block->Current_page_write_index - block->Invalid_page_count, block->Invalid_page_count, pages_no_per_block,
					pbke->Get_free_block_pool_size(), block_pool_gc_threshold);
				tsu->Prepare_for_transaction_submit();

				NVM_Transaction_Flash_ER* gc_erase_tr = new NVM_Transaction_Flash_ER(Transaction_Source_Type::GC_WL, pbke->Blocks[gc_candidate_block_id].Stream_id, gc_candidate_address);
				//If there are some valid pages in block, then prepare flash transactions for page movement
				if (block->Current_page_write_index - block->Invalid_page_count > 0) {
					NVM_Transaction_Flash_RD* gc_read = NULL;
					NVM_Transaction_Flash_WR* gc_write = NULL;
					for (flash_page_ID_type pageID = 0; pageID < block->Current_page_write_index; pageID++) {
						if (block_manager->Is_page_valid(block, pageID)) {
							Stats::Total_page_movements_for_gc++;
							gc_candidate_address.PageID = pageID;
							// Notify_gc_page_migrated() used to fire right here, at GC's
							// decision to migrate this page - before its read/write
							// transactions were even submitted. Every valid page's
							// notification fired synchronously in this one loop, all
							// within the same simulator event-group, so a UI "one step"
							// button could never separate them (see GC_and_WL_Unit_Base.cpp's
							// handle_transaction_serviced_signal_from_PHY, READ case, where
							// it now fires instead - once this page's migration read has
							// actually completed, using that transaction's own address,
							// which is this same source page).
							if (use_copyback) {
								gc_write = new NVM_Transaction_Flash_WR(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
									NO_LPA, address_mapping_unit->Convert_address_to_ppa(gc_candidate_address), NULL, 0, NULL, 0, INVALID_TIME_STAMP);
								gc_write->ExecutionMode = WriteExecutionModeType::COPYBACK;
								tsu->Submit_transaction(gc_write);
							} else {
								gc_read = new NVM_Transaction_Flash_RD(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
									NO_LPA, address_mapping_unit->Convert_address_to_ppa(gc_candidate_address), gc_candidate_address, NULL, 0, NULL, 0, INVALID_TIME_STAMP);
								gc_write = new NVM_Transaction_Flash_WR(Transaction_Source_Type::GC_WL, block->Stream_id, sector_no_per_page * SECTOR_SIZE_IN_BYTE,
									NO_LPA, NO_PPA, gc_candidate_address, NULL, 0, gc_read, 0, INVALID_TIME_STAMP);
								gc_write->ExecutionMode = WriteExecutionModeType::SIMPLE;
								gc_write->RelatedErase = gc_erase_tr;
								gc_read->RelatedWrite = gc_write;
								tsu->Submit_transaction(gc_read);//Only the read transaction would be submitted. The Write transaction is submitted when the read transaction is finished and the LPA of the target page is determined
							}
							gc_erase_tr->Page_movement_activities.push_back(gc_write);
						}
					}
				}
				block->Erase_transaction = gc_erase_tr;
				tsu->Submit_transaction(gc_erase_tr);

				tsu->Schedule();
			}
		}
	}
}
