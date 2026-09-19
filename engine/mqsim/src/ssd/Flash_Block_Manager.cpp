
#include "../nvm_chip/flash_memory/Physical_Page_Address.h"
#include "Flash_Block_Manager.h"
#include "Stats.h"
#include "../exec/Simulation_Events.h"
#include "../sim/Engine.h"

namespace SSD_Components
{
	Flash_Block_Manager::Flash_Block_Manager(GC_and_WL_Unit_Base* gc_and_wl_unit, unsigned int max_allowed_block_erase_count, unsigned int total_concurrent_streams_no,
		unsigned int channel_count, unsigned int chip_no_per_channel, unsigned int die_no_per_chip, unsigned int plane_no_per_die,
		unsigned int block_no_per_plane, unsigned int page_no_per_block)
		: Flash_Block_Manager_Base(gc_and_wl_unit, max_allowed_block_erase_count, total_concurrent_streams_no, channel_count, chip_no_per_channel, die_no_per_chip,
			plane_no_per_die, block_no_per_plane, page_no_per_block)
	{
	}

	Flash_Block_Manager::~Flash_Block_Manager()
	{
	}

	void Flash_Block_Manager::Allocate_block_and_page_in_plane_for_user_write(const stream_id_type stream_id, NVM::FlashMemory::Physical_Page_Address& page_address)
	{
		PlaneBookKeepingType *plane_record = &plane_manager[page_address.ChannelID][page_address.ChipID][page_address.DieID][page_address.PlaneID];
		plane_record->Valid_pages_count++;
		plane_record->Free_pages_count--;		
		page_address.BlockID = plane_record->Data_wf[stream_id]->BlockID;
		page_address.PageID = plane_record->Data_wf[stream_id]->Current_page_write_index++;
		program_transaction_issued(page_address);

		//The current write frontier block is written to the end
		if(plane_record->Data_wf[stream_id]->Current_page_write_index == pages_no_per_block) {
			//Assign a new write frontier block
			plane_record->Data_wf[stream_id] = plane_record->Get_a_free_block(stream_id, false);
			NVM::FlashMemory::Physical_Page_Address wf_address(page_address);
			wf_address.BlockID = plane_record->Data_wf[stream_id]->BlockID;
			Simulation_Events::Notify_dynamic_wl_block_allocated(stream_id, wf_address, plane_record->Data_wf[stream_id]->Erase_count, false);
			// Deferred (not called directly) so this write's own Notify_
			// mapping_updated and any GC/WL cycle this triggers land in
			// separate simulator event-groups / UI steps - see the
			// GC_Deferred_Event_Type doc comment in GC_and_WL_Unit_Base.h.
			Simulator->Register_sim_event(Simulator->Time() + 1, gc_and_wl_unit,
				new Check_Gc_Required_Params{ plane_record->Get_free_block_pool_size(), page_address }, (int)GC_Deferred_Event_Type::CHECK_GC_REQUIRED);
		}

		plane_record->Check_bookkeeping_correctness(page_address);
	}

	void Flash_Block_Manager::Allocate_block_and_page_in_plane_for_gc_write(const stream_id_type stream_id, NVM::FlashMemory::Physical_Page_Address& page_address)
	{
		PlaneBookKeepingType *plane_record = &plane_manager[page_address.ChannelID][page_address.ChipID][page_address.DieID][page_address.PlaneID];
		plane_record->Valid_pages_count++;
		plane_record->Free_pages_count--;
		page_address.BlockID = plane_record->GC_wf[stream_id]->BlockID;
		page_address.PageID = plane_record->GC_wf[stream_id]->Current_page_write_index++;
		// BUG FIX (this project, upstream MQSim): the sibling functions
		// (Allocate_block_and_page_in_plane_for_user_write and even
		// _for_translation_write's own GC path) call program_transaction_issued()
		// right here so Ongoing_user_program_count reflects this page's write as
		// still in flight - this function never did. Without it,
		// is_safe_gc_wl_candidate()'s "no ongoing program" check is blind to a GC
		// migration write that just filled this exact block. That matters because
		// the very next lines, when this write happens to be the block's LAST
		// page, immediately roll GC_wf over to a new block and synchronously call
		// Check_gc_required() - which can then select this just-filled block as
		// its own new GC victim before this page's physical write has actually
		// reached the chip, since by then GC_wf no longer points at it either.
		// Set_barrier_for_accessing_physical_block() then finds this page "valid"
		// per Current_page_write_index but its on-chip metadata still unset
		// (NO_LPA), and MQSim aborts: "Inconsistency in the global mapping table
		// when locking an LPA!" - see /ftl-visual-simulator/reference/tweaked-code/
		// for the full investigation. This call closes that race the same way it
		// already does for regular user writes.
		program_transaction_issued(page_address);

		//The current write frontier block is written to the end
		if (plane_record->GC_wf[stream_id]->Current_page_write_index == pages_no_per_block) {
			//Assign a new write frontier block
			plane_record->GC_wf[stream_id] = plane_record->Get_a_free_block(stream_id, false);
			NVM::FlashMemory::Physical_Page_Address wf_address(page_address);
			wf_address.BlockID = plane_record->GC_wf[stream_id]->BlockID;
			Simulation_Events::Notify_dynamic_wl_block_allocated(stream_id, wf_address, plane_record->GC_wf[stream_id]->Erase_count, false);
			Simulator->Register_sim_event(Simulator->Time() + 1, gc_and_wl_unit,
				new Check_Gc_Required_Params{ plane_record->Get_free_block_pool_size(), page_address }, (int)GC_Deferred_Event_Type::CHECK_GC_REQUIRED);
		}
		plane_record->Check_bookkeeping_correctness(page_address);
	}
	
	void Flash_Block_Manager::Allocate_Pages_in_block_and_invalidate_remaining_for_preconditioning(const stream_id_type stream_id, const NVM::FlashMemory::Physical_Page_Address& plane_address, std::vector<NVM::FlashMemory::Physical_Page_Address>& page_addresses)
	{
		if(page_addresses.size() > pages_no_per_block) {
			PRINT_ERROR("Error while precondition a physical block: the size of the address list is larger than the pages_no_per_block!")
		}
			
		PlaneBookKeepingType *plane_record = &plane_manager[plane_address.ChannelID][plane_address.ChipID][plane_address.DieID][plane_address.PlaneID];
		if (plane_record->Data_wf[stream_id]->Current_page_write_index > 0) {
			PRINT_ERROR("Illegal operation: the Allocate_Pages_in_block_and_invalidate_remaining_for_preconditioning function should be executed for an erased block!")
		}

		//Assign physical addresses
		for (int i = 0; i < page_addresses.size(); i++) {
			plane_record->Valid_pages_count++;
			plane_record->Free_pages_count--;
			page_addresses[i].BlockID = plane_record->Data_wf[stream_id]->BlockID;
			page_addresses[i].PageID = plane_record->Data_wf[stream_id]->Current_page_write_index++;
			plane_record->Check_bookkeeping_correctness(page_addresses[i]);
		}

		//Invalidate the remaining pages in the block
		NVM::FlashMemory::Physical_Page_Address target_address(plane_address);
		while (plane_record->Data_wf[stream_id]->Current_page_write_index < pages_no_per_block) {
			plane_record->Free_pages_count--;
			target_address.BlockID = plane_record->Data_wf[stream_id]->BlockID;
			target_address.PageID = plane_record->Data_wf[stream_id]->Current_page_write_index++;
			Invalidate_page_in_block_for_preconditioning(stream_id, target_address);
			plane_record->Check_bookkeeping_correctness(plane_address);
		}

		//Update the write frontier
		plane_record->Data_wf[stream_id] = plane_record->Get_a_free_block(stream_id, false);
		NVM::FlashMemory::Physical_Page_Address wf_address(plane_address);
		wf_address.BlockID = plane_record->Data_wf[stream_id]->BlockID;
		Simulation_Events::Notify_dynamic_wl_block_allocated(stream_id, wf_address, plane_record->Data_wf[stream_id]->Erase_count, false);
	}

	void Flash_Block_Manager::Allocate_block_and_page_in_plane_for_translation_write(const stream_id_type streamID, NVM::FlashMemory::Physical_Page_Address& page_address, bool is_for_gc)
	{
		PlaneBookKeepingType *plane_record = &plane_manager[page_address.ChannelID][page_address.ChipID][page_address.DieID][page_address.PlaneID];
		plane_record->Valid_pages_count++;
		plane_record->Free_pages_count--;
		page_address.BlockID = plane_record->Translation_wf[streamID]->BlockID;
		page_address.PageID = plane_record->Translation_wf[streamID]->Current_page_write_index++;
		program_transaction_issued(page_address);

		//The current write frontier block for translation pages is written to the end
		if (plane_record->Translation_wf[streamID]->Current_page_write_index == pages_no_per_block) {
			//Assign a new write frontier block
			plane_record->Translation_wf[streamID] = plane_record->Get_a_free_block(streamID, true);
			NVM::FlashMemory::Physical_Page_Address wf_address(page_address);
			wf_address.BlockID = plane_record->Translation_wf[streamID]->BlockID;
			Simulation_Events::Notify_dynamic_wl_block_allocated(streamID, wf_address, plane_record->Translation_wf[streamID]->Erase_count, true);
			if (!is_for_gc) {
				Simulator->Register_sim_event(Simulator->Time() + 1, gc_and_wl_unit,
					new Check_Gc_Required_Params{ plane_record->Get_free_block_pool_size(), page_address }, (int)GC_Deferred_Event_Type::CHECK_GC_REQUIRED);
			}
		}
		plane_record->Check_bookkeeping_correctness(page_address);
	}

	inline void Flash_Block_Manager::Invalidate_page_in_block(const stream_id_type stream_id, const NVM::FlashMemory::Physical_Page_Address& page_address)
	{
		PlaneBookKeepingType* plane_record = &plane_manager[page_address.ChannelID][page_address.ChipID][page_address.DieID][page_address.PlaneID];
		plane_record->Invalid_pages_count++;
		plane_record->Valid_pages_count--;
		if (plane_record->Blocks[page_address.BlockID].Stream_id != stream_id) {
			PRINT_ERROR("Inconsistent status in the Invalidate_page_in_block function! The accessed block is not allocated to stream " << stream_id)
		}
		plane_record->Blocks[page_address.BlockID].Invalid_page_count++;
		plane_record->Blocks[page_address.BlockID].Invalid_page_bitmap[page_address.PageID / 64] |= ((uint64_t)0x1) << (page_address.PageID % 64);
	}

	inline void Flash_Block_Manager::Invalidate_page_in_block_for_preconditioning(const stream_id_type stream_id, const NVM::FlashMemory::Physical_Page_Address& page_address)
	{
		PlaneBookKeepingType* plane_record = &plane_manager[page_address.ChannelID][page_address.ChipID][page_address.DieID][page_address.PlaneID];
		plane_record->Invalid_pages_count++;
		if (plane_record->Blocks[page_address.BlockID].Stream_id != stream_id) {
			PRINT_ERROR("Inconsistent status in the Invalidate_page_in_block function! The accessed block is not allocated to stream " << stream_id)
		}
		plane_record->Blocks[page_address.BlockID].Invalid_page_count++;
		plane_record->Blocks[page_address.BlockID].Invalid_page_bitmap[page_address.PageID / 64] |= ((uint64_t)0x1) << (page_address.PageID % 64);
	}

	void Flash_Block_Manager::Add_erased_block_to_pool(const NVM::FlashMemory::Physical_Page_Address& block_address)
	{
		PlaneBookKeepingType *plane_record = &plane_manager[block_address.ChannelID][block_address.ChipID][block_address.DieID][block_address.PlaneID];
		Block_Pool_Slot_Type* block = &(plane_record->Blocks[block_address.BlockID]);
		plane_record->Free_pages_count += block->Invalid_page_count;
		plane_record->Invalid_pages_count -= block->Invalid_page_count;

		Stats::Block_erase_histogram[block_address.ChannelID][block_address.ChipID][block_address.DieID][block_address.PlaneID][block->Erase_count]--;
		block->Erase();
		Stats::Block_erase_histogram[block_address.ChannelID][block_address.ChipID][block_address.DieID][block_address.PlaneID][block->Erase_count]++;
		bool dynamic_wl_considered = gc_and_wl_unit->Use_dynamic_wearleveling();
		Simulation_Events::Notify_dynamic_wl_block_freed(block_address, block->Erase_count, dynamic_wl_considered);
		plane_record->Add_to_free_block_pool(block, dynamic_wl_considered);
		plane_record->Check_bookkeeping_correctness(block_address);
	}

	inline unsigned int Flash_Block_Manager::Get_pool_size(const NVM::FlashMemory::Physical_Page_Address& plane_address)
	{
		return (unsigned int) plane_manager[plane_address.ChannelID][plane_address.ChipID][plane_address.DieID][plane_address.PlaneID].Free_block_pool.size();
	}
}
