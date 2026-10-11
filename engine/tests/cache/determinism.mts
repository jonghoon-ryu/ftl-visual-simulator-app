// The same config run 3x in one WASM module and 2x in fresh modules must give
// identical results (the app's compare worker and ▶ restarts reuse one module).
// Caught the pointer-ordered overfull-plane write list - see
// Write_transactions_for_overfull_planes in Address_Mapping_Unit_Page_Level.h.
// Run: node --experimental-strip-types engine/tests/cache/determinism.mts [old|pages] [off]
import createModule from '../../../src/wasm-build/mqsim.mjs';
import * as C from '../../../src/data/mqsimConfigs.ts';
const size = process.argv[2] ?? '32';
let ssd = C.buildSsdConfigXml(C.DEFAULT_GC_PARAMS);
if (size === 'old') ssd = ssd.replace(/<Data_Cache_Capacity>\d+</, '<Data_Cache_Capacity>268435456<'); else ssd = ssd.replace(/<Data_Cache_Capacity>\d+</, `<Data_Cache_Capacity>${Number(size) * 4096}<`);
const wl = C.buildGcWorkloadXml(C.DEFAULT_GC_PARAMS, { ...C.DEFAULT_WORKLOAD_PARAMS, writeCache: process.argv[3] !== 'off' });
async function once(mod: any) {
  let host = 0, moved = 0;
  mod.setEventCallback((e: any) => { if (e.type === 'mapping_updated' && e.isWrite) host++; else if (e.type === 'gc_page_migrated') moved++; });
  mod.init(ssd, wl);
  while (mod.run(100000)) {}
  const s = mod.getState().stats;
  return `host ${host} moved ${moved} gc ${s.gcExecutions} hostReq ${s.hostRequestsServiced}`;
}
const shared = await createModule();
for (let i = 0; i < 3; i++) console.log('same module run', i, await once(shared));
for (let i = 0; i < 2; i++) console.log('fresh module run', i, await once(await createModule()));
