// Static WL executions per threshold at "마모평준화 시연"'s defaults - basis for
// STATIC_WL_THRESHOLD_RANGE and ParamPanel's hint.
// Run: node --experimental-strip-types engine/tests/cache/wlth.mts 1 3 5 10 30
import createModule from '../../../src/wasm-build/mqsim.mjs';
import * as C from '../../../src/data/mqsimConfigs.ts';
const mod: any = await createModule();
for (const t of process.argv.slice(2).map(Number)) {
  const p = { ...C.DEFAULT_WL_PARAMS, staticWlThreshold: t };
  mod.init(C.buildSsdConfigXml(p), C.buildWlWorkloadXml(p, C.DEFAULT_WORKLOAD_PARAMS));
  while (mod.run(100000)) {}
  const st = mod.getState(); const ec = st.blocks.map((b: any) => b.eraseCount);
  console.log(`threshold ${t}: wl=${st.stats.wlExecutions} gc=${st.stats.gcExecutions} erase ${Math.min(...ec)}..${Math.max(...ec)}`);
}
