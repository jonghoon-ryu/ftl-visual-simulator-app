#include "Simulation_Events.h"

namespace Simulation_Events
{
	void (*On_mapping_updated)(const Mapping_Updated_Event&) = nullptr;
	void (*On_lpa_trimmed)(const Lpa_Trimmed_Event&) = nullptr;
	void (*On_gc_started)(const GC_Started_Event&) = nullptr;
	void (*On_gc_page_migrated)(const GC_Page_Migrated_Event&) = nullptr;
	void (*On_gc_block_erased)(const GC_Block_Erased_Event&) = nullptr;
	void (*On_wl_started)(const WL_Started_Event&) = nullptr;
	void (*On_wl_page_migrated)(const WL_Page_Migrated_Event&) = nullptr;
	void (*On_wl_block_erased)(const WL_Block_Erased_Event&) = nullptr;
	void (*On_dynamic_wl_block_allocated)(const Dynamic_WL_Block_Allocated_Event&) = nullptr;
	void (*On_dynamic_wl_block_freed)(const Dynamic_WL_Block_Freed_Event&) = nullptr;
}
