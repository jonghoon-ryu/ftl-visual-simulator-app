// "GC 시연" across Working_Set_Percentage values at the preset defaults:
// distinct LPNs used, valid pages at the end, WAF, GC count, first GC log
// line, and whether the device fills (writes stuck waiting for space).
// Run: node --experimental-strip-types engine/tests/cache/workingset.mts [op] [ws...]
import createModule from '../../../src/wasm-build/mqsim.mjs';
import * as C from '../../../src/data/mqsimConfigs.ts';
const mod: any = await createModule({ print: () => {}, printErr: () => {} });
let host = 0, moved = 0, gcSeen = false, lines = 0, firstGcLine = -1;
mod.setEventCallback((e: any) => {
  if (e.type === 'mapping_updated' && e.isWrite) host++;
  else if (e.type === 'gc_page_migrated') moved++;
  if (e.type === 'gc_started' && !gcSeen) { gcSeen = true; firstGcLine = lines + 1; }
});
const op = Number(process.argv[2] ?? 0.1);
const sets = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [25, 40, 50, 60, 70, 80, 90];
for (const ws of sets) {
  const p = { ...C.DEFAULT_GC_PARAMS, overprovisioningRatio: op };
  host = 0; moved = 0; gcSeen = false; lines = 0; firstGcLine = -1;
  mod.init(C.buildSsdConfigXml(p), C.buildGcWorkloadXml(p, C.DEFAULT_WORKLOAD_PARAMS).replace(/<Working_Set_Percentage>\d+</, `<Working_Set_Percentage>${ws}<`));
  while (mod.stepEvent()) lines++;
  const st = mod.getState(); const s = st.stats;
  const valid = st.blocks.reduce((n: number, b: any) => n + b.pages.filter((x: string) => x === 'valid').length, 0);
  console.log(`ws ${String(ws).padStart(3)}% OP ${op * 100}%: LPNs=${st.mapping.filter((m: any) => m.mapped).length} valid=${valid}/384 WAF=${host ? ((host + moved) / host).toFixed(2) : '-'} gc=${s.gcExecutions} firstGC@line ${firstGcLine} logLines=${lines}${s.writesWaitingForSpace ? `  DEVICE FULL (${s.writesWaitingForSpace} stuck)` : ''}`);
}
