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
  chipCount: 1 | 2 | 4 | 8;
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
}

export const DEFAULT_MAPPING_PARAMS: SsdParams = {
  pageCapacityBytes: 4096,
  chipCount: 1,
  // 8 is ParamPanel's MIN_BLOCK_NO_PER_PLANE (the safety margin above the
  // 6-block deadlock boundary - see that constant's comment) - defaulting
  // to it directly rather than some larger "roomier" value keeps the grid
  // small by default, matching this preset's beginner-facing goal. Also
  // DEFAULT_GC_PARAMS' default (spread from this) - confirmed via harness
  // that "GC 시연" still fires GC (4 times) at this block count within its
  // shipped Stop_Time.
  blockNoPerPlane: 8,
  pageNoPerBlock: 16,
  overprovisioningRatio: 0.07,
  gcExecThreshold: 0.05,
  staticWlThreshold: 100,
  addressMapping: 'PAGE_LEVEL',
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
		<Seed>321</Seed>
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
		<GC_Block_Selection_Policy>RGA</GC_Block_Selection_Policy>
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
  // 0-80, not 0-100: verified via native CLI that Read_Percentage=99 (and
  // 100) hangs the simulator outright - reading an LPA that has *never*
  // been written yet (unavoidable at the very start of a fresh device, and
  // increasingly likely near 100% reads) sends MQSim into an infinite loop
  // rather than an error. 95-98 still completed in testing, but the exact
  // boundary depends on RNG/seed interaction with the specific geometry, so
  // 80 keeps a comfortable safety margin (same margin philosophy as
  // MIN_BLOCK_NO_PER_PLANE in ParamPanel.tsx).
  readPercentage: number;
  // Average_Request_Size in pages, 1-64 (matches ParamPanel's Page 당 Page
  // 개수 max) - verified via native CLI up to 64 pages/request with no new
  // deadlock (large bursts just take longer per request, self-limiting
  // throughput rather than exhausting the free-block pool early).
  burstSize: number;
}

export const DEFAULT_WORKLOAD_PARAMS: WorkloadParams = {
  addressDistribution: 'RANDOM_UNIFORM',
  readPercentage: 0,
  burstSize: 8,
};

// One small synthetic write-heavy flow - enough requests to populate the
// mapping table visibly within a couple of steps, small enough to run
// instantly. Stop_Time/Total_Requests_To_Generate both bound it (belt and
// suspenders - during testing only Stop_Time reliably capped a QUEUE_DEPTH
// generator, but both are set here in case that varies by config).
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
			<Read_Percentage>${workload.readPercentage}</Read_Percentage>
			<Address_Distribution>${workload.addressDistribution}</Address_Distribution>
			<Percentage_of_Hot_Region>0</Percentage_of_Hot_Region>
			<Generated_Aligned_Addresses>true</Generated_Aligned_Addresses>
			<Address_Alignment_Unit>${ioAddressAlignmentUnitSectors(params)}</Address_Alignment_Unit>
			<Request_Size_Distribution>FIXED</Request_Size_Distribution>
			<Average_Request_Size>${workload.burstSize}</Average_Request_Size>
			<Variance_Request_Size>0</Variance_Request_Size>
			<Seed>798</Seed>
			<Average_No_of_Reqs_in_Queue>4</Average_No_of_Reqs_in_Queue>
			<Intensity>32768</Intensity>
			<Stop_Time>500000</Stop_Time>
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
// Left at the original pageNoPerBlock-sector value for chipCount 1 (its
// only value before today) so "GC 시연"/"마모평준화 시연"'s already-tuned,
// native-harness-verified trigger counts stay exactly reproducible - this
// unit fix only ever changes behavior for the brand new chipCount>1 case.
function ioAddressAlignmentUnitSectors(params: SsdParams): number {
  if (params.chipCount === 1) return params.pageNoPerBlock;
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
			<Read_Percentage>${workload.readPercentage}</Read_Percentage>
			<Address_Distribution>${workload.addressDistribution}</Address_Distribution>
			<Percentage_of_Hot_Region>0</Percentage_of_Hot_Region>
			<Generated_Aligned_Addresses>true</Generated_Aligned_Addresses>
			<Address_Alignment_Unit>${ioAddressAlignmentUnitSectors(params)}</Address_Alignment_Unit>
			<Request_Size_Distribution>FIXED</Request_Size_Distribution>
			<Average_Request_Size>${workload.burstSize}</Average_Request_Size>
			<Variance_Request_Size>0</Variance_Request_Size>
			<Seed>798</Seed>
			<Average_No_of_Reqs_in_Queue>4</Average_No_of_Reqs_in_Queue>
			<Intensity>32768</Intensity>
			<Stop_Time>6000000000</Stop_Time>
			<Total_Requests_To_Generate>1000000</Total_Requests_To_Generate>
		</IO_Flow_Parameter_Set_Synthetic>
	</IO_Scenario>
</MQSim_IO_Scenarios>
`;
}

// "마모평준화 시연" preset - found via a native step-count harness that
// static wear-leveling was, until now, IMPOSSIBLE to trigger regardless of
// workload or Static_Wearleveling_Threshold: SSD_Device.cpp's construction
// of GC_and_WL_Unit_Page_Level never passed Dynamic_Wearleveling_Enabled/
// Static_Wearleveling_Enabled/Static_Wearleveling_Threshold through from
// the parsed config at all, silently using the class's compiled-in
// defaults (true, true, 100) no matter what ssdconfig.xml said - a real
// upstream bug, fixed in engine/mqsim/src/exec/SSD_Device.cpp (see this
// project's reference docs for the full writeup). With that fixed,
// Static_Wearleveling_Threshold finally does something - but 100 (the
// realistic upstream default) is still unreachable at any demo-sized
// scale, for the structural reason Session 6 already documented: the
// block with the lowest erase count is always either a genuinely never-
// used free block or the live write/GC/translation frontier, and
// is_safe_gc_wl_candidate() (GC_and_WL_Unit_Base.cpp) explicitly rejects
// picking a frontier block as the WL target. So building up a *large*
// gap before some other, non-frontier block becomes the coldest doesn't
// help - what's needed is a *low enough* threshold that WL fires on a
// small, achievable gap instead. staticWlThreshold: 1 confirmed via the
// harness to trigger real WL exactly once by ~1.5M event-groups (64
// blocks, same GC-forcing tuning as "GC 시연") - it does not repeat
// within a further 15M+ event-groups even as the gap keeps growing,
// because the freed block immediately becomes the *new* frontier
// (dynamic wear-leveling prefers reusing the least-worn free block),
// reintroducing the same block ineligibility this preset works around.
// One real, verified WL execution - not a repeating cycle - is what this
// preset can honestly demonstrate at this scale.
export const DEFAULT_WL_PARAMS: SsdParams = {
  ...DEFAULT_MAPPING_PARAMS,
  // Larger than the other presets' 16 - verified via the same harness
  // that 16 blocks stalls out (writes permanently hard-blocked, same
  // mechanism as MIN_BLOCK_NO_PER_PLANE) before enough erases accumulate
  // for even a threshold of 1 to be reachable; 64 sustains well past the
  // point WL fires.
  blockNoPerPlane: 64,
  gcExecThreshold: 0.5,
  staticWlThreshold: 1,
};

export function buildWlWorkloadXml(params: SsdParams, workload: WorkloadParams = DEFAULT_WORKLOAD_PARAMS): string {
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
			<Read_Percentage>${workload.readPercentage}</Read_Percentage>
			<Address_Distribution>${workload.addressDistribution}</Address_Distribution>
			<Percentage_of_Hot_Region>0</Percentage_of_Hot_Region>
			<Generated_Aligned_Addresses>true</Generated_Aligned_Addresses>
			<Address_Alignment_Unit>${ioAddressAlignmentUnitSectors(params)}</Address_Alignment_Unit>
			<Request_Size_Distribution>FIXED</Request_Size_Distribution>
			<Average_Request_Size>${workload.burstSize}</Average_Request_Size>
			<Variance_Request_Size>0</Variance_Request_Size>
			<Seed>798</Seed>
			<Average_No_of_Reqs_in_Queue>4</Average_No_of_Reqs_in_Queue>
			<Intensity>32768</Intensity>
			<Stop_Time>8000000000</Stop_Time>
			<Total_Requests_To_Generate>1000000</Total_Requests_To_Generate>
		</IO_Flow_Parameter_Set_Synthetic>
	</IO_Scenario>
</MQSim_IO_Scenarios>
`;
}
