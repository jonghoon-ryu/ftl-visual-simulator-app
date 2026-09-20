import type { SsdParams } from '../data/mqsimConfigs';
import type { PresetId } from '../types';

const PAGE_CAPACITY_OPTIONS: SsdParams['pageCapacityBytes'][] = [4096, 8192, 16384];
const CHIP_COUNT_OPTIONS: SsdParams['chipCount'][] = [1, 2, 4];

// GC_Block_Selection_Policy_Type's 6 real values (Device_Parameter_Set.cpp).
// RGA first/default - the one this project's presets were originally tuned
// against, though all 6 are now verified safe at this project's scale (a
// real GREEDY/FIFO crash bug was found and fixed the same session this was
// exposed) - see SsdParams.gcBlockSelectionPolicy's doc comment for the
// full investigation and the real efficiency differences between them.
const GC_POLICY_OPTIONS: SsdParams['gcBlockSelectionPolicy'][] = [
  'RGA',
  'GREEDY',
  'RANDOM',
  'RANDOM_P',
  'RANDOM_PP',
  'FIFO',
];
const GC_POLICY_LABELS: Record<SsdParams['gcBlockSelectionPolicy'], string> = {
  RGA: 'RGA (기본)',
  GREEDY: 'Greedy',
  RANDOM: 'Random',
  RANDOM_P: 'Random-p',
  RANDOM_PP: 'Random-pp',
  FIFO: 'FIFO',
};

// GC_and_WL_Unit_Page_Level's max_ongoing_gc_reqs_per_plane doubles as
// Stop_servicing_writes()'s hard threshold (free block pool size below this
// blocks all writes). At too few blocks, the free pool dips to/below that
// threshold within the first few writes (frontier blocks alone eat into
// it), writes get hard-blocked, and GC can't free anything yet (nothing's
// been overwritten, so there's nothing invalid to reclaim) - a permanent
// deadlock. This constant used to be MQSim's unconfigurable upstream 10
// (boundary: exactly 13 blocks worked, 12 stalled), but this project lowered
// it to 4 - see /ftl-visual-simulator/reference/tweaked-code/ - which moved
// the boundary down too: confirmed empirically (same method as the original
// finding - native/WASM harness, independent of OP ratio and pages-per-
// block) that 7 blocks works, 6 stalls. 8 keeps a small margin above that.
const MIN_BLOCK_NO_PER_PLANE = 8;

// "매핑 기본" is deliberately tuned so GC never meaningfully fires (5%
// threshold, 100% working set, short Stop_Time - see [[ftl_visual_simulator_project]]
// memory for the full comparison against "GC 시연"'s opposite tuning). The
// shared 1-95% slider range let a user push this preset's threshold well
// past where "GC 시연" actually needs it, inviting exactly the confusion
// Ryu ran into ("왜 매핑 기본과 GC 시연이 따로 있어야 하는지 모르겠다") -
// a wide-open slider implies GC is this preset's concern too. Narrowed to
// 1-10% here specifically so the range itself signals "not the focus of
// this preset" - "GC 시연"/"마모평준화 시연" keep the full range, since
// exploring where GC actually kicks in is the point there.
const GC_THRESHOLD_RANGE: Record<PresetId, { min: number; max: number }> = {
  mapping: { min: 1, max: 10 },
  gc: { min: 1, max: 95 },
  'wear-leveling': { min: 1, max: 95 },
};

interface Props {
  presetId: PresetId;
  params: SsdParams;
  onChange: (next: SsdParams) => void;
  disabled: boolean;
}

// Real, editable controls for the plan's Session 9 spec ("page 크기,
// block/page 개수, OP 비율, GC 임계값, 매핑 방식") - replaces the old
// purely-decorative version (a styled <span> standing in for a <select>,
// a CSS-only slider). Editing a value here doesn't reconfigure the engine
// by itself - App.tsx watches `params` and reconfigures after a short
// debounce, reusing the same reset flow as the ⏮ restart button.
export function ParamPanel({ presetId, params, onChange, disabled }: Props) {
  const gcThresholdRange = GC_THRESHOLD_RANGE[presetId];
  return (
    <div className="sim-panel">
      <div className="param-row">
        <div className="param-label">
          <span>Page 크기</span>
          <span>{params.pageCapacityBytes / 1024}KB</span>
        </div>
        <select
          className="param-select"
          disabled={disabled}
          value={params.pageCapacityBytes}
          onChange={(e) =>
            onChange({ ...params, pageCapacityBytes: Number(e.target.value) as SsdParams['pageCapacityBytes'] })
          }
        >
          {PAGE_CAPACITY_OPTIONS.map((kb) => (
            <option key={kb} value={kb}>
              {kb / 1024}KB
            </option>
          ))}
        </select>
        <div className="param-hint">
          이 값을 바꿔도 화면상 차이는 없습니다 - Read/Program 지연시간이 고정값으로 처리되고, Flash Array 는 페이지
          개수(Block 당 Page 개수)만 그리기 때문입니다
        </div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>칩(Chip) 개수</span>
        </div>
        <div className="param-radio-group" role="radiogroup" aria-label="칩 개수">
          {CHIP_COUNT_OPTIONS.map((count) => (
            <label key={count} className="param-radio-option">
              <input
                type="radio"
                name="chip-count"
                disabled={disabled}
                checked={params.chipCount === count}
                onChange={() => onChange({ ...params, chipCount: count })}
              />
              {count}
            </label>
          ))}
        </div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>Block 개수</span>
          <span>{params.blockNoPerPlane}</span>
        </div>
        <input
          className="param-slider"
          type="range"
          min={MIN_BLOCK_NO_PER_PLANE}
          max={64}
          step={1}
          disabled={disabled}
          value={params.blockNoPerPlane}
          onChange={(e) => onChange({ ...params, blockNoPerPlane: Number(e.target.value) })}
        />
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>Block 당 Page 개수</span>
          <span>{params.pageNoPerBlock}</span>
        </div>
        <input
          className="param-slider"
          type="range"
          min={4}
          max={64}
          step={1}
          disabled={disabled}
          value={params.pageNoPerBlock}
          onChange={(e) => onChange({ ...params, pageNoPerBlock: Number(e.target.value) })}
        />
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>Over-provisioning</span>
          <span>{Math.round(params.overprovisioningRatio * 100)}%</span>
        </div>
        <input
          className="param-slider"
          type="range"
          min={0}
          max={30}
          step={1}
          disabled={disabled}
          value={Math.round(params.overprovisioningRatio * 100)}
          onChange={(e) => onChange({ ...params, overprovisioningRatio: Number(e.target.value) / 100 })}
        />
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>GC 임계값</span>
          <span>{Math.round(params.gcExecThreshold * 100)}%</span>
        </div>
        <input
          className="param-slider"
          type="range"
          min={gcThresholdRange.min}
          max={gcThresholdRange.max}
          step={1}
          disabled={disabled}
          value={Math.round(params.gcExecThreshold * 100)}
          onChange={(e) => onChange({ ...params, gcExecThreshold: Number(e.target.value) / 100 })}
        />
        <div className="param-hint">
          빈 block 비율이 이 아래로 떨어지면 GC 시작
          {presetId === 'mapping' && ' - 이 프리셋은 GC 가 거의 발동하지 않도록 설계돼 있어 범위를 좁혀뒀습니다'}
        </div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>GC 알고리즘</span>
          <span>{GC_POLICY_LABELS[params.gcBlockSelectionPolicy]}</span>
        </div>
        <select
          className="param-select"
          disabled={disabled}
          value={params.gcBlockSelectionPolicy}
          onChange={(e) =>
            onChange({ ...params, gcBlockSelectionPolicy: e.target.value as SsdParams['gcBlockSelectionPolicy'] })
          }
        >
          {GC_POLICY_OPTIONS.map((policy) => (
            <option key={policy} value={policy}>
              {GC_POLICY_LABELS[policy]}
            </option>
          ))}
        </select>
        <div className="param-hint">지워질 block(victim)을 고르는 방식 - 알고리즘마다 GC 가 실제로 얼마나 효율적인지 다릅니다 (예: Random 은 RGA/Greedy 보다 훨씬 자주 헛수고함)</div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>매핑 방식</span>
          <span>Page-level</span>
        </div>
        <select className="param-select" disabled={disabled} value={params.addressMapping} onChange={() => {}}>
          <option value="PAGE_LEVEL">Page-level</option>
          <option value="HYBRID" disabled>
            Hybrid (구현 예정)
          </option>
        </select>
        <div className="param-hint">Hybrid 는 MQSim 원본에도 미구현</div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>엔진 시드</span>
        </div>
        <input
          className="param-number"
          type="number"
          disabled={disabled}
          value={params.deviceSeed}
          onChange={(e) => onChange({ ...params, deviceSeed: Number(e.target.value) })}
        />
        <div className="param-hint">
          선택한 GC 알고리즘의 무작위성(예: RGA/Random 계열의 후보 block 추첨)이나 동적 마모평준화 등, 엔진 내부
          랜덤성의 시드
        </div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>워크로드 시드</span>
        </div>
        <input
          className="param-number"
          type="number"
          disabled={disabled}
          value={params.workloadSeed}
          onChange={(e) => onChange({ ...params, workloadSeed: Number(e.target.value) })}
        />
        <div className="param-hint">어떤 LPN 을 읽고 쓸지 정하는 워크로드 생성기의 시드</div>
      </div>
    </div>
  );
}
