// Small, single-plane flash geometry for the beginner presets - deliberately
// shrunk from the "realistic" 512GB config (engine/mqsim/ssdconfig.xml: 8
// channels x 4 chips x 2 dies x 2 planes x 2048 blocks) down to one single
// plane, so the flash grid can show every block on screen at once. Same
// real MQSim logic, just simulating a smaller SSD.
//
// Session 9: the knobs the plan calls "page 크기, block/page 개수, OP 비율,
// GC 임계값, 매핑 방식" are now parameterized here instead of hardcoded, so
// ParamPanel.tsx can regenerate this text and reconfigure() the engine.
export interface SsdParams {
  pageCapacityBytes: 4096 | 8192 | 16384;
  // Chip_No_Per_Channel - kept to these 4 options (radio buttons in
  // ParamPanel, not a free slider) since the point is showing a beginner
  // that a "chip" is a unit the FTL spreads work across, not letting them
  // dial in an arbitrary SSD geometry. Channel/die/plane stay hardcoded at
  // 1 (see buildSsdConfigXml) - multi-chip alone is enough to show the
  // per-chip block/wear grouping without also multiplying the flash grid
  // by die/plane counts too.
  chipCount: 1 | 2 | 4;
  blockNoPerPlane: number;
  pageNoPerBlock: number;
  overprovisioningRatio: number; // 0..1
  gcExecThreshold: number; // 0..1
  // erase-count gap (max - min) that triggers static wear-leveling - see
  // DEFAULT_WL_PARAMS' comment for why "마모평준화 시연" needs this far
  // lower than the other presets' shared default of 100.
  staticWlThreshold: number;
  // 'HYBRID' is intentionally not a real option here - MQSim's Hybrid
  // Address_Mapping_Unit is an empty stub nothing constructs (see the
  // comment on Get_mapping_table_snapshot() in MQSim_Interface.cpp) -
  // sending it to configure() would break the engine. ParamPanel.tsx shows
  // it as a visible-but-disabled choice, matching the plan's UI, but only
  // PAGE_LEVEL is ever actually generated here.
  addressMapping: 'PAGE_LEVEL';
  // GC_and_WL_Unit_Page_Level::Check_gc_required()'s victim-block selection
  // policy (Device_Parameter_Set.cpp parses these 6 exact strings, case-
  // insensitive). Was a hardcoded literal 'RGA' in buildSsdConfigXml until
  // Ryu asked to make it adjustable (2026-09-20). All 6 verified via native
  // CLI at this project's demo scale (block=8, chip=2, "GC 시연") the same
  // session this was exposed:
  // - GREEDY and FIFO both crashed ("Inconsistency in the global mapping
  //   table when locking an LPA!") - neither validated its final candidate
  //   against is_safe_gc_wl_candidate() before using it (GREEDY's initial
  //   guess was never checked, only later replacements were; FIFO didn't
  //   check its popped candidate at all, or even that its queue was non-
  //   empty), so each could pick a block still actively serving as a write
  //   frontier. Real, invisible-at-upstream-scale defects, same bucket as
  //   the already-documented RGA bug - fixed in GC_and_WL_Unit_Page_Level.cpp
  //   the same way RGA's own fix works: verify the final pick, skip this GC
  //   opportunity entirely if nothing is confirmed safe.
  // - RGA/RANDOM/RANDOM_P/RANDOM_PP all ran clean, no crashes.
  // - Genuine performance differences confirmed too, not just safety: same
  //   scenario, RGA and GREEDY both reached 20 GC executions; pure RANDOM
  //   only ever reached 1 before the workload wound down; RANDOM_P/PP
  //   reached 3. (RANDOM_PP is functionally identical to RANDOM_P in this
  //   project specifically - its extra "minimum invalid pages" condition is
  //   scaled by Initial_Occupancy_Percentage, which every preset here sets
  //   to 0, making that condition always trivially true.)
  gcBlockSelectionPolicy: 'GREEDY' | 'RGA' | 'RANDOM' | 'RANDOM_P' | 'RANDOM_PP' | 'FIFO';
  // Device_Parameter_Set's own Seed - seeds MQSim's internal RNG (GC
  // candidate sampling for RANDOM*/RGA policies, dynamic WL tie-breaks,
  // etc.). Was a hardcoded literal 321 in buildSsdConfigXml for every
  // preset until Ryu asked to make it adjustable - default here preserves
  // that exact original value.
  deviceSeed: number;
  // IO_Flow_Parameter_Set_Synthetic's own Seed - seeds the synthetic
  // workload generator (which LPAs get read/written, in what order). Was a
  // hardcoded literal 798 in all three workload builders - default here
  // preserves that exact original value.
  workloadSeed: number;
}

export const DEFAULT_MAPPING_PARAMS: SsdParams = {
  pageCapacityBytes: 4096,
  // 2, not 1 - Ryu's explicit choice (2026-09-20) to have the FlashGrid
  // show chip-to-chip differences (now visually distinguishable via
  // FlashGrid's per-chip badge/free-cell colors) by default rather than
  // only when manually switched on.
  chipCount: 2,
  // 12, not 8 (2026-09-20, raised alongside Overprovisioning_Ratio 7%->10%
  // and max_ongoing_gc_reqs_per_plane 4->3, see that constant's comment in
  // SSD_Device.cpp) - at block=8 the GC_Exec_Threshold slider's entire
  // 0-50% range collapsed into one identical result (the clamp dominated),
  // making most of the slider a no-op; this combination gives it a real,
  // distinguishable low end again. Originally 8 (ParamPanel's
  // MIN_BLOCK_NO_PER_PLANE) for a more compact grid - known tradeoff at
  // that size (see the harness finding this replaces): at 8 blocks + 100%
  // working set, "매핑 기본"'s device fills and hard-blocks writes before
  // its own tiny Stop_Time (below) elapses, so the demo ends when the
  // device fills rather than when Stop_Time is reached - raising Stop_Time
  // further would not extend it. Re-verify GC 시연's execution count
  // against this block count if that preset's behavior ever looks off,
  // since DEFAULT_GC_PARAMS spreads chipCount/blockNoPerPlane from this
  // default too.
  blockNoPerPlane: 12,
  pageNoPerBlock: 16,
  // 10%, not 7% (2026-09-20, see blockNoPerPlane's comment above for why).
  overprovisioningRatio: 0.1,
  gcExecThreshold: 0.05,
  staticWlThreshold: 100,
  addressMapping: 'PAGE_LEVEL',
  gcBlockSelectionPolicy: 'RGA',
  deviceSeed: 321,
  workloadSeed: 798,
};

export function buildSsdConfigXml(params: SsdParams): string {
  return `<?xml version="1.0" encoding="us-ascii"?>
<Execution_Parameter_Set>
	<Host_Parameter_Set>
		<PCIe_Lane_Bandwidth>1.00000</PCIe_Lane_Bandwidth>
		<PCIe_Lane_Count>4</PCIe_Lane_Count>
		<SATA_Processing_Delay>400000</SATA_Processing_Delay>
		<Enable_ResponseTime_Logging>false</Enable_ResponseTime_Logging>
		<ResponseTime_Logging_Period_Length>1000000</ResponseTime_Logging_Period_Length>
	</Host_Parameter_Set>
	<Device_Parameter_Set>
		<Seed>${params.deviceSeed}</Seed>
		<Enabled_Preconditioning>false</Enabled_Preconditioning>
		<Memory_Type>FLASH</Memory_Type>
		<HostInterface_Type>NVME</HostInterface_Type>
		<IO_Queue_Depth>65535</IO_Queue_Depth>
		<Queue_Fetch_Size>512</Queue_Fetch_Size>
		<Caching_Mechanism>ADVANCED</Caching_Mechanism>
		<Data_Cache_Sharing_Mode>SHARED</Data_Cache_Sharing_Mode>
		<Data_Cache_Capacity>268435456</Data_Cache_Capacity>
		<Data_Cache_DRAM_Row_Size>8192</Data_Cache_DRAM_Row_Size>
		<Data_Cache_DRAM_Data_Rate>100</Data_Cache_DRAM_Data_Rate>
		<Data_Cache_DRAM_Data_Busrt_Size>1</Data_Cache_DRAM_Data_Busrt_Size>
		<Data_Cache_DRAM_tRCD>13</Data_Cache_DRAM_tRCD>
		<Data_Cache_DRAM_tCL>13</Data_Cache_DRAM_tCL>
		<Data_Cache_DRAM_tRP>13</Data_Cache_DRAM_tRP>
		<Address_Mapping>${params.addressMapping}</Address_Mapping>
		<Ideal_Mapping_Table>false</Ideal_Mapping_Table>
		<CMT_Capacity>2097152</CMT_Capacity>
		<CMT_Sharing_Mode>SHARED</CMT_Sharing_Mode>
		<Plane_Allocation_Scheme>CWDP</Plane_Allocation_Scheme>
		<Transaction_Scheduling_Policy>PRIORITY_OUT_OF_ORDER</Transaction_Scheduling_Policy>
		<Overprovisioning_Ratio>${params.overprovisioningRatio.toFixed(5)}</Overprovisioning_Ratio>
		<GC_Exec_Threshold>${params.gcExecThreshold.toFixed(5)}</GC_Exec_Threshold>
		<GC_Block_Selection_Policy>${params.gcBlockSelectionPolicy}</GC_Block_Selection_Policy>
		<Use_Copyback_for_GC>false</Use_Copyback_for_GC>
		<Preemptible_GC_Enabled>false</Preemptible_GC_Enabled>
		<GC_Hard_Threshold>0.005000</GC_Hard_Threshold>
		<Dynamic_Wearleveling_Enabled>true</Dynamic_Wearleveling_Enabled>
		<Static_Wearleveling_Enabled>true</Static_Wearleveling_Enabled>
		<Static_Wearleveling_Threshold>${params.staticWlThreshold}</Static_Wearleveling_Threshold>
		<Preferred_suspend_erase_time_for_read>700000</Preferred_suspend_erase_time_for_read>
		<Preferred_suspend_erase_time_for_write>700000</Preferred_suspend_erase_time_for_write>
		<Preferred_suspend_write_time_for_read>100000</Preferred_suspend_write_time_for_read>
		<Flash_Channel_Count>1</Flash_Channel_Count>
		<Flash_Channel_Width>1</Flash_Channel_Width>
		<Channel_Transfer_Rate>333</Channel_Transfer_Rate>
		<Chip_No_Per_Channel>${params.chipCount}</Chip_No_Per_Channel>
		<Flash_Comm_Protocol>NVDDR2</Flash_Comm_Protocol>
		<Flash_Parameter_Set>
			<Flash_Technology>MLC</Flash_Technology>
			<CMD_Suspension_Support>ERASE</CMD_Suspension_Support>
			<Page_Read_Latency_LSB>75000</Page_Read_Latency_LSB>
			<Page_Read_Latency_CSB>75000</Page_Read_Latency_CSB>
			<Page_Read_Latency_MSB>75000</Page_Read_Latency_MSB>
			<Page_Program_Latency_LSB>750000</Page_Program_Latency_LSB>
			<Page_Program_Latency_CSB>750000</Page_Program_Latency_CSB>
			<Page_Program_Latency_MSB>750000</Page_Program_Latency_MSB>
			<Block_Erase_Latency>3800000</Block_Erase_Latency>
			<Block_PE_Cycles_Limit>10000</Block_PE_Cycles_Limit>
			<Suspend_Erase_Time>700000</Suspend_Erase_Time>
			<Suspend_Program_Time>100000</Suspend_Program_Time>
			<Die_No_Per_Chip>1</Die_No_Per_Chip>
			<Plane_No_Per_Die>1</Plane_No_Per_Die>
			<Block_No_Per_Plane>${params.blockNoPerPlane}</Block_No_Per_Plane>
			<Page_No_Per_Block>${params.pageNoPerBlock}</Page_No_Per_Block>
			<Page_Capacity>${params.pageCapacityBytes}</Page_Capacity>
			<Page_Metadat_Capacity>448</Page_Metadat_Capacity>
		</Flash_Parameter_Set>
	</Device_Parameter_Set>
</Execution_Parameter_Set>
`;
}

// Session 10: the workload generator knobs the plan calls "sequential/
// random, read/write 비율, burst 크기" - independent of SsdParams (device
// geometry) and layered on top of each preset's own tuned Working_Set/
// Stop_Time/Total_Requests values below, the same way ParamPanel's SsdParams
// layer on top of a fixed base config.
export interface WorkloadParams {
  // MQSim's Utils::Address_Distribution_Type - only these two are exposed
  // ("sequential"/"random"); MIXED_STREAMING_RANDOM and RANDOM_HOTCOLD are
  // real modes but outside the plan's beginner-facing two-way toggle.
  addressDistribution: 'RANDOM_UNIFORM' | 'STREAMING';
}

export const DEFAULT_WORKLOAD_PARAMS: WorkloadParams = {
  addressDistribution: 'RANDOM_UNIFORM',
};

// Hardcoded to 0 - a "Read 비율" (Read_Percentage) UI control existed
// briefly (2026-09-20) but was removed. Found while testing it: a read
// that lands on an LPA with no mapping yet doesn't just fail or return
// empty - online_create_entry_for_reads() (Address_Mapping_Unit_Page_
// Level.cpp) silently reserves a real page for it via the exact same
// allocation function a write uses (Allocate_block_and_page_in_plane_
// for_user_write), consuming free-pool capacity identically to a write,
// with no Program command ever issued. This is MQSim's lazy stand-in for
// the Perform_preconditioning() pass this project skips (Enabled_
// Preconditioning=false, for demo speed) - real preconditioning eagerly
// pre-writes the device before timed measurement so no read ever hits
// unmapped territory; this project's beginner-facing demos hit that case
// constantly instead, especially right at the start of a run, which is
// confusing (a "Read" silently creating a valid page from nothing) and
// unrelated to what the GC/WL demos are meant to show. Also verified
// via native CLI that Read_Percentage=99-100 hangs the simulator outright
// for the same underlying reason (reading a never-written LPA repeatedly
// near 100% reads). At the hardcoded 0 this class of read never happens.
const READ_PERCENTAGE = 0;

// Average_Request_Size is in 512B sectors (IO_Flow_Synthetic.cpp's
// average_request_size_sector / request->LBA_count), not pages. A "burst
// 크기" (page count) UI control existed briefly (2026-09-20) but was
// removed: correctly converting it to sectors made every request take
// noticeably longer to service, which pushed the small demo-scale device
// (block count 8) into a real, still-uninvestigated stall in TSU_FLIN's
// scheduler - not reachable at this project's previous 16-block default,
// and not something to expose in the UI before that engine-level bug is
// found and fixed. Hardcoded to 1 sector (a fraction of a page - MQSim
// still services it as a single-page write) to exactly match the
// unconverted behavior every preset already shipped with.
const AVERAGE_REQUEST_SIZE_SECTORS = 1;

// One small synthetic write-heavy flow to populate the mapping table.
// Total_Requests_To_Generate is set but doesn't actually do anything -
// IO_Flow_Synthetic::Generate_next_request() only ever checks it in an
// `else` branch that's unreachable whenever Stop_Time > 0 (which it always
// is here) - Stop_Time is the only real limiter. It was raised from the
// original 500000 (~15s of playback at DEFAULT_MAPPING_PARAMS' block count)
// to 5000000 (~30s) since the original was deliberately "small enough to
// run instantly", which ended up reading as "too short" - see
// DEFAULT_MAPPING_PARAMS' own comment for why the block count needed to go
// up too for this to have any effect (QUEUE_DEPTH is demand-driven: once
// the device fills and hard-blocks writes, nothing ever completes to
// trigger generating the next one, so the run goes idle regardless of how
// large Stop_Time is - raising Stop_Time alone, confirmed via harness, did
// nothing at the old block count). Raised again 10x, to 50000000
// (2026-09-20, after DEFAULT_MAPPING_PARAMS' block count went to 12) -
// Ryu found the number of pages actually written felt too small; confirmed
// via native CLI this is genuinely Stop_Time-bound now (not capacity-bound
// - block=12 leaves plenty of headroom below the ~345-logical-page usable
// capacity), and 10x Stop_Time gave ~5.5x more writes (33->183 requests),
// close to the 5x Ryu asked for.
// Address_Alignment_Unit - see ioAddressAlignmentUnitSectors() below for why
// this isn't simply pageNoPerBlock once chipCount > 1.
export function buildMappingWorkloadXml(params: SsdParams, workload: WorkloadParams = DEFAULT_WORKLOAD_PARAMS): string {
  return `<?xml version="1.0" encoding="us-ascii"?>
<MQSim_IO_Scenarios>
	<IO_Scenario>
		<IO_Flow_Parameter_Set_Synthetic>
			<Priority_Class>HIGH</Priority_Class>
			<Device_Level_Data_Caching_Mode>WRITE_CACHE</Device_Level_Data_Caching_Mode>
			<Channel_IDs>0</Channel_IDs>
			<Chip_IDs>${chipIdsXml(params)}</Chip_IDs>
			<Die_IDs>0</Die_IDs>
			<Plane_IDs>0</Plane_IDs>
			<Initial_Occupancy_Percentage>0</Initial_Occupancy_Percentage>
			<Working_Set_Percentage>100</Working_Set_Percentage>
			<Synthetic_Generator_Type>QUEUE_DEPTH</Synthetic_Generator_Type>
			<Read_Percentage>${READ_PERCENTAGE}</Read_Percentage>
			<Address_Distribution>${workload.addressDistribution}</Address_Distribution>
			<Percentage_of_Hot_Region>0</Percentage_of_Hot_Region>
			<Generated_Aligned_Addresses>true</Generated_Aligned_Addresses>
			<Address_Alignment_Unit>${ioAddressAlignmentUnitSectors(params)}</Address_Alignment_Unit>
			<Request_Size_Distribution>FIXED</Request_Size_Distribution>
			<Average_Request_Size>${AVERAGE_REQUEST_SIZE_SECTORS}</Average_Request_Size>
			<Variance_Request_Size>0</Variance_Request_Size>
			<Seed>${params.workloadSeed}</Seed>
			<Average_No_of_Reqs_in_Queue>4</Average_No_of_Reqs_in_Queue>
			<Intensity>32768</Intensity>
			<Stop_Time>50000000</Stop_Time>
			<Total_Requests_To_Generate>200</Total_Requests_To_Generate>
		</IO_Flow_Parameter_Set_Synthetic>
	</IO_Scenario>
</MQSim_IO_Scenarios>
`;
}

// Every workload builder below restricts its IO flow to Chip_IDs "0" - fine
// while chipCount was always 1, but with multi-chip support that would
// leave chips 1..N-1 completely idle (Chip_IDs is a resource-partitioning
// list, not a count - see IO_Flow_Parameter_Set.cpp). Spread the flow across
// every configured chip so multi-chip actually shows blocks/erases on more
// than just chip 0.
function chipIdsXml(params: SsdParams): string {
  return Array.from({ length: params.chipCount }, (_, i) => i).join(',');
}

// IO_Flow_Synthetic.cpp's Address_Alignment_Unit is in *sectors*
// (SECTOR_SIZE_IN_BYTE=512, see FTL::Convert_host_logical_address_to_
// device_address()'s lha/page_size_in_sectors division), not pages - a real
// unit mismatch that was invisible with a single chip (Address_Mapping_
// Unit_Page_Level.cpp's CWDP scheme always picks Chip_ids[lpn % 1] = index
// 0 regardless of lpn's value) but breaks multi-chip: aligning to
// pageNoPerBlock *sectors* forces every generated LPA to a multiple of
// pageNoPerBlock/sectorsPerPage pages (e.g. every-other page at the default
// 4KB/16-page config), so `lpn % chipCount` only ever lands on the even
// residues - verified via a WASM harness that chipCount=2/4/8 all left
// exactly half their chips permanently empty. Aligning to exactly one page
// (sectorsPerPage sectors) instead removes that forced stride, and was
// confirmed via the same harness to reach every configured chip.
// Was left at the pageNoPerBlock-sector value for chipCount 1 for a while
// (see git history) specifically to avoid re-tuning "GC 시연"/"마모평준화
// 시연"'s already-verified trigger counts - that was the wrong call to
// leave standing: aligning to pageNoPerBlock (16) sectors at the default
// 4KB page (8 sectors/page) meant every host-generated address landed on
// an *even* page only, so half of every block's pages were only ever
// reachable via a GC/WL migration copy, never a fresh host write. Fixed to
// always align to exactly one page's worth of sectors, chipCount
// regardless. Re-swept both GC-driven presets via the native CLI with this
// fix (same ssdconfig.xml/workload.xml this project always uses for that -
// see run-regression-tests.sh) since finer-grained addressing changes how
// often RANDOM_UNIFORM writes collide within each preset's working set:
// - "매핑 기본" (100% working set): 0 GC/0 WL both before and after -
//   unaffected, no re-tuning needed.
// - "GC 시연": 12 → 31 GC executions, avg page movement/execution 5.08 →
//   7.19 (see DEFAULT_GC_PARAMS' doc comment - those were this session's
//   just-established numbers, now superseded).
// - "마모평준화 시연": 29 → 92 GC executions (avg page movement 0.0 → 0.65,
//   i.e. some of these now do real migrations too, previously none did),
//   WL executions unchanged at exactly 1 (avg movement 0.0 both times) -
//   see DEFAULT_WL_PARAMS' doc comment, that specific invariant still holds.
function ioAddressAlignmentUnitSectors(params: SsdParams): number {
  return params.pageCapacityBytes / 512;
}

// Backwards-compatible fixed exports for any code that hasn't moved to the
// parameterized builders yet.
export const mappingBasicSsdConfigXml = buildSsdConfigXml(DEFAULT_MAPPING_PARAMS);
export const mappingBasicWorkloadXml = buildMappingWorkloadXml(DEFAULT_MAPPING_PARAMS);

// "GC 시연" preset - same small geometry, but a much higher GC_Exec_Threshold
// (block_pool_gc_threshold = floor(gcExecThreshold * blockNoPerPlane) - the
// default 0.05 needs the pool down to its last 1-2 blocks before GC ever
// looks at firing, unreachable in a demo-sized run).
//
// 0.5 (50%), not the earlier 0.8 (2026-09-20, alongside raising
// blockNoPerPlane to 12 and max_ongoing_gc_reqs_per_plane's clamp down to 3
// - see those defaults' own comments). Re-swept via native CLI at this new
// geometry: 5-30% all fire GC but with Average_Page_Movement_For_GC=0.0
// (every execution just reclaims an already-fully-invalid block - no
// migration ever visible, the same failure mode this preset's threshold
// was raised to fix once before). Real migrations start at 40% (0.45 avg)
// and become clearly visible from 50% (4.3 avg) onward - chosen as the
// lowest value where the moving-page highlight (useMqsimMigrations)
// reliably has something to show, while leaving the slider's low end
// (previously a total no-op at block=8) genuinely explorable.
export const DEFAULT_GC_PARAMS: SsdParams = {
  ...DEFAULT_MAPPING_PARAMS,
  gcExecThreshold: 0.5,
};

// Same synthetic write flow as buildMappingWorkloadXml, but tuned to
// actually trigger GC live rather than just fill the mapping table:
// - Working_Set_Percentage narrowed to 25% of the address space, so
//   RANDOM_UNIFORM writes collide (overwrite the same LPA) often enough to
//   produce invalid pages - GC_and_WL_Unit_Page_Level::Check_gc_required()
//   silently no-ops if its randomly-sampled candidate block has zero
//   invalid pages to reclaim, which is what happens at the default 100%
//   working set (writes almost never repeat an address, so there's
//   nothing for GC to usefully collect even once the free-block threshold
//   is crossed). See the reconfigure-crash-bug writeup's companion
//   investigation for how this was found.
// - Stop_Time raised enough to let GC actually fire. Originally 2.5e9 (~950k
//   event-groups) based on this project's own now-corrected assumption that
//   GC would trigger well within that budget - it doesn't, and never did:
//   MQSim's undocumented max_ongoing_gc_reqs_per_plane=10 clamps GC's own
//   threshold (floor(0.5 * 16) = 8) up to 10, making it collide exactly with
//   the same constant's hard write-block floor and permanently deadlocking
//   this preset with 0 GC executions - see /ftl-visual-simulator/reference/
//   tweaked-code/ for the engine-side fix (that constant lowered to 4).
//   Even with that fixed, 2.5e9 still isn't long enough for occupancy to
//   reach GC's threshold at all - raised to 6e9 (~2.3M event-groups,
//   measured via a WASM harness), giving ~5 GC executions - hence the much
//   higher default playback speed App.tsx uses for this preset (see
//   useSimulationPlayback's ticksMultiplier). How many times GC executes
//   depends on DEFAULT_MAPPING_PARAMS' block count/page size (smaller
//   geometry = less occupancy pressure = fewer GC runs before Stop_Time) -
//   re-measure if those defaults change again.
export function buildGcWorkloadXml(params: SsdParams, workload: WorkloadParams = DEFAULT_WORKLOAD_PARAMS): string {
  return `<?xml version="1.0" encoding="us-ascii"?>
<MQSim_IO_Scenarios>
	<IO_Scenario>
		<IO_Flow_Parameter_Set_Synthetic>
			<Priority_Class>HIGH</Priority_Class>
			<Device_Level_Data_Caching_Mode>WRITE_CACHE</Device_Level_Data_Caching_Mode>
			<Channel_IDs>0</Channel_IDs>
			<Chip_IDs>${chipIdsXml(params)}</Chip_IDs>
			<Die_IDs>0</Die_IDs>
			<Plane_IDs>0</Plane_IDs>
			<Initial_Occupancy_Percentage>0</Initial_Occupancy_Percentage>
			<Working_Set_Percentage>25</Working_Set_Percentage>
			<Synthetic_Generator_Type>QUEUE_DEPTH</Synthetic_Generator_Type>
			<Read_Percentage>${READ_PERCENTAGE}</Read_Percentage>
			<Address_Distribution>${workload.addressDistribution}</Address_Distribution>
			<Percentage_of_Hot_Region>0</Percentage_of_Hot_Region>
			<Generated_Aligned_Addresses>true</Generated_Aligned_Addresses>
			<Address_Alignment_Unit>${ioAddressAlignmentUnitSectors(params)}</Address_Alignment_Unit>
			<Request_Size_Distribution>FIXED</Request_Size_Distribution>
			<Average_Request_Size>${AVERAGE_REQUEST_SIZE_SECTORS}</Average_Request_Size>
			<Variance_Request_Size>0</Variance_Request_Size>
			<Seed>${params.workloadSeed}</Seed>
			<Average_No_of_Reqs_in_Queue>4</Average_No_of_Reqs_in_Queue>
			<Intensity>32768</Intensity>
			<Stop_Time>6000000000</Stop_Time>
			<Total_Requests_To_Generate>1000000</Total_Requests_To_Generate>
		</IO_Flow_Parameter_Set_Synthetic>
	</IO_Scenario>
</MQSim_IO_Scenarios>
`;
}

// "마모평준화 시연" preset.
//
// History, briefly: static WL was first IMPOSSIBLE to trigger (SSD_Device.cpp
// never passed Static_Wearleveling_Threshold through - see the
// wl-threshold-not-wired-bug writeup), then could only ever fire ONCE per run
// at threshold 1, and never at 2+. The "only once" part was blamed on the
// freed block becoming the new write frontier - that explanation was wrong
// (2026-09-24). The real cause was upstream's target selection: it only ever
// looked at the plane-wide coldest block (lowest ID on ties), which is almost
// always an unwritten frontier (e.g. the Translation_wf - the whole mapping
// table fits in the CMT, so it's never programmed and sits at erase count 0
// forever). is_safe_gc_wl_candidate() rejects it, and upstream then simply
// gave up - every time, for the rest of the run. Fixed in
// GC_and_WL_Unit_Base::get_static_wl_erase_info() (only blocks that hold
// data and are safe candidates count as "coldest").
//
// With that fixed, the old single uniform-random flow turned out to be the
// wrong workload for this demo anyway: dynamic WL (always reuse the
// least-worn free block) keeps wear nearly flat under uniform random writes,
// so the erase-count gap never grows past 1-2 - at threshold 1 WL then fires
// ~150 times per run (pure churn), at 3 never. Static WL exists for the
// opposite case: data written once and never touched again, pinning its
// blocks at a low erase count while everything else cycles. So this preset
// now runs TWO flows (MQSim splits the logical address space evenly between
// them, each flow is its own stream with its own write frontiers, so their
// data never shares a block):
// - flow 0 ("cold"): STREAMING over half its region, exactly one write per
//   page, then stops for good (Stop_Time 0 makes Total_Requests_To_Generate
//   the limit - see IO_Flow_Synthetic::Generate_next_request()). Caching
//   TURNED_OFF, or the (huge, 256MB) DRAM write cache would absorb all of it
//   and it would never reach flash at all.
// - flow 1 ("hot"): the same random overwrite traffic the preset always had
//   (25% of the whole device = 50% of its own half), for the whole run.
// Verified via native CLI at the defaults below (24 blocks, threshold 3):
// cold blocks stay at 0 erases while hot ones keep cycling, and static WL
// fires 7 times, each relocating a full block (16 pages) of cold data - real
// static wear-leveling, not the 0-1-page moves the old setup produced.
// Threshold 4 fires 5 times at this Stop_Time; 5+ need a longer run (at 4x
// Stop_Time, threshold 5 fires 11 times). The stall that used to cut such
// runs off around 9e9 is fixed (2026-09-24) - it was several upstream
// MQSim bugs, not one: barrier-released writes never reaching the data
// cache manager, a parked GC/WL never submitting its erase, overfull-plane
// writes bypassing the GC/WL LPA barrier, and no GC re-check once a
// plane's writes all stalled.
export const DEFAULT_WL_PARAMS: SsdParams = {
  ...DEFAULT_MAPPING_PARAMS,
  // Pinned to 1, not DEFAULT_MAPPING_PARAMS' 2 - static WL compares erase
  // counts within one plane, so a single chip keeps the whole story in one
  // list of blocks.
  chipCount: 1,
  // 24, not the original 64 (2026-09-20) - Ryu found 64 rows in
  // WearLevelingView too many to scan at a glance.
  blockNoPerPlane: 24,
  gcExecThreshold: 0.5,
  staticWlThreshold: 3,
};

// ParamPanel's 마모평준화 임계값 slider range - only shown for this preset.
export const STATIC_WL_THRESHOLD_RANGE = { min: 1, max: 10 };

// Share of each flow's own half of the address space it touches - see
// DEFAULT_WL_PARAMS' comment.
const WL_COLD_WORKING_SET_PERCENT = 50;
const WL_HOT_WORKING_SET_PERCENT = 50;
const WL_HOT_STOP_TIME = 8000000000;

// How many one-page writes flow 0 issues: one per logical page of its
// working set (logical capacity = physical x (1 - OP), split evenly across
// the two flows), minus one so rounding in MQSim's own region-size math can
// never make the sequential stream wrap around and overwrite its first page.
function wlColdWriteCount(params: SsdParams): number {
  const physicalPages = params.chipCount * params.blockNoPerPlane * params.pageNoPerBlock;
  const logicalPagesPerFlow = (physicalPages * (1 - params.overprovisioningRatio)) / 2;
  return Math.max(1, Math.floor((logicalPagesPerFlow * WL_COLD_WORKING_SET_PERCENT) / 100) - 1);
}

interface SyntheticFlowOptions {
  cachingMode: 'WRITE_CACHE' | 'TURNED_OFF';
  workingSetPercent: number;
  addressDistribution: WorkloadParams['addressDistribution'];
  seed: number;
  stopTime: number;
  totalRequests: number;
}

function syntheticFlowXml(params: SsdParams, flow: SyntheticFlowOptions): string {
  return `
		<IO_Flow_Parameter_Set_Synthetic>
			<Priority_Class>HIGH</Priority_Class>
			<Device_Level_Data_Caching_Mode>${flow.cachingMode}</Device_Level_Data_Caching_Mode>
			<Channel_IDs>0</Channel_IDs>
			<Chip_IDs>${chipIdsXml(params)}</Chip_IDs>
			<Die_IDs>0</Die_IDs>
			<Plane_IDs>0</Plane_IDs>
			<Initial_Occupancy_Percentage>0</Initial_Occupancy_Percentage>
			<Working_Set_Percentage>${flow.workingSetPercent}</Working_Set_Percentage>
			<Synthetic_Generator_Type>QUEUE_DEPTH</Synthetic_Generator_Type>
			<Read_Percentage>${READ_PERCENTAGE}</Read_Percentage>
			<Address_Distribution>${flow.addressDistribution}</Address_Distribution>
			<Percentage_of_Hot_Region>0</Percentage_of_Hot_Region>
			<Generated_Aligned_Addresses>true</Generated_Aligned_Addresses>
			<Address_Alignment_Unit>${ioAddressAlignmentUnitSectors(params)}</Address_Alignment_Unit>
			<Request_Size_Distribution>FIXED</Request_Size_Distribution>
			<Average_Request_Size>${AVERAGE_REQUEST_SIZE_SECTORS}</Average_Request_Size>
			<Variance_Request_Size>0</Variance_Request_Size>
			<Seed>${flow.seed}</Seed>
			<Average_No_of_Reqs_in_Queue>4</Average_No_of_Reqs_in_Queue>
			<Intensity>32768</Intensity>
			<Stop_Time>${flow.stopTime}</Stop_Time>
			<Total_Requests_To_Generate>${flow.totalRequests}</Total_Requests_To_Generate>
		</IO_Flow_Parameter_Set_Synthetic>`;
}

// Stream 0 = cold, stream 1 = hot (flow order) - WearLevelingView labels
// blocks by exactly this.
export const WL_COLD_STREAM_ID = 0;
export const WL_HOT_STREAM_ID = 1;

// WorkloadPanel's 접근 패턴 only applies to the hot flow - the cold flow is
// sequential by design (write every page of its region exactly once).
export function buildWlWorkloadXml(params: SsdParams, workload: WorkloadParams = DEFAULT_WORKLOAD_PARAMS): string {
  const cold = syntheticFlowXml(params, {
    cachingMode: 'TURNED_OFF',
    workingSetPercent: WL_COLD_WORKING_SET_PERCENT,
    addressDistribution: 'STREAMING',
    seed: params.workloadSeed,
    stopTime: 0,
    totalRequests: wlColdWriteCount(params),
  });
  const hot = syntheticFlowXml(params, {
    cachingMode: 'WRITE_CACHE',
    workingSetPercent: WL_HOT_WORKING_SET_PERCENT,
    addressDistribution: workload.addressDistribution,
    seed: params.workloadSeed + 1,
    stopTime: WL_HOT_STOP_TIME,
    totalRequests: 1000000,
  });
  return `<?xml version="1.0" encoding="us-ascii"?>
<MQSim_IO_Scenarios>
	<IO_Scenario>${cold}${hot}
	</IO_Scenario>
</MQSim_IO_Scenarios>
`;
}
