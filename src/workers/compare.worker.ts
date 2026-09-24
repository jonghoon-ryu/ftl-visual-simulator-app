import createMQSimModule from '../wasm-build/mqsim.mjs';

// Runs a list of configurations (e.g. one per GC policy, or one per OP
// ratio), each to the end, entirely off the main thread and in its own
// module instance - so a comparison never touches the simulation the user
// is stepping through in mqsim.worker.ts. Backs GcPolicyComparison.tsx and
// WafOpCurve.tsx.
//
// Typed loosely for the same reason as mqsim.worker.ts (DOM vs WebWorker
// lib conflict).
type WorkerContext = {
  onmessage: ((e: MessageEvent<CompareRequest>) => void) | null;
  postMessage: (msg: CompareMessage) => void;
};
const ctx = self as unknown as WorkerContext;

export interface CompareJob {
  // Identifies the run in its result (a policy name, an OP ratio, ...).
  label: string;
  ssdConfigXml: string;
  workloadXml: string;
}

export interface CompareResult {
  label: string;
  hostWrites: number;
  pagesMoved: number;
  gcExecutions: number;
  deviceFull: boolean;
}

type CompareRequest = { type: 'compare'; runId: number; jobs: CompareJob[] };
export type CompareMessage =
  | { type: 'result'; runId: number; result: CompareResult }
  | { type: 'done'; runId: number }
  | { type: 'error'; runId: number; error: string };

// Event-groups per run() call - large, since nothing is drawn per call.
const CHUNK = 200000;

let modulePromise: Promise<MqsimModule> | null = null;
let hostWrites = 0;
let pagesMoved = 0;

function getModule(): Promise<MqsimModule> {
  if (!modulePromise) {
    modulePromise = createMQSimModule().then((mod) => {
      mod.setEventCallback((event) => {
        if (event.type === 'mapping_updated' && event.isWrite) hostWrites++;
        else if (event.type === 'gc_page_migrated' || event.type === 'wl_page_migrated') pagesMoved++;
      });
      return mod;
    });
  }
  return modulePromise;
}

ctx.onmessage = async (e) => {
  const { runId, jobs } = e.data;
  try {
    const mod = await getModule();
    for (const job of jobs) {
      hostWrites = 0;
      pagesMoved = 0;
      mod.init(job.ssdConfigXml, job.workloadXml);
      while (mod.run(CHUNK)) {
        // run to the end
      }
      const stats = mod.getState().stats;
      ctx.postMessage({
        type: 'result',
        runId,
        result: {
          label: job.label,
          hostWrites,
          pagesMoved,
          gcExecutions: stats.gcExecutions,
          deviceFull: stats.writesWaitingForSpace > 0,
        },
      });
    }
    ctx.postMessage({ type: 'done', runId });
  } catch (err) {
    ctx.postMessage({ type: 'error', runId, error: err instanceof Error ? err.message : String(err) });
  }
};
