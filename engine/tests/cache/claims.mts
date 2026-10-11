// Re-measures every number the UI quotes that depends on the DRAM cache size
// (PredictQuiz explanations, UsageGuide/ParamPanel hints): GC policy WAFs, WL
// threshold counts, sequential vs random, WAF vs OP. 'old' = the former 256 MB cache.
// Run: node --experimental-strip-types engine/tests/cache/claims.mts [old] [pages...]
import createModule from '../../../src/wasm-build/mqsim.mjs';
import * as C from '../../../src/data/mqsimConfigs.ts';
const mod: any = await createModule();
let host = 0, moved = 0;
mod.setEventCallback((e: any) => { if (e.type === 'mapping_updated' && e.isWrite) host++; else if (e.type === 'gc_page_migrated' || e.type === 'wl_page_migrated') moved++; });
const sizes = process.argv.slice(2).length ? process.argv.slice(2) : ['old', '32'];
function run(p: any, wxml: string, size: string) {
  let ssd = C.buildSsdConfigXml(p);
  if (size === 'old') ssd = ssd.replace(/<Data_Cache_Capacity>\d+</, '<Data_Cache_Capacity>268435456<'); else ssd = ssd.replace(/<Data_Cache_Capacity>\d+</, `<Data_Cache_Capacity>${Number(size) * p.pageCapacityBytes}<`);
  host = 0; moved = 0;
  mod.init(ssd, wxml);
  while (mod.run(100000)) {}
  const s = mod.getState().stats;
  return { host, moved, waf: host ? (host + moved) / host : 0, gc: s.gcExecutions, wl: s.wlExecutions, full: s.writesWaitingForSpace };
}
const W = C.DEFAULT_WORKLOAD_PARAMS;
for (const size of sizes) {
  console.log(`=== cache ${size} ===`);
  const pol = ['RGA', 'GREEDY', 'RANDOM', 'RANDOM_P', 'RANDOM_PP', 'FIFO', 'COST_BENEFIT'].map((g) => {
    const p = { ...C.DEFAULT_GC_PARAMS, gcBlockSelectionPolicy: g };
    const r = run(p, C.buildGcWorkloadXml(p as any, W), size);
    return `${g} ${r.waf.toFixed(2)}x(gc${r.gc}${r.full ? ' FULL' : ''})`;
  });
  console.log('policies:', pol.join('  '));
  for (const t of [1, 3, 5]) {
    const p = { ...C.DEFAULT_WL_PARAMS, staticWlThreshold: t };
    const r = run(p, C.buildWlWorkloadXml(p as any, W), size);
    console.log(`WL threshold ${t}: wl=${r.wl} gc=${r.gc} WAF=${r.waf.toFixed(2)}${r.full ? ' FULL' : ''}`);
  }
  for (const d of ['RANDOM_UNIFORM', 'STREAMING'] as const) {
    const r = run(C.DEFAULT_GC_PARAMS, C.buildGcWorkloadXml(C.DEFAULT_GC_PARAMS, { ...W, addressDistribution: d }), size);
    console.log(`access ${d}: WAF=${r.waf.toFixed(2)} gc=${r.gc} moved/gc=${(r.moved / Math.max(1, r.gc)).toFixed(2)}${r.full ? ' FULL' : ''}`);
  }
  const op = [0, 5, 10, 15, 20, 25, 30].map((o) => {
    const p = { ...C.DEFAULT_GC_PARAMS, overprovisioningRatio: o / 100 };
    const r = run(p, C.buildGcWorkloadXml(p, W), size);
    return `${o}%:${r.waf.toFixed(2)}${r.full ? 'F' : ''}`;
  });
  console.log('OP curve:', op.join(' '));
}
