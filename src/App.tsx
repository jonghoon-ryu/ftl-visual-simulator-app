import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { FlashGrid } from './components/FlashGrid';
import { MappingTable } from './components/MappingTable';
import { ParamPanel } from './components/ParamPanel';
import { FreeBlockChart } from './components/FreeBlockChart';
import { GcVictimExplanation } from './components/GcVictimExplanation';
import { GcPolicyComparison } from './components/GcPolicyComparison';
import { PredictQuiz } from './components/PredictQuiz';
import { useFreeBlockHistory } from './hooks/useFreeBlockHistory';
import { useLpnJourney } from './hooks/useLpnJourney';
import { LpnJourneyPanel } from './components/LpnJourneyPanel';
import { StatsPanel } from './components/StatsPanel';
import { Toolbar } from './components/Toolbar';
import { UsageGuide } from './components/UsageGuide';
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
import { useMqsimOverwrites } from './hooks/useMqsimOverwrites';
import { useMqsimWlHighlight } from './hooks/useMqsimWlHighlight';
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

// Same idea for the DRAM write cache turned off (WorkloadPanel): measured
// ~50k event-groups for "GC 시연" and ~40k for "마모평준화 시연" to finish
// (vs ~17.4M / ~21M cached) - these keep a run at roughly the same ~180
// ticks at speed 8.
const TICKS_MULTIPLIER_NO_CACHE: Partial<Record<PresetId, number>> = {
  gc: 35,
  'wear-leveling': 28,
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
  const [showUsageGuide, setShowUsageGuide] = useState(false);
  const active = presets.find((p) => p.id === activeId) ?? presets[0];

  const [paramsByPreset, setParamsByPreset] = useState<Record<string, SsdParams>>({
    mapping: DEFAULT_MAPPING_PARAMS,
    gc: DEFAULT_GC_PARAMS,
    'wear-leveling': DEFAULT_WL_PARAMS,
  });
  // Session 10: workload generator knobs (sequential/random, read/write
  // 비율), independent of SsdParams and keyed per-preset the
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
  const overwrites = useMqsimOverwrites(engine.subscribeEvents, engine.ready);
  const wlHighlight = useMqsimWlHighlight(engine.subscribeEvents, engine.ready);
  const freeBlocks = useFreeBlockHistory(engine.subscribeEvents, engine.ready);
  const lpnJourney = useLpnJourney(engine.subscribeEvents, engine.ready);
  const playback = useSimulationPlayback({
    engine,
    onRefresh: async (opts) => {
      const refreshed = await engine.refresh();
      events.commit();
      freeBlocks.commit(refreshed);
      lpnJourney.commit();
      // batchEnded: this tick's run() call reached the simulation's natural
      // end mid-batch - any pending moving/erasing overlay reflects a huge
      // multi-step batch, not a single meaningful moment, and nothing will
      // ever arrive to clear it since playback just stopped. Clear instead
      // of committing it, so the final frame matches what stepping one
      // event at a time to the same point would show (found 2026-09-20 by
      // comparing "5 steps"-button vs "▶" screenshots at an identical log
      // position - the ▶ one left several blocks stuck mid-migration/erase).
      if (opts?.batchEnded) {
        migrations.reset();
        overwrites.reset();
      } else {
        migrations.commit();
        overwrites.commit();
      }
      // Always commit, batchEnded or not - unlike the transient GC overlays
      // above, this is a persistent marker (see useMqsimWlHighlight), and
      // the single rare WL event is actually *likely* to fall inside the
      // final giant batch, so this is exactly the case we most need to
      // still catch rather than discard. A fresh trigger returns true here,
      // which useSimulationPlayback reads as "stop ▶ now" - see
      // RefreshResult's doc comment there for why (Ryu, 2026-09-20: pause
      // right when it fires, don't keep playing past it).
      return { shouldPause: wlHighlight.commit() };
    },
    onRestart: () => {
      events.reset();
      migrations.reset();
      overwrites.reset();
      wlHighlight.reset();
      freeBlocks.reset();
      lpnJourney.reset();
    },
    // With the DRAM write cache off a run is ~350-500x fewer event-groups
    // (every write goes to flash, so far fewer host requests fit before
    // Stop_Time), so the cached multipliers would finish it in a tick or
    // two - see TICKS_MULTIPLIER_NO_CACHE.
    ticksMultiplier: (activeWorkload.writeCache ? TICKS_MULTIPLIER : TICKS_MULTIPLIER_NO_CACHE)[activeId] ?? 1,
    // "매핑 기본" plays one log line at a time instead of a fixed number of
    // event-groups - see useSimulationPlayback's playUnit. The other two
    // presets keep event-group pacing: their log lines are dense enough,
    // and TICKS_MULTIPLIER is tuned around it.
    playUnit: activeId === 'mapping' ? 'logEvents' : 'eventGroups',
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

  // → advances one loggable event, same as clicking "1 step" (Toolbar.tsx) -
  // matches that button's own enabled condition exactly. Skipped while
  // focus is on an <input>/<select> (a param slider, the chip-count radios,
  // the speed slider) so ArrowRight keeps doing that control's own native
  // thing (nudging a slider/radio) instead of being hijacked into a step.
  const stepShortcutRef = useRef({ canStep: false, stepEventOnce: playback.stepEventOnce });
  useEffect(() => {
    stepShortcutRef.current = {
      // Same "마모평준화 시연" exclusion as Toolbar's step buttons below -
      // pointless there (see hideStepButtons' doc comment), so the → key
      // shouldn't silently do it either.
      canStep: wired && activeId !== 'wear-leveling' && playback.hasMore && !playback.isPlaying,
      stepEventOnce: playback.stepEventOnce,
    };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' || e.repeat || !stepShortcutRef.current.canStep) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      void stepShortcutRef.current.stepEventOnce();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const isWearPreset = activeId === 'wear-leveling';
  const blockRows =
    wired && !isWearPreset
      ? toBlockRows(engine.state, migrations.movingKeys, overwrites.supersededKeys, overwrites.erasingBlockKeys)
      : active.blocks;
  const wearRows = wired && isWearPreset ? toWearRows(engine.state, wlHighlight.wlTargetCounts) : active.wearRows;
  const wlTrigger = wired ? wlHighlight.lastTrigger : (active.wlTrigger ?? null);
  // Mock preview (unwired) has no real play/pause to dismiss on, so its
  // banner just always shows - only the wired, real-engine path needs the
  // dismiss-on-resume behavior (see wlHighlight.dismissBanner below).
  const wlBannerVisible = wired ? wlHighlight.bannerVisible : true;
  const statItems = wired ? toStatItems(engine.state, events.counters) : active.stats;
  // The run ended with host writes still parked for lack of free pages -
  // e.g. "매핑 기본" (100% working set) at a small capacity fills the whole
  // device before anything is overwritten, so GC has nothing to reclaim and
  // the demo ends there by design (see DEFAULT_MAPPING_PARAMS). Without
  // this, playback just stops with no visible reason.
  // Only where GC actually runs - "매핑 기본" is tuned so GC almost never
  // fires, so its line would just sit flat above the threshold.
  const freeBlockChart =
    wired && (configKey === 'gc' || configKey === 'wear-leveling') ? <FreeBlockChart history={freeBlocks.history} /> : null;
  const deviceFull = wired && !playback.hasMore && (engine.state?.stats.writesWaitingForSpace ?? 0) > 0;
  const logEntries = wired ? events.log : active.log;
  const caption = wired ? '' : active.caption;

  return (
    <div className="sim-app">
      <div className="sim-mockup">
        <Toolbar
          presets={presets}
          activeId={activeId}
          onSelect={setActiveId}
          hideStepButtons={activeId === 'wear-leveling'}
          playback={{
            isPlaying: playback.isPlaying,
            speed: playback.speed,
            hasMore: playback.hasMore,
            disabled: !wired,
            onStepEventOnce: playback.stepEventOnce,
            onStepEventMany: () => playback.stepEventMany(5),
            onTogglePlay: () => {
              // Resuming (not pausing) past the auto-pause WL caused - the
              // banner already did its job of making a beginner stop and
              // look, so dismiss it right as playback moves on again (Ryu,
              // 2026-09-20: it read as stuck/stale once the sim kept going).
              if (!playback.isPlaying) wlHighlight.dismissBanner();
              playback.togglePlay();
            },
            onRestart: playback.restart,
            onSpeedChange: playback.setSpeed,
          }}
        />
        <div className="sim-body">
          {blockRows && (
            <FlashGrid
              blocks={blockRows}
              caption={caption}
              banner={
                <>
                  {wired && <PredictQuiz key={configKey} presetId={configKey} />}
                  {wired && configKey === 'gc' && <GcVictimExplanation gc={freeBlocks.lastGc} params={activeParams} />}
                </>
              }
              trackedCurrentKey={lpnJourney.journey?.currentKey}
              trackedOldKeys={lpnJourney.journey?.oldKeys}
              footer={
                <>
                  {freeBlockChart}
                  {wired && configKey === 'gc' && <GcPolicyComparison params={activeParams} workload={activeWorkload} />}
                </>
              }
            />
          )}
          {wearRows && (
            <WearLevelingView
              rows={wearRows}
              caption={caption}
              trigger={wlTrigger}
              bannerVisible={wlBannerVisible}
              footer={freeBlockChart}
              banner={wired ? <PredictQuiz key={configKey} presetId={configKey} /> : null}
            />
          )}
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
              {lpnJourney.journey && (
                <LpnJourneyPanel
                  journey={lpnJourney.journey}
                  showsGrid={!!blockRows}
                  onClose={() => lpnJourney.select(null)}
                />
              )}
              <MappingTable
                log={logEntries}
                trackedLpnKey={lpnJourney.journey?.lpnKey ?? null}
                onSelectLpn={(key, label) => lpnJourney.select(key, label)}
              />
            </div>
          )}
          <div className="sim-sidebar">
            <ParamPanel
              presetId={configKey}
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
            {deviceFull && (
              <div className="device-full-status">
                <strong>장치가 가득 찼어요</strong>
                <p>
                  남은 쓰기 {engine.state?.stats.writesWaitingForSpace}개가 빈 page 를 기다리다 끝났어요. 빈 page 가
                  없는데 GC 가 청소할 invalid page(덮어써서 무효가 된 page)도 남아 있지 않아서예요. Block 개수, Block 당
                  Page 개수, 또는 Over-provisioning 을 늘려보세요.
                </p>
              </div>
            )}
            <StatsPanel stats={statItems} />
          </div>
        </div>
      </div>
      <button type="button" className="usage-guide-button" onClick={() => setShowUsageGuide(true)}>
        사용법
      </button>
      {showUsageGuide && <UsageGuide onClose={() => setShowUsageGuide(false)} />}
    </div>
  );
}

export default App;
