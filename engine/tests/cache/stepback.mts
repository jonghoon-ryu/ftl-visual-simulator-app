// Step-back (⏪) soundness check: snapshot WASM memory, take k step_event()s
// recording every event and the final getState(), restore the snapshot,
// take the same k steps again - both runs must match exactly. Also reports
// snapshot size and copy time. Repeated at several points of each preset.
// Run: node --experimental-strip-types engine/tests/cache/stepback.mts
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
} from '../../../src/data/mqsimConfigs.ts';

const mod: any = await createModule();
let log: string[] = [];
const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
mod.setEventCallback((e: any) => log.push(JSON.stringify(e, big)));

function snapshot() {
  const { stackLow, stackHigh, heapEnd } = mod.memoryLayout();
  const heap: Uint8Array = mod.HEAPU8;
  return { low: heap.slice(0, stackLow), stackHigh, high: heap.slice(stackHigh, heapEnd) };
}
function restore(s: ReturnType<typeof snapshot>) {
  const heap: Uint8Array = mod.HEAPU8;
  heap.set(s.low, 0);
  heap.set(s.high, s.stackHigh);
}
function walk(k: number) {
  log = [];
  for (let i = 0; i < k; i++) mod.stepEvent();
  return log.join('\n') + '\n' + JSON.stringify(mod.getState(), big);
}

const presets = [
  { id: 'mapping', ssd: buildSsdConfigXml(DEFAULT_MAPPING_PARAMS), wl: buildMappingWorkloadXml(DEFAULT_MAPPING_PARAMS, DEFAULT_WORKLOAD_PARAMS) },
  { id: 'gc', ssd: buildSsdConfigXml(DEFAULT_GC_PARAMS), wl: buildGcWorkloadXml(DEFAULT_GC_PARAMS, DEFAULT_WORKLOAD_PARAMS) },
  { id: 'wear-leveling', ssd: buildSsdConfigXml(DEFAULT_WL_PARAMS), wl: buildWlWorkloadXml(DEFAULT_WL_PARAMS, DEFAULT_WORKLOAD_PARAMS) },
];

let failures = 0;
for (const p of presets) {
  mod.init(p.ssd, p.wl);
  let done = 0;
  for (const at of [0, 50, 300, 1500, 4000]) {
    for (; done < at; done++) mod.stepEvent();
    const t0 = performance.now();
    const snap = snapshot();
    const t1 = performance.now();
    const a = walk(5);
    restore(snap);
    const b = walk(5);
    const same = a === b;
    if (!same) failures++;
    const kb = ((snap.low.length + snap.high.length) / 1024).toFixed(0);
    done += 10;
    console.log(`${p.id.padEnd(14)} at ${String(at).padStart(4)}: snapshot ${kb} KB, copy ${(t1 - t0).toFixed(2)} ms -> ${same ? 'SAME' : 'DIFFERENT'}`);
  }
}
console.log(failures ? `FAIL ${failures}` : 'OK');
