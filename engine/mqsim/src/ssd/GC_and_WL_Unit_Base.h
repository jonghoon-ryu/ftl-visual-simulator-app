#ifndef GC_AND_WL_UNIT_BASE_H
#define GC_AND_WL_UNIT_BASE_H

#include "../sim/Sim_Object.h"
#include "../nvm_chip/flash_memory/Flash_Chip.h"
#include "../nvm_chip/flash_memory/Physical_Page_Address.h"
#include "Address_Mapping_Unit_Base.h"
#include "Flash_Block_Manager_Base.h"
#include "TSU_Base.h"
#include "NVM_PHY_ONFI.h"


namespace SSD_Components
{
	enum class GC_Block_Selection_Policy_Type {
		GREEDY,
		RGA,						/*The randomized-greedy algorithm described in: "B. Van Houdt, A Mean Field Model
									for a Class of Garbage Collection Algorithms in Flash - based Solid State Drives,
									SIGMETRICS, 2013" and "Stochastic Modeling of Large-Scale Solid-State Storage
									Systems: Analysis, Design Tradeoffs and Optimization, SIGMETRICS, 2013".*/
		RANDOM, RANDOM_P, RANDOM_PP,/*The RANDOM, RANDOM+, and RANDOM++ algorithms described in: "B. Van Houdt, A Mean
									Field Model  for a Class of Garbage Collection Algorithms in Flash - based Solid
									State Drives, SIGMETRICS, 2013".*/
		FIFO						/*The FIFO algortihm described in P. Desnoyers, "Analytic  Modeling  of  SSD Write
									Performance, SYSTOR, 2012".*/
	};

	class Address_Mapping_Unit_Base;
	class Flash_Block_Manager_Base;
	class TSU_Base;
	class NVM_PHY_ONFI;
	class PlaneBookKeepingType;
	class Block_Pool_Slot_Type;

	// Check_gc_required()/run_static_wearleveling() used to be called
	// directly (synchronously) from deep inside other operations' own
	// processing - e.g. Flash_Block_Manager::Allocate_block_and_page_in_
	// plane_for_user_write() calling Check_gc_required() the moment a host
	// write happens to roll its write frontier over. Since that nested call
	// runs within the SAME simulator event-group as the triggering
	// operation's own notification (e.g. a write's Notify_mapping_updated),
	// a UI "one step" boundary (which can only fall between event-groups,
	// see bindings.cpp's step_event()) could never separate "a write
	// happened" from "and it happened to also start a new GC/WL cycle" -
	// both bunched into one step. Fixed by scheduling these as their own
	// deferred Sim_Event (fired one simulated time-unit later, in the next
	// event-group) instead of calling them in-line - see Execute_simulator_
	// event() below and every former direct-call site.
	// EXECUTE_PARKED_GC_WL is a fourth, separate case of the same problem:
	// handle_transaction_serviced_signal_from_PHY's own top section (any
	// USERIO/MAPPING/CACHE transaction's completion) checks whether the
	// transaction's own block was already parked for GC/WL (Has_ongoing_
	// gc_wl - set earlier by Check_gc_required()/run_static_wearleveling()
	// when the block itself was a safe candidate but blocked by an
	// in-flight op) and, if that block is now finally clear, synchronously
	// starts the whole GC/WL cycle right there - as a side effect of an
	// unrelated read/write's own completion, in the same event-group.
	enum class GC_Deferred_Event_Type { CHECK_GC_REQUIRED, RUN_STATIC_WEARLEVELING, EXECUTE_PARKED_GC_WL };

	// How long to wait before re-running a GC check that started nothing
	// while the plane's writes are stalled - see gc_retry_needed().
	const sim_time_type GC_RETRY_DELAY = 1000;
	// Safety net for that retry: stop after this many unproductive checks in
	// a row. A policy that can never reach the reclaimable block (FIFO did,
	// before its Block_usage_history leak was fixed) would otherwise retry
	// forever - a simulation that never ends is worse than one that stalls.
	const unsigned int GC_MAX_RETRIES = 1000;

	struct Check_Gc_Required_Params
	{
		unsigned int Free_block_pool_size;
		NVM::FlashMemory::Physical_Page_Address Plane_address;
		// How many gc_retry_needed() retries in a row led here (0 for any
		// other trigger) - see GC_MAX_RETRIES.
		unsigned int Retry_count = 0;
	};

	struct Run_Static_Wl_Params
	{
		NVM::FlashMemory::Physical_Page_Address Plane_address;
	};

	struct Execute_Parked_Gc_Wl_Params
	{
		NVM::FlashMemory::Physical_Page_Address Block_address;
	};

	/*
	* This class implements thet the Garbage Collection and Wear Leveling module of MQSim.
	*/
	class GC_and_WL_Unit_Base : public MQSimEngine::Sim_Object
	{
	public:
		GC_and_WL_Unit_Base(const sim_object_id_type& id, 
			Address_Mapping_Unit_Base* address_mapping_unit, Flash_Block_Manager_Base* block_manager, TSU_Base* tsu, NVM_PHY_ONFI* flash_controller,
			GC_Block_Selection_Policy_Type block_selection_policy, double gc_threshold,	bool preemptible_gc_enabled, double gc_hard_threshold,
			unsigned int channel_count, unsigned int chip_no_per_channel, unsigned int die_no_per_chip, unsigned int plane_no_per_die,
			unsigned int block_no_per_plane, unsigned int page_no_per_block, unsigned int sector_no_per_page,
			bool use_copyback, double rho, unsigned int max_ongoing_gc_reqs_per_plane,
			bool dynamic_wearleveling_enabled, bool static_wearleveling_enabled, unsigned int static_wearleveling_threshold, int seed);
		virtual ~GC_and_WL_Unit_Base() {}
		void Setup_triggers();
		void Start_simulation();
		void Validate_simulation_config();
		void Execute_simulator_event(MQSimEngine::Sim_Event*);

		virtual bool GC_is_in_urgent_mode(const NVM::FlashMemory::Flash_Chip*) = 0;
		virtual void Check_gc_required(const unsigned int BlockPoolSize, const NVM::FlashMemory::Physical_Page_Address& planeAddress) = 0;
		// Schedules a deferred Check_gc_required() for this plane - see
		// gc_retry_needed() for why the Address Mapping Unit needs this.
		void Request_gc_check(const NVM::FlashMemory::Physical_Page_Address& plane_address);
		GC_Block_Selection_Policy_Type Get_gc_policy();
		unsigned int Get_GC_policy_specific_parameter();//Returns the parameter specific to the GC block selection policy: threshold for random_pp, set_size for RGA
		unsigned int Get_minimum_number_of_free_pages_before_GC();
		bool Use_dynamic_wearleveling();
		bool Use_static_wearleveling();
		bool Stop_servicing_writes(const NVM::FlashMemory::Physical_Page_Address& plane_address);
	protected:
		GC_Block_Selection_Policy_Type block_selection_policy;
		static GC_and_WL_Unit_Base * _my_instance;
		Address_Mapping_Unit_Base* address_mapping_unit;
		Flash_Block_Manager_Base* block_manager;
		TSU_Base* tsu;
		NVM_PHY_ONFI* flash_controller;
		bool force_gc;
		double gc_threshold;//As the ratio of free pages to the total number of physical pages
		unsigned int block_pool_gc_threshold;
		static void handle_transaction_serviced_signal_from_PHY(NVM_Transaction_Flash* transaction);
		// Extracted from handle_transaction_serviced_signal_from_PHY's own
		// top section - see EXECUTE_PARKED_GC_WL's doc comment above for why
		// this now runs as its own deferred event instead of inline there.
		void execute_parked_gc_wl_if_ready(const NVM::FlashMemory::Physical_Page_Address& block_address);
		bool gc_retry_needed(const NVM::FlashMemory::Physical_Page_Address& plane_address);
		bool has_room_to_migrate(const PlaneBookKeepingType* pbke, const flash_block_ID_type victim_block_id);
		bool is_safe_gc_wl_candidate(const PlaneBookKeepingType* pbke, const flash_block_ID_type gc_wl_candidate_block_id);//Checks if block_address is a safe candidate for gc execution, i.e., 1) it is not a write frontier, and 2) there is no ongoing program operation
		bool check_static_wl_required(const NVM::FlashMemory::Physical_Page_Address plane_address);
		bool get_static_wl_erase_info(const NVM::FlashMemory::Physical_Page_Address& plane_address,
			flash_block_ID_type& min_block_id, unsigned int& min_erase_count, flash_block_ID_type& max_block_id, unsigned int& max_erase_count);
		void run_static_wearleveling(const NVM::FlashMemory::Physical_Page_Address plane_address);
		bool use_copyback;
		bool dynamic_wearleveling_enabled;
		bool static_wearleveling_enabled;
		unsigned int static_wearleveling_threshold;

		//Used to implement: "Preemptible I/O Scheduling of Garbage Collection for Solid State Drives", TCAD 2013.
		bool preemptible_gc_enabled;
		double gc_hard_threshold;
		unsigned int block_pool_gc_hard_threshold;
		unsigned int max_ongoing_gc_reqs_per_plane;//This value has two important usages: 1) maximum number of concurrent gc operations per plane, and 2) the value that determines urgent GC execution when there is a shortage of flash blocks. If the block bool size drops below this value, all incomming user writes should be blocked

		//Following variabels are used based on the type of GC block selection policy
		unsigned int rga_set_size;//The number of random flash blocks that are radnomly selected 
		Utils::RandomGenerator random_generator;
		std::queue<Block_Pool_Slot_Type*> block_usage_fifo;
		unsigned int random_pp_threshold;

		unsigned int channel_count;
		unsigned int chip_no_per_channel;
		unsigned int die_no_per_chip;
		unsigned int plane_no_per_die;
		unsigned int block_no_per_plane;
		unsigned int pages_no_per_block;
		unsigned int sector_no_per_page;
	};
}

#endif // !GC_AND_WL_UNIT_BASE_H
