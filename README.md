# FTL Visual Simulator

An interactive, browser-based visualizer for Flash Translation Layer (FTL)
internals — address mapping, garbage collection, and wear leveling — built
on top of [MQSim](https://github.com/CMU-SAFARI/MQSim), a real SSD/FTL
simulator, compiled to WebAssembly.

Unlike a from-scratch reimplementation, the simulation engine here is
MQSim's actual C++ source (vendored under `engine/mqsim`, MIT-licensed),
compiled with Emscripten and instrumented with hooks that report internal
FTL state changes to the UI in real time. The goal is to make FTL concepts
(page-level mapping, GC victim selection, dynamic/static wear leveling)
visible and explorable, not just simulated.

Full development plan and write-ups (in Korean) live at
[jonghoon-ryu.github.io/ftl-visual-simulator](https://jonghoon-ryu.github.io/ftl-visual-simulator/).
Live app: [ftl-visual-simulator-app on GitHub Pages](https://jonghoon-ryu.github.io/ftl-visual-simulator-app/).

## Status

All three concept presets run on the real WASM engine end-to-end:

- **매핑 기본 (mapping basics)** and **GC 시연 (GC demo)** — real playback,
  flash block/page grid, event log, and stats (WAF, host requests vs flash
  writes, valid-page ratio, GC/WL execution counts, erase count), all
  reconfigurable via parameter controls (page/block/chip count, OP, GC
  threshold, GC victim-selection policy, seeds) and workload controls
  (access pattern, DRAM write cache on/off).
- **마모평준화 시연 (wear-leveling demo)** — per-block erase-count view with a
  cold/hot data column, driven by two IO flows: a write-once "cold" flow
  and a constantly overwritten "hot" flow, so static wear-leveling has real
  cold data to relocate. Static WL fires 7 times at the default threshold
  (3), each moving a full block; the threshold is adjustable (1-5).

### Learning features

The app is meant for learning FTL internals, so each feature makes one
concept visible:

- **Free-block chart** (GC/WL demos) — free blocks per chip over time, the
  GC threshold as a dashed line, and GC/WL start markers: the sawtooth shows
  exactly when and why GC starts.
- **"왜 이 block 을 골랐나요?"** (GC demo) — the latest GC victim's
  valid/invalid page counts and how the selected policy picked it.
- **GC policy comparison** (GC demo) — runs the current settings once per
  policy (all 7, including this project's Cost-Benefit) in a background worker and tabulates GC runs, pages moved
  and WAF. At the defaults plain Random comes out cheapest, which the app
  says plainly rather than repeating the textbook claim.
- **WAF vs over-provisioning curve** (GC demo) — OP 0-30% measured with the
  current settings (1.49x -> 1.05x at the defaults).
- **Follow one write** (all presets) — click an LPN in the log to see every
  physical page its data has occupied (write -> overwrite -> GC move ...),
  outlined on the grid: the out-of-place update in one picture.
- **DRAM write-cache toggle** — with the cache on, GC 시연 sends ~2.2M host
  requests but only ~500 page writes reach flash; off, nearly every request
  does and GC runs ~16x more (30 -> 497).
- **예측해보기 quiz** (all presets) — predict, then see the answer and where
  on the screen to check it.
- A "장치가 가득 찼어요" notice when a tiny configuration fills the device.

## How it works

1. **Engine**: `engine/mqsim/src` is MQSim's C++ source with a small
   library-style interface (`MQSim_Interface.cpp`) added on top of it,
   plus Emscripten bindings (`src/wasm/bindings.cpp`) exposing
   `init`/`configure`/`step`/`run`/`getState`/`setEventCallback` to
   JavaScript. `engine/build-wasm.sh` compiles it to
   `src/wasm-build/mqsim.{mjs,wasm}` (gitignored — rebuilt from source, see
   `.github/workflows/deploy.yml`).
2. **Worker**: the compiled module runs inside a dedicated Web Worker
   (`src/workers/mqsim.worker.ts`), so a long `run()` call never blocks the
   UI thread. `src/hooks/useMqsimEngine.ts` is a small promise-based RPC
   client for it.
3. **Config as XML, in memory**: parameter/workload panels don't reach into
   the engine directly — they generate `ssdconfig.xml`/`workload.xml` text
   (`src/data/mqsimConfigs.ts`), which gets written into the WASM module's
   in-memory filesystem and parsed by MQSim's own (unmodified) XML config
   reader, the same as the original CLI would read files from disk.
4. **Hooks → events**: real engine events (mapping updates, GC/WL
   start/migrate/erase, dynamic-WL block rotation) are forwarded from C++
   to JS via a single registered callback and fanned out to whichever
   hooks/components subscribed (`src/hooks/useMqsimEvents.ts`).
   Comparisons (GC policies, the OP curve) run in a second worker
   (`src/workers/compare.worker.ts`) with its own module instance, so they
   never disturb the simulation on screen.
5. **Golden regression tests**: `npm run test:engine` builds a native (non-
   WASM) CLI from the same `engine/mqsim/src` and diffs its output against
   committed golden result files — a way to check that instrumentation
   changes (hooks, `getState()`) never alter what MQSim actually simulates.
6. **GMock/GTest unit tests**: `npm run test:engine:unit` (`engine/tests/unit/`)
   isolates individual engine modules behind hand-written fakes/mocks of
   their collaborators, so a specific condition (an erase-count spread, a
   GC/WL threshold) can be checked deterministically in milliseconds instead
   of running a real workload for millions of event-groups hoping to
   stumble into it naturally — see the
   [wear-leveling integration doc](https://jonghoon-ryu.github.io/ftl-visual-simulator/plan/wear-leveling-integration/)
   for the investigation that motivated writing these.

27 real, pre-existing MQSim bugs were found and fixed along the way -
portability/UB issues, a use-after-free, uninitialized fields, dropped
config parameters, a scheduler suspend/resume deadlock chain, static
wear-leveling target selection, several simulations that silently stalled
(barrier-released writes never reaching the DRAM cache, a parked GC that
never submitted its erase, ...), and GC victim-selection bugs in the
RANDOM/FIFO policies. Each has an investigation write-up; the summary table
is at
[reference/bug-list/table](https://jonghoon-ryu.github.io/ftl-visual-simulator/reference/bug-list/table/).
A few deliberate deviations from upstream behavior (documented in code as
`DEVIATION FROM UPSTREAM MQSim`) exist where this project's small demo scale
needs them.

## Stack

- Vite + React + TypeScript (UI)
- MQSim C++ compiled to WebAssembly via Emscripten (engine, `engine/mqsim`)
- GitHub Pages (deploy target, auto-built on every push to `main`)

## Development

```bash
npm install
npm run dev            # dev server (needs src/wasm-build/ already built - see below)
npm run build           # typecheck + production build
npm run lint            # oxlint
npm run test:engine     # native golden regression tests for engine/mqsim
npm run test:engine:unit # GMock/GTest unit tests for engine/mqsim (needs network on first run)
```

Building the WASM module requires an active [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
on `PATH` (`source /path/to/emsdk/emsdk_env.sh`), then:

```bash
bash engine/build-wasm.sh
```

`src/wasm-build/` is gitignored — CI rebuilds it from `engine/mqsim/src` on
every deploy, so there's never a stale prebuilt binary to fall out of sync
with the source.
