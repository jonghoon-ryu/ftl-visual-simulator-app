import { useCallback, useEffect, useRef, useState } from 'react';

// Runs the actual WASM module in a dedicated Web Worker (src/workers/
// mqsim.worker.ts) - per the plan's Session 8 spec ("WASM 실행을 Web
// Worker 로 돌리고") - so a long step()/run() call can never block React's
// rendering or input handling on the main thread. Communication is a
// small promise-based RPC over postMessage; every call here is therefore
// async, unlike the pre-worker version that called into the module
// directly.
type PendingEntry = { resolve: (value: unknown) => void; reject: (err: Error) => void };

interface WorkerResponse {
  id?: number;
  ok?: boolean;
  result?: unknown;
  error?: string;
  type?: 'event';
  payload?: MqsimEvent;
}

export function useMqsimEngine(ssdConfigXml: string, workloadXml: string) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<MqsimState | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const nextIdRef = useRef(1);
  const pendingRef = useRef(new Map<number, PendingEntry>());
  const eventListenersRef = useRef(new Set<(event: MqsimEvent) => void>());

  // Reads workerRef.current at *call* time, not at effect-mount time - so
  // callers made after a React StrictMode remount (which terminates the
  // first worker and spins up a second) always reach the current worker
  // rather than a stale, already-terminated one.
  const call = useCallback(<T,>(req: Record<string, unknown>): Promise<T> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error('워커가 아직 준비되지 않았습니다'));
    return new Promise<T>((resolve, reject) => {
      const id = nextIdRef.current++;
      pendingRef.current.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, ...req });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const worker = new Worker(new URL('../workers/mqsim.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'event') {
        if (msg.payload) {
          eventListenersRef.current.forEach((cb) => cb(msg.payload!));
        }
        return;
      }
      if (msg.id === undefined) return;
      const pending = pendingRef.current.get(msg.id);
      if (!pending) return;
      pendingRef.current.delete(msg.id);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error ?? '알 수 없는 워커 오류'));
    };

    call({ type: 'init', ssdConfigXml, workloadXml })
      .then(() => {
        if (cancelled) return;
        setReady(true);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      });

    return () => {
      cancelled = true;
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = useCallback(() => call<boolean>({ type: 'step' }), [call]);
  const run = useCallback((n: number) => call<boolean>({ type: 'run', n }), [call]);
  const stepIo = useCallback(() => call<boolean>({ type: 'stepIo' }), [call]);
  const stepEvent = useCallback(() => call<boolean>({ type: 'stepEvent' }), [call]);
  const runEvents = useCallback((n: number) => call<boolean>({ type: 'runEvents', n }), [call]);
  const configure = useCallback(
    () => call<void>({ type: 'configure', ssdConfigXml, workloadXml }),
    [call, ssdConfigXml, workloadXml],
  );

  // Re-reads getState() and stores it - call after step()/run() so the UI
  // reflects the new point-in-time snapshot. Not called automatically on a
  // timer: playback controls (useSimulationPlayback) own when the sim
  // advances.
  const refresh = useCallback(async () => {
    const nextState = await call<MqsimState>({ type: 'getState' });
    setState(nextState);
  }, [call]);

  useEffect(() => {
    if (ready) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const subscribeEvents = useCallback((cb: (event: MqsimEvent) => void) => {
    eventListenersRef.current.add(cb);
    return () => {
      eventListenersRef.current.delete(cb);
    };
  }, []);

  return { ready, error, state, refresh, step, run, stepIo, stepEvent, runEvents, configure, subscribeEvents };
}

export type MqsimEngine = ReturnType<typeof useMqsimEngine>;
