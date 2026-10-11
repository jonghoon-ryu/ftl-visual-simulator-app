import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGcWorkloadXml, buildSsdConfigXml, type SsdParams, type WorkloadParams } from '../data/mqsimConfigs';
import type { CompareMessage, CompareResult } from '../workers/compare.worker';

interface Props {
  params: SsdParams;
  workload: WorkloadParams;
}

const PATTERNS: { id: WorkloadParams['addressDistribution']; label: string }[] = [
  { id: 'STREAMING', label: 'Sequential (순차)' },
  { id: 'RANDOM_UNIFORM', label: 'Random (무작위)' },
];

// "GC 시연": runs the current settings once with sequential writes and once
// with random writes (in compare.worker.ts, off the visible run) and lines up
// the GC cost. The idea it teaches: sequential writes tend to invalidate a
// whole block at a time, so GC finds nearly-empty victims and moves little;
// random writes scatter invalid pages across every block, so GC has to move
// many valid pages. The numbers are shown as measured - if a setting makes the
// two come out close, the table says so instead of repeating the textbook claim.
export function AccessPatternComparison({ params, workload }: Props) {
  const [results, setResults] = useState<CompareResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

  // Results describe one exact set of settings - drop them when those change.
  const settingsKey = useMemo(
    () => JSON.stringify({ params, workload: { ...workload, addressDistribution: null, readPercentage: null } }),
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
      jobs: PATTERNS.map(({ id }) => ({
        label: id,
        ssdConfigXml: buildSsdConfigXml(params),
        // Reads off: this compares WRITE patterns. MQSim's STREAMING generator
        // advances one shared address cursor for reads and writes, so with
        // reads mixed in each pass only rewrites a random ~70% of addresses
        // and "sequential" loses much of its effect (40% working set, 30%
        // reads: 1.69x vs random 2.26x; no reads: 1.12x vs 2.21x - at the
        // old 25% working set 30% reads even made it a tie, 1.26x vs 1.27x;
        // engine/tests/cache/claims.mts).
        workloadXml: buildGcWorkloadXml(params, { ...workload, addressDistribution: id, readPercentage: 0 }),
      })),
    });
  };

  const done = results.length === PATTERNS.length;
  const wafOf = (r: CompareResult) => (r.hostWrites === 0 ? null : (r.hostWrites + r.pagesMoved) / r.hostWrites);
  const labelOf = (id: string) => PATTERNS.find((p) => p.id === id)?.label ?? id;

  return (
    <div className="gc-compare">
      <div className="free-chart-title">순차 vs 무작위 쓰기 비교</div>
      <button type="button" className="gc-compare-button" onClick={start} disabled={running}>
        {running
          ? `비교 중... (${results.length}/${PATTERNS.length})`
          : done
            ? '다시 비교하기'
            : '지금 설정으로 순차 / 무작위 쓰기 비교하기'}
      </button>
      {error && <div className="free-chart-empty">비교 중 오류: {error}</div>}
      {results.length > 0 && (
        <div className="gc-compare-scroll">
          <table className="gc-compare-table">
            <thead>
              <tr>
                <th>접근 패턴</th>
                <th>GC 실행</th>
                <th>옮긴 page</th>
                <th>GC 1번에 옮긴 page</th>
                <th>WAF</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const waf = wafOf(r);
                const isCurrent = r.label === workload.addressDistribution;
                return (
                  <tr key={r.label} className={isCurrent ? 'current' : undefined}>
                    <td>
                      {labelOf(r.label)}
                      {isCurrent && <span className="gc-compare-tag">현재</span>}
                    </td>
                    <td>{r.gcExecutions}</td>
                    <td>{r.pagesMoved}</td>
                    <td>{r.gcExecutions === 0 ? '-' : (r.pagesMoved / r.gcExecutions).toFixed(1)}</td>
                    <td>
                      {waf === null ? '-' : `${waf.toFixed(2)}×`}
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
        같은 설정으로 쓰기 패턴만 바꿔 각각 끝까지 돌린 결과예요 (화면의 재생과는 별개로 계산). 순차 쓰기는 block 단위로
        한꺼번에 invalid 가 되기 쉬워서 GC 1번에 옮기는 valid page 가 적고, 무작위 쓰기는 invalid page 가 모든 block 에
        흩어져서 더 많이 옮겨야 해요. 차이의 크기는 설정(DRAM 캐시, Over-provisioning 등)에 따라 달라져요. 쓰기 패턴만 비교하려고 이 실험은 읽기를 끄고
        돌립니다 - MQSim 의 순차 생성기는 읽기와 쓰기가 같은 주소를 차례로 나눠 써서, 읽기가 섞이면 쓰기가 더 이상 순차가
        아니게 되거든요.
      </div>
    </div>
  );
}
