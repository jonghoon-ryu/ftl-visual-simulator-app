// Checks the project's TRIM addition (Address_Mapping_Unit_Page_Level::Trim_lpa)
// against the real WASM engine: TRIMmed logical pages become unmapped, exactly
// that many valid pages turn invalid, trimming twice is a no-op, and a full
// run with a TRIMming host finishes with a lower WAF than one without.
// Run: npm run test:engine:trim (needs src/wasm-build from engine/build-wasm.sh).
import createModule from '../../../src/wasm-build/mqsim.mjs';
import {
  buildGcWorkloadXml,
  buildSsdConfigXml,
  DEFAULT_GC_PARAMS,
  DEFAULT_WORKLOAD_PARAMS,
} from '../../../src/data/mqsimConfigs.ts';

const mod: any = await createModule();
let hostWrites = 0;
let moved = 0;
mod.setEventCallback((e: any) => {
  if (e.type === 'mapping_updated' && e.isWrite) hostWrites++;
  else if (e.type === 'gc_page_migrated' || e.type === 'wl_page_migrated') moved++;
});

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

const ssd = buildSsdConfigXml(DEFAULT_GC_PARAMS);
const workload = buildGcWorkloadXml(DEFAULT_GC_PARAMS, DEFAULT_WORKLOAD_PARAMS);
const countValid = () =>
  mod.getState().blocks.reduce((n: number, b: any) => n + b.pages.filter((p: string) => p === 'valid').length, 0);

// 1. Mid-run TRIM bookkeeping.
mod.init(ssd, workload);
mod.run(3_000_000);
const total = mod.totalLogicalPages();
const mappedBefore = mod.getState().mapping.filter((m: any) => m.mapped).length;
const validBefore = countValid();
const n = mod.trimRange(0, Math.floor(total / 2));
const state = mod.getState();
const mappedAfter = state.mapping.filter((m: any) => m.mapped).length;
check('some pages were mapped before TRIM', mappedBefore > 0, `${mappedBefore}`);
check('TRIM trimmed at least one page', n > 0, `${n}`);
check('mapped LPNs drop by the trimmed count', mappedBefore - mappedAfter === n, `${mappedBefore} -> ${mappedAfter}`);
check('valid pages drop by the trimmed count', validBefore - countValid() === n, `${validBefore} -> ${countValid()}`);
check('trimming the same range again does nothing', mod.trimRange(0, Math.floor(total / 2)) === 0);
check('out-of-range LPNs are ignored', mod.trimRange(total + 10, 5) === 0);

// 2. Full runs: the engine must not crash/stall, and TRIM must lower WAF.
async function fullRun(trimPercent: number, chunk: number): Promise<number> {
  hostWrites = 0;
  moved = 0;
  mod.init(ssd, workload);
  const t = mod.totalLogicalPages();
  const perRound = Math.max(1, Math.floor((t * trimPercent) / 100));
  let round = 0;
  while (mod.run(chunk)) {
    if (trimPercent > 0) {
      const start = (round * perRound) % t;
      mod.trimRange(start, Math.min(perRound, t - start));
      round++;
    }
  }
  return (hostWrites + moved) / hostWrites;
}
const wafPlain = await fullRun(0, 200000);
const wafTrim = await fullRun(10, 200000);
check('TRIMming host gets a lower WAF', wafTrim < wafPlain, `${wafPlain.toFixed(3)} -> ${wafTrim.toFixed(3)}`);

process.exit(failures === 0 ? 0 : 1);
