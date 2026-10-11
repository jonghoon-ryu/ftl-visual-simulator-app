// TRIM's effect on WAF in a full "GC 시연" run, per cache mode and TRIM chunk
// (event-groups between TRIMs). Basis for TrimPanel's TRIM_CHUNK / default 30%.
// Run: [BASE=1] node --experimental-strip-types engine/tests/cache/trimwaf.mts on:600 off:600 ...
import createModule from '../../../src/wasm-build/mqsim.mjs';
import * as C from '../../../src/data/mqsimConfigs.ts';
const mod: any = await createModule();
let host = 0, moved = 0;
mod.setEventCallback((e: any) => { if (e.type === 'mapping_updated' && e.isWrite) host++; else if (e.type === 'gc_page_migrated' || e.type === 'wl_page_migrated') moved++; });
function full(cache: boolean, pct: number, chunk: number) {
  host = 0; moved = 0;
  mod.init(C.buildSsdConfigXml(C.DEFAULT_GC_PARAMS), C.buildGcWorkloadXml(C.DEFAULT_GC_PARAMS, { ...C.DEFAULT_WORKLOAD_PARAMS, writeCache: cache }));
  const t = mod.totalLogicalPages(); const per = Math.max(1, Math.floor(t * pct / 100)); let round = 0, trimmed = 0;
  while (mod.run(chunk)) { if (pct) { const st = (round * per) % t; trimmed += mod.trimRange(st, Math.min(per, t - st)); round++; } }
  const s = mod.getState().stats;
  return `cache=${cache} trim=${pct}% chunk=${chunk}: rounds=${round} trimmedPages=${trimmed} hostReq=${s.hostRequestsServiced} flash=${host} moved=${moved} gc=${s.gcExecutions} WAF=${((host + moved) / host).toFixed(3)}`;
}
const combos = process.argv.slice(2).map((a) => a.split(":")).map(([c, k]) => [c === "on", Number(k)] as const);
for (const [cache, chunk] of combos) {
  if (process.env.BASE) console.log(full(cache, 0, chunk));
  console.log(full(cache, 10, chunk));
}
