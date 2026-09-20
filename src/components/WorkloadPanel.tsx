import type { WorkloadParams } from '../data/mqsimConfigs';

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
    </div>
  );
}
