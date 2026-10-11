// Log lines (step_event units - what ▶'s 'logEvents' pacing counts) in a full
// run of each preset, cache on/off. Basis for App.tsx's LOG_LINES_PER_TICK_AT_FULL_SPEED.
// Run: node --experimental-strip-types engine/tests/cache/loglines.mts
import createModule from '../../../src/wasm-build/mqsim.mjs';
import * as C from '../../../src/data/mqsimConfigs.ts';
const mod: any = await createModule();
const presets = [
  ['mapping', C.DEFAULT_MAPPING_PARAMS, C.buildMappingWorkloadXml],
  ['gc', C.DEFAULT_GC_PARAMS, C.buildGcWorkloadXml],
  ['wear-leveling', C.DEFAULT_WL_PARAMS, C.buildWlWorkloadXml],
] as const;
for (const [id, p, wl] of presets) for (const cache of [true, false]) {
  mod.init(C.buildSsdConfigXml(p), (wl as any)(p, { ...C.DEFAULT_WORKLOAD_PARAMS, writeCache: cache }));
  let lines = 0;
  while (mod.stepEvent()) lines++;
  console.log(`${id.padEnd(13)} cache=${cache ? 'on ' : 'off'} logLines=${lines} -> per tick for 180 ticks: ${(lines / 180).toFixed(1)}`);
}
