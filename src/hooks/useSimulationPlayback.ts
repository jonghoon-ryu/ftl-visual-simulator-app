import { useCallback, useEffect, useRef, useState } from 'react';
import type { MqsimEngine } from './useMqsimEngine';

// Real time between ticks while playing - `speed` (1-8, from Toolbar's
// slider) instead controls how many event-groups run() executes per tick,
// so higher speed means faster simulated progress at a constant real-time
// frame rate rather than a shorter interval.
const TICK_INTERVAL_MS = 300;

// Returned by onRefresh to tell the caller whether to stop ▶ playback right
// here - used for static WL's trigger (see App.tsx's onRefresh): a beginner
// has no realistic chance of catching WL's one-off event live, so playback
// auto-pauses the moment it happens instead of continuing past it.
interface RefreshResult {
  shouldPause?: boolean;
}

// How many log lines ⏪ can go back. Each one keeps a copy of the engine's
// memory in the worker (~2.5 MB for "GC 시연"/"매핑 기본" - measured by
// engine/tests/cache/stepback.mts), so this caps that at well under 100 MB.
export const MAX_STEP_BACK = 30;

interface Options {
  engine: Pick<
    MqsimEngine,
    'ready' | 'step' | 'run' | 'stepEvent' | 'runEvents' | 'configure' | 'refresh' | 'pushSnapshot' | 'popSnapshot' | 'clearSnapshots'
  >;
  // `batchEnded` is true only for the ▶ play loop's tick when that tick's
  // run() call itself reached the end of the simulation (no more events) -
  // see its call site below for why this needs to be distinguished from an
  // ordinary tick/step.
  onRefresh: (opts?: { batchEnded?: boolean }) => RefreshResult | void | Promise<RefreshResult | void>;
  onRestart: () => void;
  // How many event-groups one "speed" unit (1-8, Toolbar's slider) is worth
  // per tick/step - lets a preset whose workload needs vastly more
  // event-groups to reach anything interesting (e.g. "GC 시연": ~850k to
  // its first GC, measured via a native step-count harness) reach it in a
  // reasonable real-time span without changing the slider's 1-8 UI range.
  // Defaults to 1 (used by "매핑 기본", which only needs a few dozen).
  ticksMultiplier?: number;
  // What one ▶ tick advances by. 'eventGroups' (default): speed x
  // ticksMultiplier raw event-groups. 'logEvents': whole log lines (see
  // bindings.cpp's run_events()), speed/LOG_EVENTS_SPEED_DIVISOR of them per
  // tick - for "매핑 기본", whose log lines are sparse in event-group terms:
  // with 'eventGroups' the screen sat unchanged for a minute or more while
  // the DRAM write cache absorbed writes, which read as frozen.
  playUnit?: 'eventGroups' | 'logEvents';
  // 'logEvents' only: log lines per tick at a given speed (1-8). Fractions
  // accumulate across ticks. Defaults to defaultLogLinesPerTick.
  logLinesPerTick?: (speed: number) => number;
  // Step-back: copies everything the UI built from past events (log, grid
  // outlines, chart histories...) and puts such a copy back. Taken right
  // before each stepped log line, alongside the engine's own snapshot.
  captureUi?: () => unknown;
  restoreUi?: (snapshot: unknown) => void;
}

// Default 'logEvents' pace: speed 8 (the default) = one log line per tick
// (~3/s at TICK_INTERVAL_MS 300), speed 1 = one every 8 ticks.
const LOG_EVENTS_SPEED_DIVISOR = 8;
const defaultLogLinesPerTick = (speed: number) => speed / LOG_EVENTS_SPEED_DIVISOR;

// Drives step()/run() for Toolbar's playback controls, via the worker-
// backed engine client (useMqsimEngine) - so this hook's own calls are all
// async. Kept separate from useMqsimEngine (which only loads/inits the
// engine once) since this hook's state - isPlaying, speed, hasMore - is
// about *driving* an already-loaded engine, not loading it.
export function useSimulationPlayback({
  engine,
  onRefresh,
  onRestart,
  ticksMultiplier = 1,
  playUnit = 'eventGroups',
  logLinesPerTick = defaultLogLinesPerTick,
  captureUi,
  restoreUi,
}: Options) {
  const [isPlaying, setIsPlaying] = useState(false);
  // Default 8 (the slider's max), not 1 - Ryu's ask (2026-09-20) for "매핑
  // 기본"/"GC 시연" to start at full speed. There's only one playback
  // instance shared across all three presets (no per-preset speed), so this
  // applies uniformly - including "마모평준화 시연", which only benefits
  // from a higher default given how many events it needs to reach its one
  // WL execution.
  const [speed, setSpeed] = useState(8);
  const [hasMore, setHasMore] = useState(true);
  // Keeps the interval/callbacks below calling the latest engine/onRefresh/
  // ticksMultiplier without needing them in dependency arrays. Assigned in
  // an effect (runs after commit), not during render - mutating a ref's
  // .current directly in the render body is unsafe under Concurrent/Strict
  // Mode.
  const latestRef = useRef({
    engine,
    onRefresh,
    ticksMultiplier,
    playUnit,
    logLinesPerTick,
    captureUi,
    restoreUi,
  });
  useEffect(() => {
    latestRef.current = {
      engine,
      onRefresh,
      ticksMultiplier,
      playUnit,
      logLinesPerTick,
      captureUi,
      restoreUi,
    };
  });
  // Step-back: UI snapshots, one per stepped log line, newest last - kept
  // in step with the engine snapshots in the worker (same cap, pushed and
  // popped together). backDepth is how many ⏪ presses are available.
  const uiSnapshotsRef = useRef<unknown[]>([]);
  const [backDepth, setBackDepth] = useState(0);
  // Steps and step-backs run one after another, never interleaved - a ⏪
  // pressed while a step is still in flight waits for it, so each press
  // undoes exactly one line no matter how fast the buttons are clicked.
  const opChainRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((op: () => Promise<void>) => {
    const next = opChainRef.current.then(op).catch((err: unknown) => console.error(err));
    opChainRef.current = next;
    return next;
  }, []);

  // Before one stepped log line: remember where the engine and the UI are.
  const pushSnapshot = useCallback(async () => {
    const { engine: e, captureUi: capture } = latestRef.current;
    if (!capture) return;
    const depth = await e.pushSnapshot(MAX_STEP_BACK);
    uiSnapshotsRef.current.push(capture());
    if (uiSnapshotsRef.current.length > depth) uiSnapshotsRef.current.splice(0, uiSnapshotsRef.current.length - depth);
    setBackDepth(depth);
  }, []);

  const clearSnapshots = useCallback(async () => {
    uiSnapshotsRef.current = [];
    setBackDepth(0);
    await latestRef.current.engine.clearSnapshots();
  }, []);
  // Fractional log lines owed to 'logEvents' playback (slow speeds advance
  // less than one line per tick).
  const logEventBudgetRef = useRef(0);
  // Guards against a tick starting before the previous one's postMessage
  // round-trip has resolved - shouldn't normally happen at 300ms with this
  // project's tiny demo workloads, but a worker call is genuinely async now
  // (unlike the pre-worker direct module call), so an overlap is possible
  // in principle if the engine were ever slow.
  const tickInFlightRef = useRef(false);

  // One *loggable event* (Ryu: "버튼 하나를 누르면 한 동작이 이루어져야
  // 함" - pressing the button once should show exactly one 로그 line) -
  // this is the → key / "1 step" button's action. See step_event()'s doc
  // comment in bindings.cpp for exactly what counts. A coarser stepOnce()
  // (⏭, one real read/write, silently bundling any GC/WL cycle that fell
  // inside it) used to sit alongside this - removed since it only ever
  // behaved differently from this one during a GC/WL cycle, which made it
  // a confusing near-duplicate the rest of the time.
  const stepEventOnce = useCallback(
    () =>
      enqueue(async () => {
        if (!engine.ready) return;
        await pushSnapshot();
        const more = await engine.stepEvent();
        const result = await latestRef.current.onRefresh();
        setHasMore(more);
        if (!more || result?.shouldPause) setIsPlaying(false);
      }),
    [engine, enqueue, pushSnapshot],
  );

  // Backs the "5 steps" button - just stepEventOnce run n times in a row,
  // sequentially awaited (not fired concurrently) so each call's worker
  // round-trip and onRefresh complete before the next stepEvent() starts,
  // same overlap concern tickInFlightRef guards against for the ▶ loop.
  // Each of the n lines gets its own snapshot, so ⏪ always goes back one
  // line - also after "5 steps".
  const stepEventMany = useCallback(
    (n: number) =>
      enqueue(async () => {
        if (!engine.ready) return;
        for (let i = 0; i < n; i++) {
          await pushSnapshot();
          const more = await engine.stepEvent();
          const result = await latestRef.current.onRefresh();
          setHasMore(more);
          if (!more || result?.shouldPause) {
            setIsPlaying(false);
            break;
          }
        }
      }),
    [engine, enqueue, pushSnapshot],
  );

  // ⏪: puts the engine and the UI back to just before the most recent
  // stepped log line. Only steps taken with the step buttons/→ can be undone
  // - ▶ and ⏮ clear the history (see clearSnapshots' callers).
  const stepBack = useCallback(
    () =>
      enqueue(async () => {
        const { engine: e, restoreUi: restore } = latestRef.current;
        const ui = uiSnapshotsRef.current.pop();
        if (!e.ready || ui === undefined || !restore) return;
        const depth = await e.popSnapshot();
        await e.refresh();
        restore(ui);
        setBackDepth(depth);
        // Every snapshot was taken with events still to run.
        setHasMore(true);
      }),
    [enqueue],
  );

  const togglePlay = useCallback(() => {
    setIsPlaying((playing) => !playing);
  }, []);

  const restart = useCallback(async () => {
    if (!engine.ready) return;
    setIsPlaying(false);
    // configure() also drops the worker's engine snapshots.
    uiSnapshotsRef.current = [];
    setBackDepth(0);
    await engine.configure();
    setHasMore(true);
    onRestart();
    await latestRef.current.onRefresh();
  }, [engine, onRestart]);

  // ▶ runs many lines per tick without snapshots, so the step-back history
  // no longer leads anywhere sensible once it starts - drop it.
  useEffect(() => {
    if (isPlaying && engine.ready) void enqueue(clearSnapshots);
  }, [isPlaying, engine.ready, enqueue, clearSnapshots]);

  useEffect(() => {
    if (!isPlaying || !engine.ready) return;
    logEventBudgetRef.current = 0;
    const id = setInterval(() => {
      if (tickInFlightRef.current) return;
      const { engine: tickEngine, ticksMultiplier: multiplier, playUnit: unit, logLinesPerTick: linesFor } = latestRef.current;
      let tick: Promise<boolean>;
      if (unit === 'logEvents') {
        logEventBudgetRef.current += linesFor(speed);
        const lines = Math.floor(logEventBudgetRef.current);
        if (lines < 1) return;
        logEventBudgetRef.current -= lines;
        tick = tickEngine.runEvents(lines);
      } else {
        tick = tickEngine.run(speed * multiplier);
      }
      tickInFlightRef.current = true;
      tick
        .then(async (more) => {
          // A play tick can process many events at once (dozens of log
          // lines at full speed in "GC 시연") - when it
          // runs all the way to the end of the simulation in one call, the
          // moving/erasing overlay hooks would otherwise show the union of
          // every migration/erase across that entire final batch, frozen on
          // screen forever since no further tick ever arrives to clear it.
          // Flagging this lets onRefresh clear those overlays instead of
          // populating them - see App.tsx's onRefresh.
          const result = await latestRef.current.onRefresh({ batchEnded: !more });
          setHasMore(more);
          if (!more || result?.shouldPause) setIsPlaying(false);
        })
        .finally(() => {
          tickInFlightRef.current = false;
        });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPlaying, engine.ready, speed]);

  // Re-reads the engine state and runs the caller's onRefresh - for changes the
  // simulation did not make by itself (e.g. a TRIM issued from the UI).
  const refreshNow = useCallback(async () => {
    await latestRef.current.onRefresh();
  }, []);

  return {
    isPlaying,
    speed,
    hasMore,
    setSpeed,
    stepEventOnce,
    stepEventMany,
    stepBack,
    canStepBack: backDepth > 0,
    togglePlay,
    restart,
    refreshNow,
  };
}
