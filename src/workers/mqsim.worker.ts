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
  | { id: number; type: 'stepIo' }
  | { id: number; type: 'stepEvent' }
  | { id: number; type: 'getState' };

type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { type: 'event'; payload: MqsimEvent };

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
        mod.init(req.ssdConfigXml, req.workloadXml);
        break;
      case 'configure':
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
      case 'getState':
        result = mod.getState();
        break;
    }
    ctx.postMessage({ id: req.id, ok: true, result });
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
