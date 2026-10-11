// Runs every preset across GC policies x OP x GC threshold x DRAM cache and
// reports any run that ends with writes stuck waiting for free space, gives up
// on GC retries, or throws. Run: node --experimental-strip-types engine/tests/cache/stall-sweep.mts
import createModule from '../../../src/wasm-build/mqsim.mjs';
import * as C from '../../../src/data/mqsimConfigs.ts';
const presets = [
  ['gc', C.DEFAULT_GC_PARAMS, C.buildGcWorkloadXml],
  ['wear-leveling', C.DEFAULT_WL_PARAMS, C.buildWlWorkloadXml],
  ['mapping', C.DEFAULT_MAPPING_PARAMS, C.buildMappingWorkloadXml],
] as const;
const policies = ['RGA', 'GREEDY', 'RANDOM', 'RANDOM_P', 'RANDOM_PP', 'FIFO', 'COST_BENEFIT'] as const;
let runs = 0, bad = 0;
for (const [id, base, wl] of presets) for (const policy of policies) for (const op of [0, 0.1, 0.3]) for (const th of [0.1, 0.3, 0.5, 0.7]) for (const cache of [true, false]) {
  const p = { ...base, gcBlockSelectionPolicy: policy, overprovisioningRatio: op, gcExecThreshold: th } as any;
  const mod: any = await createModule({ print: () => {}, printErr: () => {} });
  runs++;
  try {
    mod.init(C.buildSsdConfigXml(p), (wl as any)(p, { ...C.DEFAULT_WORKLOAD_PARAMS, writeCache: cache }));
    while (mod.run(200000)) {}
    const s = mod.getState().stats;
    if (s.writesWaitingForSpace > 0 || s.gcRetryLimitHits > 0) { bad++; console.log(`STALL ${id} ${policy} OP${op * 100} th${th * 100} cache=${cache} waiting=${s.writesWaitingForSpace} retryLimit=${s.gcRetryLimitHits}`); }
  } catch (e: any) { bad++; console.log(`THREW ${id} ${policy} OP${op * 100} th${th * 100} cache=${cache}: ${e?.message ?? e}`); }
}
console.log(`${runs} runs, ${bad} problems`);
