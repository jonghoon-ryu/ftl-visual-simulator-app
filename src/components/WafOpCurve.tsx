import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGcWorkloadXml, buildSsdConfigXml, type SsdParams, type WorkloadParams } from '../data/mqsimConfigs';
import type { CompareMessage, CompareResult } from '../workers/compare.worker';

interface Props {
  params: SsdParams;
  workload: WorkloadParams;
}

// OP ratios to sample - ParamPanel's slider range (0-30%), every 5%.
const OP_POINTS = [0, 5, 10, 15, 20, 25, 30];

const WIDTH = 480;
const HEIGHT = 150;
const PAD_LEFT = 34;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

// "GC 시연": the classic SSD textbook curve - more over-provisioning, lower
// write amplification - measured from this simulator with the current
// settings (everything except OP held fixed), each point run to the end in
// compare.worker.ts. At the defaults it drops from ~1.49x at OP 0% to
// ~1.05x at 30% (cache on); with the DRAM write cache off, ~1.85x -> ~1.29x.
export function WafOpCurve({ params, workload }: Props) {
  const [results, setResults] = useState<CompareResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

  // Everything but OP defines the curve - drop it when any of that changes.
  const settingsKey = useMemo(
    () => JSON.stringify({ ...params, overprovisioningRatio: null, workload }),
    [params, workload],
  );
  useEffect(() => {
    runIdRef.current++;
    // oxlint-disable-next-line react/set-state-in-effect
    setResults([]);
    setRunning(false);
    setError(null);
  }, [settingsKey]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const start = () => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../workers/compare.worker.ts', import.meta.url), { type: 'module' });
    }
    const runId = ++runIdRef.current;
    setResults([]);
    setError(null);
    setRunning(true);
    workerRef.current.onmessage = (e: MessageEvent<CompareMessage>) => {
      const msg = e.data;
      if (msg.runId !== runIdRef.current) return;
      if (msg.type === 'result') setResults((prev) => [...prev, msg.result]);
      else if (msg.type === 'done') setRunning(false);
      else {
        setError(msg.error);
        setRunning(false);
      }
    };
    workerRef.current.postMessage({
      type: 'compare',
      runId,
      jobs: OP_POINTS.map((op) => {
        const p = { ...params, overprovisioningRatio: op / 100 };
        return { label: String(op), ssdConfigXml: buildSsdConfigXml(p), workloadXml: buildGcWorkloadXml(p, workload) };
      }),
    });
  };

  const points = results
    .filter((r) => r.hostWrites > 0)
    .map((r) => ({
      op: Number(r.label),
      waf: (r.hostWrites + r.pagesMoved) / r.hostWrites,
      gc: r.gcExecutions,
      full: r.deviceFull,
    }));
  const currentOp = Math.round(params.overprovisioningRatio * 100);
  const maxWaf = Math.max(1.5, ...points.map((p) => p.waf));
  const yMax = Math.ceil(maxWaf * 10) / 10;
  const x = (op: number) => PAD_LEFT + (op / 30) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (waf: number) => PAD_TOP + ((yMax - waf) / (yMax - 1)) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const hovered = hover !== null ? points.find((p) => p.op === hover) : undefined;

  return (
    <div className="gc-compare">
      <div className="free-chart-title">Over-provisioning 에 따른 WAF</div>
      <button type="button" className="gc-compare-button" onClick={start} disabled={running}>
        {running
          ? `계산 중... (${results.length}/${OP_POINTS.length})`
          : points.length === OP_POINTS.length
            ? '다시 계산하기'
            : '지금 설정으로 OP 0~30% 곡선 그리기'}
      </button>
      {error && <div className="free-chart-empty">계산 중 오류: {error}</div>}
      {points.length > 0 && (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="free-chart-svg waf-op-svg"
          role="img"
          aria-label={`OP 에 따른 WAF: ${points.map((p) => `${p.op}% ${p.waf.toFixed(2)}`).join(', ')}`}
          onMouseLeave={() => setHover(null)}
        >
          {[1, (1 + yMax) / 2, yMax].map((v) => (
            <g key={v}>
              <line className="free-axis" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(v)} y2={y(v)} />
              <text className="free-tick" x={PAD_LEFT - 4} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {v.toFixed(1)}×
              </text>
            </g>
          ))}
          {OP_POINTS.map((op) => (
            <text key={op} className="free-tick" x={x(op)} y={HEIGHT - 8} textAnchor="middle">
              {op}%
            </text>
          ))}
          <polyline className="free-line" points={points.map((p) => `${x(p.op)},${y(p.waf)}`).join(' ')} />
          {points.map((p) => (
            <circle
              key={p.op}
              className={p.op === currentOp ? 'waf-op-dot current' : 'waf-op-dot'}
              cx={x(p.op)}
              cy={y(p.waf)}
              r={p.op === currentOp ? 5 : 4}
            />
          ))}
          {points
            .filter((p) => p.op === currentOp)
            .map((p) => (
              <text key="label" className="waf-op-label" x={x(p.op)} y={y(p.waf) - 10} textAnchor="middle">
                지금 {p.waf.toFixed(2)}×
              </text>
            ))}
          {points.map((p) => (
            <rect
              key={`hit-${p.op}`}
              className="free-hit"
              x={x(p.op) - 16}
              y={0}
              width={32}
              height={HEIGHT}
              onMouseEnter={() => setHover(p.op)}
            />
          ))}
        </svg>
      )}
      {hovered && (
        <div className="free-tooltip">
          OP {hovered.op}% · WAF {hovered.waf.toFixed(2)}× · GC {hovered.gc}번{hovered.full ? ' · 장치가 가득 참' : ''}
        </div>
      )}
      <div className="free-chart-caption">
        다른 설정은 그대로 두고 Over-provisioning 만 0~30% 로 바꿔 각각 끝까지 돌린 결과예요. 여유 공간이 많을수록 GC 가
        고르는 victim 에 invalid page 가 더 많이 쌓여 있어서 옮길 page 가 줄고, 그래서 WAF 가 내려갑니다 - 실제 SSD 가
        용량 일부를 숨겨두는 이유예요.
      </div>
    </div>
  );
}
