#ifndef SIMULATION_EVENTS_H
#define SIMULATION_EVENTS_H

#include "../ssd/SSD_Defs.h"
#include "../nvm_chip/flash_memory/Physical_Page_Address.h"

// Build-agnostic event hooks that the SSD/FTL layer calls into when
// something a UI would want to see happens (e.g. a mapping-table update).
// Native builds (CLI, future GTest binaries) never assign a callback here,
// so Notify_*() calls are a no-op there and simulation behavior/output is
// unchanged. Only the WASM bindings layer (engine/mqsim/src/wasm) ever
// assigns these function pointers - this keeps Emscripten specifics out of
// the simulator code itself, matching how MQSim_Interface already isolates
// main.cpp's CLI concerns from the engine.
namespace Simulation_Events
{
	struct Mapping_Updated_Event
	{
		stream_id_type Stream_id;
		LPA_type Lpa;
		PPA_type Ppa;
		bool Is_write; // false: resolved for a read, true: newly written
		NVM::FlashMemory::Physical_Page_Address Address; // decomposed Ppa
	};

	extern void (*On_mapping_updated)(const Mapping_Updated_Event&);

	inline void Notify_mapping_updated(stream_id_type stream_id, LPA_type lpa, PPA_type ppa, bool is_write, const NVM::FlashMemory::Physical_Page_Address& address)
	{
		if (On_mapping_updated) {
			Mapping_Updated_Event event{ stream_id, lpa, ppa, is_write, address };
			On_mapping_updated(event);
		}
	}

	// A GC execution has just started on a victim block (PageID is not
	// meaningful here - the event is about the whole block). Fired from both
	// places GC_and_WL_Unit increments Stats::Total_gc_executions: the
	// immediate path (GC_and_WL_Unit_Page_Level::Check_gc_required) and the
	// "was blocked on an in-flight request, now clear to run" deferred path
	// (GC_and_WL_Unit_Base::handle_transaction_serviced_signal_from_PHY).
	//
	// GC and static wear-leveling (see the WL_* events below) share that
	// deferred path and MQSim itself does not track which of the two parked
	// a given block there - Stats::Total_gc_executions gets incremented
	// unconditionally regardless. This project distinguishes them with the
	// Is_wl_triggered flag added to Block_Pool_Slot_Type (Flash_Block_
	// Manager_Base.h) - set to true right before a block is parked in
	// run_static_wearleveling(), false right before Check_gc_required()
	// parks one, and read back at the deferred-path/erase-completion call
	// sites to pick GC_* vs WL_* events. Stats::Total_gc_executions itself
	// is left as-is (still conflates the two), since it's part of MQSim's
	// own reported results and this project never changes simulation output
	// - see engine/tests/golden/ and run-regression-tests.sh.
	struct GC_Started_Event
	{
		stream_id_type Stream_id;
		NVM::FlashMemory::Physical_Page_Address Block_address;
	};

	extern void (*On_gc_started)(const GC_Started_Event&);

	inline void Notify_gc_started(stream_id_type stream_id, const NVM::FlashMemory::Physical_Page_Address& block_address)
	{
		if (On_gc_started) {
			GC_Started_Event event{ stream_id, block_address };
			On_gc_started(event);
		}
	}

	// One valid page's migration read has completed and its destination page
	// (the write it's about to land on) has just been allocated - fired once
	// per page, from the one place both addresses are known at the same time
	// (GC_and_WL_Unit_Base::handle_transaction_serviced_signal_from_PHY's
	// READ case, right after Allocate_new_page_for_gc() determines the
	// destination). Page_address is the *source* (the victim block page
	// being vacated); New_page_address is where its data is headed. Lpa is
	// the logical page this physical migration is moving - a UI tracking
	// "where does LPA X currently live" (e.g. to show an overwrite's
	// previous location) needs this to keep that mapping in sync with GC/WL
	// moves, not just host writes (mapping_updated is never fired for a GC/
	// WL migration - it goes through Allocate_new_page_for_gc(), not
	// translate_lpa_to_ppa()).
	struct GC_Page_Migrated_Event
	{
		stream_id_type Stream_id;
		LPA_type Lpa;
		NVM::FlashMemory::Physical_Page_Address Page_address;
		NVM::FlashMemory::Physical_Page_Address New_page_address;
	};

	extern void (*On_gc_page_migrated)(const GC_Page_Migrated_Event&);

	inline void Notify_gc_page_migrated(stream_id_type stream_id, LPA_type lpa, const NVM::FlashMemory::Physical_Page_Address& page_address, const NVM::FlashMemory::Physical_Page_Address& new_page_address)
	{
		if (On_gc_page_migrated) {
			GC_Page_Migrated_Event event{ stream_id, lpa, page_address, new_page_address };
			On_gc_page_migrated(event);
		}
	}

	// A block's erase has physically completed and it is about to be
	// returned to the free pool. Fired from the one place in the engine an
	// erase transaction is ever serviced (Transaction_Type::ERASE in
	// GC_and_WL_Unit_Base::handle_transaction_serviced_signal_from_PHY) -
	// same GC/WL attribution caveat as GC_Started_Event above applies here.
	struct GC_Block_Erased_Event
	{
		NVM::FlashMemory::Physical_Page_Address Block_address;
	};

	extern void (*On_gc_block_erased)(const GC_Block_Erased_Event&);

	inline void Notify_gc_block_erased(const NVM::FlashMemory::Physical_Page_Address& block_address)
	{
		if (On_gc_block_erased) {
			GC_Block_Erased_Event event{ block_address };
			On_gc_block_erased(event);
		}
	}

	// Static wear-leveling counterparts of the three GC_* events above -
	// same shape, fired instead of the GC_* one whenever
	// Block_Pool_Slot_Type::Is_wl_triggered is true for the block in
	// question. See run_static_wearleveling() (GC_and_WL_Unit_Base.cpp),
	// the only place that ever sets that flag to true.
	struct WL_Started_Event
	{
		stream_id_type Stream_id;
		NVM::FlashMemory::Physical_Page_Address Block_address;
	};

	extern void (*On_wl_started)(const WL_Started_Event&);

	inline void Notify_wl_started(stream_id_type stream_id, const NVM::FlashMemory::Physical_Page_Address& block_address)
	{
		if (On_wl_started) {
			WL_Started_Event event{ stream_id, block_address };
			On_wl_started(event);
		}
	}

	// Same shape/timing as GC_Page_Migrated_Event above, for a static
	// wear-leveling migration instead.
	struct WL_Page_Migrated_Event
	{
		stream_id_type Stream_id;
		LPA_type Lpa;
		NVM::FlashMemory::Physical_Page_Address Page_address;
		NVM::FlashMemory::Physical_Page_Address New_page_address;
	};

	extern void (*On_wl_page_migrated)(const WL_Page_Migrated_Event&);

	inline void Notify_wl_page_migrated(stream_id_type stream_id, LPA_type lpa, const NVM::FlashMemory::Physical_Page_Address& page_address, const NVM::FlashMemory::Physical_Page_Address& new_page_address)
	{
		if (On_wl_page_migrated) {
			WL_Page_Migrated_Event event{ stream_id, lpa, page_address, new_page_address };
			On_wl_page_migrated(event);
		}
	}

	struct WL_Block_Erased_Event
	{
		NVM::FlashMemory::Physical_Page_Address Block_address;
	};

	extern void (*On_wl_block_erased)(const WL_Block_Erased_Event&);

	inline void Notify_wl_block_erased(const NVM::FlashMemory::Physical_Page_Address& block_address)
	{
		if (On_wl_block_erased) {
			WL_Block_Erased_Event event{ block_address };
			On_wl_block_erased(event);
		}
	}

	// Dynamic wear-leveling isn't a discrete "runs occasionally" mechanism
	// like GC/static WL above - it's baked into every single free-block
	// pick: PlaneBookKeepingType::Get_a_free_block() always hands out
	// whichever free block has the lowest Erase_count (see
	// Add_to_free_block_pool(), which keys the free-block multimap by
	// Erase_count when Dynamic_Wearleveling_Enabled is on, or by a constant
	// 0 - i.e. plain FIFO - when it's off). So these two fire continuously,
	// on every write-frontier rotation and every block returning to the
	// free pool, regardless of whether dynamic WL is actually enabled -
	// Dynamic_wl_considered on the freed event tells a consumer whether
	// this particular return-to-pool was erase-count-ordered or not.
	struct Dynamic_WL_Block_Allocated_Event
	{
		stream_id_type Stream_id;
		NVM::FlashMemory::Physical_Page_Address Block_address;
		unsigned int Erase_count;
		bool For_mapping_data; // true: became a translation-page write frontier
	};

	extern void (*On_dynamic_wl_block_allocated)(const Dynamic_WL_Block_Allocated_Event&);

	inline void Notify_dynamic_wl_block_allocated(stream_id_type stream_id, const NVM::FlashMemory::Physical_Page_Address& block_address, unsigned int erase_count, bool for_mapping_data)
	{
		if (On_dynamic_wl_block_allocated) {
			Dynamic_WL_Block_Allocated_Event event{ stream_id, block_address, erase_count, for_mapping_data };
			On_dynamic_wl_block_allocated(event);
		}
	}

	struct Dynamic_WL_Block_Freed_Event
	{
		NVM::FlashMemory::Physical_Page_Address Block_address;
		unsigned int Erase_count;
		bool Dynamic_wl_considered; // false: inserted FIFO-style (Dynamic_Wearleveling_Enabled is off)
	};

	extern void (*On_dynamic_wl_block_freed)(const Dynamic_WL_Block_Freed_Event&);

	inline void Notify_dynamic_wl_block_freed(const NVM::FlashMemory::Physical_Page_Address& block_address, unsigned int erase_count, bool dynamic_wl_considered)
	{
		if (On_dynamic_wl_block_freed) {
			Dynamic_WL_Block_Freed_Event event{ block_address, erase_count, dynamic_wl_considered };
			On_dynamic_wl_block_freed(event);
		}
	}
}

#endif // !SIMULATION_EVENTS_H
