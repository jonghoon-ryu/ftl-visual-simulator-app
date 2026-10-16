import createMQSimModule from '../wasm-build/mqsim.mjs';

// Runs the actual MQSim WASM module off the main thread (Session 8's plan
// spec: "WASM 실행을 Web Worker 로 돌리고"), so a long-running step()/run()
// call can never block React's rendering or input handling. The worker
// only ever holds one module instance (matches the single-scenario-at-a-
// time design already established in bindings.cpp's g_instance).
//
// `self` is typed loosely here (not via the `webworker` lib) since the
// rest of this project's tsconfig loads the `DOM` lib for the main thread,
// and DOM/WebWorker global types conflict if both are loaded in one
// compilation - see the (non-exported) WorkerContext type below.
type WorkerContext = {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage: (msg: Response) => void;
};
const ctx = self as unknown as WorkerContext;

type Request =
  | { id: number; type: 'init'; ssdConfigXml: string; workloadXml: string }
  | { id: number; type: 'configure'; ssdConfigXml: string; workloadXml: string }
  | { id: number; type: 'step' }
  | { id: number; type: 'run'; n: number }
  | { id: number; type: 'runEvents'; n: number }
  | { id: number; type: 'stepIo' }
  | { id: number; type: 'stepEvent' }
  | { id: number; type: 'trimRange'; start: number; count: number }
  | { id: number; type: 'getState' }
  | { id: number; type: 'pushSnapshot'; max: number }
  | { id: number; type: 'popSnapshot' }
  | { id: number; type: 'clearSnapshots' };

type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { type: 'event'; payload: MqsimEvent };

// Step-back (⏪) snapshots: copies of the module's live linear memory, newest
// last. MQSim's whole state lives in that memory and nothing else (see
// memory_layout() in bindings.cpp), so writing a copy back puts the engine
// exactly where it was - verified by engine/tests/cache/stepback.mts. Kept
// here rather than posted to the main thread: a few MB each, and only ever
// needed back in this same worker.
interface MemorySnapshot {
  low: Uint8Array; // [0, stackLow)
  highStart: number;
  high: Uint8Array; // [stackHigh, heapEnd)
}
const snapshots: MemorySnapshot[] = [];

function takeSnapshot(mod: MqsimModule): MemorySnapshot {
  const { stackLow, stackHigh, heapEnd } = mod.memoryLayout();
  return { low: mod.HEAPU8.slice(0, stackLow), highStart: stackHigh, high: mod.HEAPU8.slice(stackHigh, heapEnd) };
}

function restoreSnapshot(mod: MqsimModule, snap: MemorySnapshot) {
  // Memory only ever grows, so the current buffer is always big enough.
  mod.HEAPU8.set(snap.low, 0);
  mod.HEAPU8.set(snap.high, snap.highStart);
}

let modulePromise: Promise<MqsimModule> | null = null;

function getModule(): Promise<MqsimModule> {
  if (!modulePromise) {
    modulePromise = createMQSimModule().then((mod) => {
      // The one JS-side callback embind allows is registered here, once,
      // for the module's whole lifetime - every event gets forwarded to
      // the main thread, which fans it out to whichever hooks subscribed
      // (see useMqsimEvents.ts).
      mod.setEventCallback((event) => {
        ctx.postMessage({ type: 'event', payload: event });
      });
      return mod;
    });
  }
  return modulePromise;
}

ctx.onmessage = async (e) => {
  const req = e.data;
  try {
    const mod = await getModule();
    let result: unknown;
    switch (req.type) {
      case 'init':
        snapshots.length = 0;
        mod.init(req.ssdConfigXml, req.workloadXml);
        break;
      case 'configure':
        snapshots.length = 0;
        mod.configure(req.ssdConfigXml, req.workloadXml);
        break;
      case 'step':
        result = mod.step();
        break;
      case 'run':
        result = mod.run(req.n);
        break;
      case 'stepIo':
        result = mod.stepIo();
        break;
      case 'stepEvent':
        result = mod.stepEvent();
        break;
      case 'runEvents':
        result = mod.runEvents(req.n);
        break;
      case 'getState':
        result = mod.getState();
        break;
      // Each resolves with how many snapshots remain.
      case 'pushSnapshot':
        snapshots.push(takeSnapshot(mod));
        if (snapshots.length > req.max) snapshots.splice(0, snapshots.length - req.max);
        result = snapshots.length;
        break;
      case 'popSnapshot': {
        const snap = snapshots.pop();
        if (snap) restoreSnapshot(mod, snap);
        result = snapshots.length;
        break;
      }
      case 'clearSnapshots':
        snapshots.length = 0;
        result = 0;
        break;
      case 'trimRange':
        result = { trimmed: mod.trimRange(req.start, req.count), total: mod.totalLogicalPages() };
        break;
    }
    ctx.postMessage({ id: req.id, ok: true, result });
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
