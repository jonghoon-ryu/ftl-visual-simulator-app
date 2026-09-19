import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { FlashGrid } from './components/FlashGrid';
import { MappingTable } from './components/MappingTable';
import { ParamPanel } from './components/ParamPanel';
import { StatsPanel } from './components/StatsPanel';
import { Toolbar } from './components/Toolbar';
import { WearLevelingView } from './components/WearLevelingView';
import { WorkloadPanel } from './components/WorkloadPanel';
import { presets } from './data/presets';
import {
  buildGcWorkloadXml,
  buildMappingWorkloadXml,
  buildWlWorkloadXml,
  buildSsdConfigXml,
  DEFAULT_GC_PARAMS,
  DEFAULT_MAPPING_PARAMS,
  DEFAULT_WL_PARAMS,
  DEFAULT_WORKLOAD_PARAMS,
} from './data/mqsimConfigs';
import type { SsdParams, WorkloadParams } from './data/mqsimConfigs';
import { useMqsimEngine } from './hooks/useMqsimEngine';
import { useMqsimEvents } from './hooks/useMqsimEvents';
import { useMqsimMigrations } from './hooks/useMqsimMigrations';
import { useSimulationPlayback } from './hooks/useSimulationPlayback';
import { toBlockRows } from './lib/mqsimBlocks';
import { toStatItems } from './lib/mqsimStats';
import { toWearRows } from './lib/mqsimWear';
import type { PresetId } from './types';

// A param change reconfigures the engine on a short debounce (rather than
// on every slider-drag tick) - see the effect below.
const PARAM_APPLY_DEBOUNCE_MS = 400;

// "GC 시연"'s workload needs ~2.3M event-groups to reach its first GC (see
// buildGcWorkloadXml's doc comment for why this got bigger, not smaller,
// after the deadlock fix), and "마모평준화 시연"'s needs ~2.8M to reach its
// one WL execution (both measured via a WASM/native step-count harness)
// versus "매핑 기본"'s few dozen, so they get much larger per-speed-unit
// multipliers. Only presets with a real engine config need an entry here;
// anything else defaults to 1 in useSimulationPlayback.
const TICKS_MULTIPLIER: Partial<Record<PresetId, number>> = {
  gc: 12000,
  'wear-leveling': 15000,
};

// Presets wired to the real WASM engine - each needs its own SsdParams
// (block/page counts, GC threshold, ...) since "GC 시연" deliberately uses
// a much higher GC_Exec_Threshold than "매핑 기본", and "마모평준화 시연"
// needs both a much larger block count and a far lower
// Static_Wearleveling_Threshold (see DEFAULT_WL_PARAMS' doc comment in
// mqsimConfigs.ts for why - short version: a real upstream bug meant this
// value was never actually configurable until now).
const WIRED_PRESET_DEFAULTS: Partial<Record<PresetId, SsdParams>> = {
  mapping: DEFAULT_MAPPING_PARAMS,
  gc: DEFAULT_GC_PARAMS,
  'wear-leveling': DEFAULT_WL_PARAMS,
};

function buildWorkloadXmlFor(presetId: PresetId, params: SsdParams, workload: WorkloadParams): string {
  switch (presetId) {
    case 'gc':
      return buildGcWorkloadXml(params, workload);
    case 'wear-leveling':
      return buildWlWorkloadXml(params, workload);
    default:
      return buildMappingWorkloadXml(params, workload);
  }
}

function App() {
  const [activeId, setActiveId] = useState<PresetId>('mapping');
  const active = presets.find((p) => p.id === activeId) ?? presets[0];

  const [paramsByPreset, setParamsByPreset] = useState<Record<string, SsdParams>>({
    mapping: DEFAULT_MAPPING_PARAMS,
    gc: DEFAULT_GC_PARAMS,
    'wear-leveling': DEFAULT_WL_PARAMS,
  });
  // Session 10: workload generator knobs (sequential/random, read/write
  // 비율, burst 크기), independent of SsdParams and keyed per-preset the
  // same way - all three wired presets start from the same DEFAULT_
  // WORKLOAD_PARAMS since that's exactly what their tuned Working_Set_
  // Percentage/Stop_Time values (mqsimConfigs.ts) were verified against.
  const [workloadByPreset, setWorkloadByPreset] = useState<Record<string, WorkloadParams>>({
    mapping: DEFAULT_WORKLOAD_PARAMS,
    gc: DEFAULT_WORKLOAD_PARAMS,
    'wear-leveling': DEFAULT_WORKLOAD_PARAMS,
  });
  // Whichever wired preset is active drives the one live engine instance;
  // presets not in WIRED_PRESET_DEFAULTS just keep it configured for
  // 'mapping' in the background (harmless - its data isn't shown for them).
  const configKey: PresetId = WIRED_PRESET_DEFAULTS[activeId] ? activeId : 'mapping';
  const activeParams = paramsByPreset[configKey];
  const activeWorkload = workloadByPreset[configKey];
  const ssdConfigXml = useMemo(() => buildSsdConfigXml(activeParams), [activeParams]);
  const workloadXml = useMemo(
    () => buildWorkloadXmlFor(configKey, activeParams, activeWorkload),
    [configKey, activeParams, activeWorkload],
  );

  const engine = useMqsimEngine(ssdConfigXml, workloadXml);
  const events = useMqsimEvents(engine.subscribeEvents, engine.ready);
  const migrations = useMqsimMigrations(engine.subscribeEvents, engine.ready);
  const playback = useSimulationPlayback({
    engine,
    onRefresh: async () => {
      await engine.refresh();
      events.commit();
      migrations.commit();
    },
    onRestart: () => {
      events.reset();
      migrations.reset();
    },
    ticksMultiplier: TICKS_MULTIPLIER[activeId] ?? 1,
  });

  // Reconfigures the engine whenever the active preset's params (or the
  // preset itself) change - restart() already does exactly this (it calls
  // engine.configure(), which closes over the current ssdConfigXml/
  // workloadXml) plus resets playback/event state, so this is handled
  // identically to pressing ⏮. Skips the very first run since
  // useMqsimEngine's own init() already applied these same default params.
  //
  // Preset switches reconfigure IMMEDIATELY (no debounce) - `wired` (and
  // so the Toolbar's disabled state) flips true the instant activeId
  // changes, in the same render, well before this effect can even run.
  // Debouncing a preset switch left a real window where pressing play
  // would start running against the *previous* preset's still-loaded
  // config, only to be silently paused and reset once the debounced
  // restart() finally fired - looked exactly like "pressed play, it just
  // stopped" for "GC 시연" if you didn't wait ~400ms before pressing play.
  // Only a same-preset param edit (a slider drag) still needs debouncing,
  // to avoid reconfiguring on every intermediate drag value.
  const prevConfigKeyRef = useRef(configKey);
  const isFirstConfigRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstConfigRenderRef.current) {
      isFirstConfigRenderRef.current = false;
      prevConfigKeyRef.current = configKey;
      return;
    }
    if (!engine.ready) return;

    const presetSwitched = prevConfigKeyRef.current !== configKey;
    prevConfigKeyRef.current = configKey;

    if (presetSwitched) {
      void playback.restart();
      return;
    }

    const id = setTimeout(() => {
      void playback.restart();
    }, PARAM_APPLY_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssdConfigXml, workloadXml, engine.ready]);

  const wired = Boolean(WIRED_PRESET_DEFAULTS[activeId]) && engine.ready;

  // → advances one read/write, same as clicking ⏭ (Toolbar.tsx) - matches
  // the ⏭ button's own enabled condition exactly. Skipped while focus is on
  // an <input>/<select> (a param slider, the chip-count radios, the speed
  // slider) so ArrowRight keeps doing that control's own native thing
  // (nudging a slider/radio) instead of being hijacked into a step.
  const stepShortcutRef = useRef({ canStep: false, stepOnce: playback.stepOnce });
  useEffect(() => {
    stepShortcutRef.current = { canStep: wired && playback.hasMore && !playback.isPlaying, stepOnce: playback.stepOnce };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' || e.repeat || !stepShortcutRef.current.canStep) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      void stepShortcutRef.current.stepOnce();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isWearPreset = activeId === 'wear-leveling';
  const blockRows = wired && !isWearPreset ? toBlockRows(engine.state, migrations.movingKeys) : active.blocks;
  const wearRows = wired && isWearPreset ? toWearRows(engine.state) : active.wearRows;
  const statItems = wired ? toStatItems(engine.state, events.counters) : active.stats;
  const logEntries = wired ? events.log : active.log;
  const caption = wired ? '' : active.caption;

  return (
    <div className="sim-app">
      <header className="sim-app-header">
        <h1>FTL Visual Simulator</h1>
      </header>
      <div className="sim-mockup">
        <Toolbar
          presets={presets}
          activeId={activeId}
          onSelect={setActiveId}
          playback={{
            isPlaying: playback.isPlaying,
            speed: playback.speed,
            hasMore: playback.hasMore,
            disabled: !wired,
            onStepOnce: playback.stepOnce,
            onTogglePlay: playback.togglePlay,
            onRestart: playback.restart,
            onSpeedChange: playback.setSpeed,
          }}
        />
        <div className="sim-body">
          {blockRows && <FlashGrid blocks={blockRows} caption={caption} />}
          {wearRows && <WearLevelingView rows={wearRows} caption={caption} />}
          {/* All three wired presets get the 로그 column now - previously
              마모평준화 시연 was excluded (it never had a mapping table),
              but once 로그 became a general chronological event log rather
              than an LPA/PPA snapshot table, there's no reason to withhold
              it there too - it also keeps the sidebar/stats column widths
              consistent across all three presets instead of only the other
              two having a 4th column competing for space. Keyed off `wired`
              alone (not whether logEntries currently has anything in it) so
              the column - and its "재생을 눌러보세요" empty state - stays
              visible from the moment a preset is selected. */}
          {wired && (
            <div className="sim-mapping-col">
              <MappingTable log={logEntries} />
            </div>
          )}
          <div className="sim-sidebar">
            <ParamPanel
              params={activeParams}
              onChange={(next) => setParamsByPreset((prev) => ({ ...prev, [configKey]: next }))}
              disabled={!wired}
            />
            <WorkloadPanel
              workload={activeWorkload}
              onChange={(next) => setWorkloadByPreset((prev) => ({ ...prev, [configKey]: next }))}
              disabled={!wired}
            />
          </div>
          <div className="sim-stats-col">
            <StatsPanel stats={statItems} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
