import { READ_PERCENTAGE_MAX, WORKING_SET_OPTIONS, type WorkloadParams } from '../data/mqsimConfigs';
import type { PresetId } from '../types';

// MQSim's Utils::Address_Distribution_Type only exposes STREAMING
// ("sequential") and RANDOM_UNIFORM ("random") here - see WorkloadParams'
// doc comment in mqsimConfigs.ts for why the other two real modes
// (MIXED_STREAMING_RANDOM, RANDOM_HOTCOLD) are left out.

interface Props {
  presetId: PresetId;
  workload: WorkloadParams;
  onChange: (next: WorkloadParams) => void;
  disabled: boolean;
}

// Session 10 spec ("workload 생성기 컨트롤 - sequential/random") - same
// pattern as ParamPanel.tsx: editing a value here doesn't reconfigure the
// engine by itself, App.tsx watches `workload` and reconfigures after the
// same short debounce used for SsdParams edits.
// A "burst 크기" (request size) control existed briefly (2026-09-20) but
// was removed - see AVERAGE_REQUEST_SIZE_SECTORS' comment in
// mqsimConfigs.ts for why. "Read 비율" was removed the same session, for a
// related reason - see READ_PERCENTAGE's comment in mqsimConfigs.ts: a
// read to an LPA with no mapping yet silently reserves a real page (MQSim's
// lazy stand-in for the preconditioning pass this project skips), which is
// confusing at this project's small demo scale and unrelated to what this
// project's GC/WL demos are actually about.
export function WorkloadPanel({ presetId, workload, onChange, disabled }: Props) {
  return (
    <div className="sim-panel">
      <div className="sim-panel-title">Workload</div>

      <div
        className="param-row"
        title="Random: 매 요청마다 완전히 무작위 주소(LPN). Sequential: 시작 주소는 무작위로 정해지지만, 그 이후로는 LPN 이 1씩 순서대로 증가합니다. 두 경우 모두 Flash Array 화면에서 실제로 채워지는 칸의 순서는 항상 동일합니다 - 차이는 로그의 LPN 값에서만 보입니다."
      >
        <div className="param-label">
          <span>접근 패턴</span>
          <span>{workload.addressDistribution === 'STREAMING' ? 'Sequential' : 'Random'}</span>
        </div>
        <select
          className="param-select"
          disabled={disabled}
          value={workload.addressDistribution}
          onChange={(e) =>
            onChange({ ...workload, addressDistribution: e.target.value as WorkloadParams['addressDistribution'] })
          }
        >
          <option value="RANDOM_UNIFORM">Random</option>
          <option value="STREAMING">Sequential</option>
        </select>
      </div>

      {presetId === 'gc' && (
        <div className="param-row">
          <div className="param-label">
            <span>작업 범위 (working set)</span>
            <span>{workload.workingSetPercent}%</span>
          </div>
          <select
            className="param-select"
            aria-label="작업 범위"
            disabled={disabled}
            value={workload.workingSetPercent}
            onChange={(e) => onChange({ ...workload, workingSetPercent: Number(e.target.value) })}
          >
            {WORKING_SET_OPTIONS.map((p) => (
              <option key={p} value={p}>
                LPN 의 {p}%{p === 80 ? ' (OP 10% 에서는 가득 참)' : ''}
              </option>
            ))}
          </select>
          <div className="param-hint">
            호스트가 쓰고 읽는 LPN 의 범위. 40% 면 앞쪽 40% 의 LPN 만 계속 덮어써요. 한 번도 안 쓰는 나머지 LPN 은 그만큼
            flash 에 여유를 남겨서 Over-provisioning 처럼 작동해요. 범위를 넓히면 GC 가 고르는 block 에 valid page 가
            많아져 WAF 가 올라가고(25%: 약 1.3× · 40%: 약 2.3× · 60%: 약 5.5×), 80% 에서는 OP 10% 로는 장치가 가득 차서
            멈춰요(OP 를 30% 로 올리면 돌아가요). 이 데모의
            SSD 는 칩마다 block 이 12개뿐이라, MQSim 이 쓰기 위치용 block 과 GC 용 여유 block 으로 칩의 절반쯤을 늘 비워 두기
            때문이에요 - 실제 SSD 는 block 이 수천 개라 이 몫이 아주 작아요.
          </div>
        </div>
      )}

      <div className="param-row">
        <div className="param-label">
          <span>읽기 비율</span>
          <span>{workload.readPercentage}%</span>
        </div>
        <input
          className="param-slider"
          type="range"
          min={0}
          max={READ_PERCENTAGE_MAX}
          step={10}
          disabled={disabled}
          value={workload.readPercentage}
          onChange={(e) => onChange({ ...workload, readPercentage: Number(e.target.value) })}
        />
        <div className="param-hint">
          호스트 요청 중 읽기의 비율. 한 번도 안 쓴 LPN 을 읽으면 flash 를 거치지 않고 바로 끝나요(실제 SSD 가 0 을
          돌려주듯). GC 시연에서 올리면 "비교 실험실" 탭 맨 아래의 "읽기 지연" 차트로 GC 가 읽기를 얼마나 느리게 만드는지 볼 수 있어요.
        </div>
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>DRAM 쓰기 캐시</span>
          <span>{workload.writeCache ? '켜짐' : '꺼짐'}</span>
        </div>
        <label className="param-toggle">
          <input
            type="checkbox"
            disabled={disabled}
            checked={workload.writeCache}
            onChange={(e) => onChange({ ...workload, writeCache: e.target.checked })}
          />
          캐시 사용
        </label>
        <div className="param-hint">
          켜면 SSD 안의 DRAM 이 쓰기를 먼저 받아서, 같은 page 에 대한 반복 쓰기를 흡수하고 작은 쓰기를 page 단위로
          모아서 flash 에 내려보내요(캐시 32 page, 가득 차면 가장 오래 안 쓴 page 부터). 통계의 "호스트 요청 → flash 쓰기"를
          켰을 때와 껐을 때 비교해보세요 - 끄면 거의 모든 요청이 flash 쓰기가 되고 요청 하나당 GC 도 약 1.4배가 됩니다.
        </div>
      </div>
    </div>
  );
}
