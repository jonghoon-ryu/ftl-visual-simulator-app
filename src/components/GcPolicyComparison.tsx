import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGcWorkloadXml, buildSsdConfigXml, type SsdParams, type WorkloadParams } from '../data/mqsimConfigs';
import type { CompareMessage, CompareResult } from '../workers/compare.worker';

interface Props {
  params: SsdParams;
  workload: WorkloadParams;
}

const POLICIES: SsdParams['gcBlockSelectionPolicy'][] = ['RGA', 'GREEDY', 'RANDOM', 'RANDOM_P', 'RANDOM_PP', 'FIFO', 'COST_BENEFIT'];
const LABELS: Record<SsdParams['gcBlockSelectionPolicy'], string> = {
  RGA: 'RGA',
  GREEDY: 'Greedy',
  RANDOM: 'Random',
  RANDOM_P: 'Random-p',
  RANDOM_PP: 'Random-pp',
  FIFO: 'FIFO',
  COST_BENEFIT: 'Cost-Benefit',
};

// "GC 시연": runs the current settings once per GC 알고리즘, each to the
// end, in a separate worker (compare.worker.ts - never touches the run on
// screen), and puts the results side by side. The point is to let the
// numbers answer "which victim-selection rule is cheaper?" rather than a
// textbook claim - at this demo's scale plain Random can even come out
// cheapest (it skips GC chances whose random pick has nothing to reclaim),
// which is itself worth seeing.
export function GcPolicyComparison({ params, workload }: Props) {
  const [results, setResults] = useState<CompareResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

  // Results describe one exact set of settings - drop them when those change.
  const settingsKey = useMemo(
    () => JSON.stringify({ ...params, gcBlockSelectionPolicy: null, workload }),
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
      jobs: POLICIES.map((policy) => {
        const p = { ...params, gcBlockSelectionPolicy: policy };
        return { label: policy, ssdConfigXml: buildSsdConfigXml(p), workloadXml: buildGcWorkloadXml(p, workload) };
      }),
    });
  };

  const done = results.length === POLICIES.length;
  const wafOf = (r: CompareResult) => (r.hostWrites === 0 ? null : (r.hostWrites + r.pagesMoved) / r.hostWrites);
  const bestWaf = done ? Math.min(...results.map((r) => wafOf(r) ?? Infinity)) : null;

  return (
    <div className="gc-compare">
      <div className="free-chart-title">GC 알고리즘 비교</div>
      <button type="button" className="gc-compare-button" onClick={start} disabled={running}>
        {running ? `비교 중... (${results.length}/${POLICIES.length})` : done ? '다시 비교하기' : '지금 설정으로 GC 알고리즘 7개 비교하기'}
      </button>
      {error && <div className="free-chart-empty">비교 중 오류: {error}</div>}
      {results.length > 0 && (
        <div className="gc-compare-scroll">
          <table className="gc-compare-table">
            <thead>
              <tr>
                <th>알고리즘</th>
                <th>GC 실행</th>
                <th>옮긴 page</th>
                <th>GC 1번에 옮긴 page</th>
                <th>WAF</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const waf = wafOf(r);
                const isCurrent = r.label === params.gcBlockSelectionPolicy;
                const isBest = waf !== null && waf === bestWaf;
                return (
                  <tr key={r.label} className={isCurrent ? 'current' : undefined}>
                    <td>
                      {LABELS[r.label as SsdParams['gcBlockSelectionPolicy']] ?? r.label}
                      {isCurrent && <span className="gc-compare-tag">현재</span>}
                    </td>
                    <td>{r.gcExecutions}</td>
                    <td>{r.pagesMoved}</td>
                    <td>{r.gcExecutions === 0 ? '-' : (r.pagesMoved / r.gcExecutions).toFixed(1)}</td>
                    <td>
                      {waf === null ? '-' : `${waf.toFixed(2)}×`}
                      {isBest && <span className="gc-compare-tag best">가장 낮음</span>}
                      {r.deviceFull && <span className="gc-compare-tag">장치 가득 참</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="free-chart-caption">
        같은 설정·같은 워크로드로 알고리즘만 바꿔 각각 끝까지 돌린 결과예요 (화면의 재생과는 별개로 계산). 옮긴 page 가
        적을수록 GC 가 싸고 WAF 가 낮아요. 이 데모처럼 block 이 적으면 교과서 설명과 다른 결과가 나오기도 합니다 - 예를
        들어 Random 은 무작위로 고른 block 에 청소할 게 없으면 그 GC 기회를 건너뛰기 때문에 오히려 적게 옮길 수 있어요.
      </div>
    </div>
  );
}
