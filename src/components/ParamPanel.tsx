import type { SsdParams } from '../data/mqsimConfigs';

const PAGE_CAPACITY_OPTIONS: SsdParams['pageCapacityBytes'][] = [4096, 8192, 16384];
const CHIP_COUNT_OPTIONS: SsdParams['chipCount'][] = [1, 2, 4];

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

interface Props {
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
export function ParamPanel({ params, onChange, disabled }: Props) {
  return (
    <div className="sim-panel">
      <div className="sim-panel-title">파라미터</div>

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
        <div className="param-hint">한 페이지에 담기는 데이터 크기</div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>칩(Chip) 개수</span>
          <span>{params.chipCount}</span>
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
        <div className="param-hint">칩이 여러 개면 read/write 가 칩들에 나뉘어 처리돼요 - block/wear 목록에 칩 번호가 붙어요</div>
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
        <div className="param-hint">Flash 배열에 들어있는 block 수 - 늘리면 grid 가 커져요</div>
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
        <div className="param-hint">Block 하나를 지울 때 함께 지워지는 page 수</div>
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
        <div className="param-hint">여유 공간을 더 두면 GC 가 덜 급해져요</div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>GC 임계값</span>
          <span>{Math.round(params.gcExecThreshold * 100)}%</span>
        </div>
        <input
          className="param-slider"
          type="range"
          min={1}
          max={30}
          step={1}
          disabled={disabled}
          value={Math.round(params.gcExecThreshold * 100)}
          onChange={(e) => onChange({ ...params, gcExecThreshold: Number(e.target.value) / 100 })}
        />
        <div className="param-hint">빈 block 비율이 이 아래로 떨어지면 GC 시작</div>
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
        <div className="param-hint">Hybrid 는 MQSim 원본에도 미구현이라 이 시뮬레이터에서도 선택만 가능해요</div>
      </div>

      {!disabled && <div className="param-apply-hint">값을 바꾸면 잠시 후 자동으로 적용돼요 (⏮ 재시작과 동일)</div>}
    </div>
  );
}
