// How many host reads reach flash (and so get a read outline / "Read" log
// line) per preset and read ratio, vs reads served without touching flash.
// Run: node --experimental-strip-types engine/tests/cache/reads.mts
import createModule from '../../../src/wasm-build/mqsim.mjs';
import * as C from '../../../src/data/mqsimConfigs.ts';
const mod: any = await createModule();
let flashReads = 0, firstReadEvent = -1, events = 0;
mod.setEventCallback((e: any) => { events++; if (e.type === 'mapping_updated' && !e.isWrite) { flashReads++; if (firstReadEvent < 0) firstReadEvent = events; } });
const presets = [
  ['mapping', C.DEFAULT_MAPPING_PARAMS, C.buildMappingWorkloadXml],
  ['gc', C.DEFAULT_GC_PARAMS, C.buildGcWorkloadXml],
  ['wear-leveling', C.DEFAULT_WL_PARAMS, C.buildWlWorkloadXml],
] as const;
for (const [id, p, wl] of presets) for (const pct of [30, 50]) for (const cache of [true, false]) {
  flashReads = 0; firstReadEvent = -1; events = 0;
  mod.init(C.buildSsdConfigXml(p), (wl as any)(p, { ...C.DEFAULT_WORKLOAD_PARAMS, readPercentage: pct, writeCache: cache }));
  while (mod.run(100000)) {}
  const s = mod.getState().stats;
  console.log(`${id.padEnd(13)} read=${pct}% cache=${cache ? 'on ' : 'off'} hostReq=${s.hostRequestsServiced} readsServiced=${s.readsServiced} flashReads=${flashReads} firstReadAtEvent#${firstReadEvent} of ${events}`);
}
