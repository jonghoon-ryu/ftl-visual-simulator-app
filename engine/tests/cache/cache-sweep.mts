// Measures how the SSD's DRAM data-cache size changes each preset: host
// requests vs flash writes, GC/WL executions, total event-groups (what ▶'s
// ticksMultiplier is tuned against), and how "bursty" flash activity looks
// on screen - the share of ▶ ticks (speed 8) in which nothing reached flash.
// Run: node --experimental-strip-types engine/tests/cache/cache-sweep.mts [pages...]
// (needs src/wasm-build from engine/build-wasm.sh). With no arguments it
// compares the old fixed 256 MB cache against a few page counts.
import createModule from '../../../src/wasm-build/mqsim.mjs';
import {
  buildGcWorkloadXml,
  buildMappingWorkloadXml,
  buildSsdConfigXml,
  buildWlWorkloadXml,
  DEFAULT_GC_PARAMS,
  DEFAULT_MAPPING_PARAMS,
  DEFAULT_WL_PARAMS,
  DEFAULT_WORKLOAD_PARAMS,
  type SsdParams,
} from '../../../src/data/mqsimConfigs.ts';

const mod: any = await createModule();
let flashWrites = 0;
mod.setEventCallback((e: any) => {
  if (e.type === 'mapping_updated' && e.isWrite) flashWrites++;
});

const presets: { id: string; params: SsdParams; workload: (p: SsdParams) => string; groupsPerTick: number }[] = [
  { id: 'mapping', params: DEFAULT_MAPPING_PARAMS, workload: (p) => buildMappingWorkloadXml(p, DEFAULT_WORKLOAD_PARAMS), groupsPerTick: 8 },
  { id: 'gc', params: DEFAULT_GC_PARAMS, workload: (p) => buildGcWorkloadXml(p, DEFAULT_WORKLOAD_PARAMS), groupsPerTick: 0 },
  { id: 'wear-leveling', params: DEFAULT_WL_PARAMS, workload: (p) => buildWlWorkloadXml(p, DEFAULT_WORKLOAD_PARAMS), groupsPerTick: 0 },
];

// 'old' = the fixed 268435456-byte capacity buildSsdConfigXml used before
// the cache became a page count; numbers = Data_Cache_Capacity in pages.
const sizes: (number | 'old')[] = process.argv.length > 2 ? process.argv.slice(2).map(Number) : ['old', 64, 32, 16];
const TICKS_TARGET = 180; // ▶ at speed 8 should take roughly this many 300 ms ticks

for (const preset of presets) {
  for (const size of sizes) {
    let ssd = buildSsdConfigXml(preset.params);
    const bytes = size === 'old' ? 268435456 : size * preset.params.pageCapacityBytes;
    ssd = ssd.replace(/<Data_Cache_Capacity>\d+<\/Data_Cache_Capacity>/, `<Data_Cache_Capacity>${bytes}</Data_Cache_Capacity>`);
    flashWrites = 0;
    mod.init(ssd, preset.workload(preset.params));
    // Walk in small chunks to record flash writes per chunk, then fold
    // chunks into ▶ ticks once the total length (and so the multiplier
    // that would give ~TICKS_TARGET ticks) is known.
    const CHUNK = 2000;
    const perChunk: number[] = [];
    let more = true;
    while (more) {
      const before = flashWrites;
      more = mod.run(CHUNK);
      perChunk.push(flashWrites - before);
    }
    const groups = perChunk.length * CHUNK;
    const s = mod.getState().stats;
    const chunksPerTick = Math.max(1, Math.round(groups / TICKS_TARGET / CHUNK));
    const ticks: number[] = [];
    for (let i = 0; i < perChunk.length; i += chunksPerTick) ticks.push(perChunk.slice(i, i + chunksPerTick).reduce((a, b) => a + b, 0));
    const idle = ticks.filter((n) => n === 0).length;
    let longest = 0;
    let run = 0;
    for (const n of ticks) {
      run = n === 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    console.log(
      [
        preset.id.padEnd(13),
        `cache=${String(size).padStart(4)}`,
        `host=${String(s.hostRequestsServiced).padStart(8)}`,
        `flash=${String(flashWrites).padStart(6)}`,
        `gc=${String(s.gcExecutions).padStart(4)}`,
        `wl=${String(s.wlExecutions).padStart(3)}`,
        `waiting=${s.writesWaitingForSpace}`,
        `groups≈${groups}`,
        `mult@180ticks≈${Math.round(groups / TICKS_TARGET / 8)}`,
        `idleTicks=${idle}/${ticks.length}`,
        `longestIdle=${longest}`,
      ].join('  '),
    );
  }
}
