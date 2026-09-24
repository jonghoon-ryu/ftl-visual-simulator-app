import { READ_PERCENTAGE_MAX, type WorkloadParams } from '../data/mqsimConfigs';

// MQSim's Utils::Address_Distribution_Type only exposes STREAMING
// ("sequential") and RANDOM_UNIFORM ("random") here - see WorkloadParams'
// doc comment in mqsimConfigs.ts for why the other two real modes
// (MIXED_STREAMING_RANDOM, RANDOM_HOTCOLD) are left out.

interface Props {
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
export function WorkloadPanel({ workload, onChange, disabled }: Props) {
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
          돌려주듯). GC 시연에서 올리면 "읽기 지연" 차트로 GC 가 읽기를 얼마나 느리게 만드는지 볼 수 있어요.
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
          모아서 flash 에 내려보내요. 통계의 "호스트 요청 → flash 쓰기"를 켰을 때와 껐을 때 비교해보세요 - 끄면 거의 모든
          요청이 flash 쓰기가 되고 GC 도 훨씬 자주 일어납니다.
        </div>
      </div>
    </div>
  );
}
