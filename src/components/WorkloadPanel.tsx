import type { WorkloadParams } from '../data/mqsimConfigs';

// MQSim's Utils::Address_Distribution_Type only exposes STREAMING
// ("sequential") and RANDOM_UNIFORM ("random") here - see WorkloadParams'
// doc comment in mqsimConfigs.ts for why the other two real modes
// (MIXED_STREAMING_RANDOM, RANDOM_HOTCOLD) are left out.
const MAX_READ_PERCENTAGE = 80;
const MAX_BURST_SIZE = 64;

interface Props {
  workload: WorkloadParams;
  onChange: (next: WorkloadParams) => void;
  disabled: boolean;
}

// Session 10 spec ("workload 생성기 컨트롤 - sequential/random, read/write
// 비율, burst 크기") - same pattern as ParamPanel.tsx: editing a value here
// doesn't reconfigure the engine by itself, App.tsx watches `workload` and
// reconfigures after the same short debounce used for SsdParams edits.
export function WorkloadPanel({ workload, onChange, disabled }: Props) {
  return (
    <div className="sim-panel">
      <div className="sim-panel-title">Workload</div>

      <div className="param-row">
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
          <span>Read 비율</span>
          <span>{workload.readPercentage}%</span>
        </div>
        <input
          className="param-slider"
          type="range"
          min={0}
          max={MAX_READ_PERCENTAGE}
          step={5}
          disabled={disabled}
          value={workload.readPercentage}
          onChange={(e) => onChange({ ...workload, readPercentage: Number(e.target.value) })}
        />
      </div>

      <div className="param-row">
        <div className="param-label">
          <span>Burst 크기</span>
          <span>{workload.burstSize} page</span>
        </div>
        <input
          className="param-slider"
          type="range"
          min={1}
          max={MAX_BURST_SIZE}
          step={1}
          disabled={disabled}
          value={workload.burstSize}
          onChange={(e) => onChange({ ...workload, burstSize: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
