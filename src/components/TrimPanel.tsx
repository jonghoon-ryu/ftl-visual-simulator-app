import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGcWorkloadXml, buildSsdConfigXml, type SsdParams, type WorkloadParams } from '../data/mqsimConfigs';
import type { CompareMessage, CompareResult } from '../workers/compare.worker';
import { Term } from './Term';

interface Props {
  params: SsdParams;
  workload: WorkloadParams;
  // Issues a TRIM against the run on screen; resolves with how many pages held data.
  onTrim: (percent: number) => Promise<number>;
  canTrim: boolean;
}

const PERCENT_OPTIONS = [10, 30, 60];

// Event-groups between TRIMs in the comparison run. The same for the DRAM
// cache on or off: at the 32-page cache both modes service ~0.1 host requests
// per event-group (GC 시연: ~12.7k requests / ~138k groups cached, ~5.1k /
// ~50k uncached), so one chunk gives the same TRIM rate per host request.
// (Was 200000 cached / 600 uncached, normalised by TRIM rounds for the old
// 256 MB cache's ~17M-group runs - at the new cache size 200000 would finish
// the whole run inside the first chunk and never TRIM at all.)
const TRIM_CHUNK = 600;

// "GC 시연": TRIM, which upstream MQSim does not have - the engine got a
// Trim_lpa() for this project. (1) a button that TRIMs part of the data on
// the run on screen, so valid pages visibly turn invalid; (2) a comparison
// that runs the current settings to the end with and without a host that
// keeps TRIMming, to show what it does to GC cost.
export function TrimPanel({ params, workload, onTrim, canTrim }: Props) {
  // 30, not 10: with the DRAM cache on and reads at 0%, a 10% TRIM's WAF
  // effect is within run-to-run noise (engine/tests/cache/trimwaf.mts) - see
  // the caption below. At the defaults (30% reads, 40% working set) 10% works too (1.38x -> 1.12x, OP 20% / GC 30%).
  const [percent, setPercent] = useState(30);
  const [lastTrim, setLastTrim] = useState<{ percent: number; pages: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const [results, setResults] = useState<CompareResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

  const settingsKey = useMemo(() => JSON.stringify({ params, workload, percent }), [params, workload, percent]);
  useEffect(() => {
    runIdRef.current++;
    // oxlint-disable-next-line react/set-state-in-effect
    setResults([]);
    setRunning(false);
    setError(null);
  }, [settingsKey]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const trimNow = async () => {
    setBusy(true);
    try {
      const pages = await onTrim(percent);
      setLastTrim({ percent, pages });
    } finally {
      setBusy(false);
    }
  };

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
    const ssdConfigXml = buildSsdConfigXml(params);
    const workloadXml = buildGcWorkloadXml(params, workload);
    workerRef.current.postMessage({
      type: 'compare',
      runId,
      jobs: [
        { label: 'none', ssdConfigXml, workloadXml },
        {
          label: 'trim',
          ssdConfigXml,
          workloadXml,
          trim: { percent, chunk: TRIM_CHUNK },
        },
      ],
    });
  };

  const done = results.length === 2;
  const wafOf = (r: CompareResult) => (r.hostWrites === 0 ? null : (r.hostWrites + r.pagesMoved) / r.hostWrites);

  return (
    <div className="gc-compare">
      <div className="free-chart-title">
        <Term id="trim">TRIM</Term>
      </div>
      <div className="trim-controls">
        <select
          className="param-select"
          value={percent}
          aria-label="TRIM 할 LPN 비율"
          onChange={(e) => setPercent(Number(e.target.value))}
        >
          {PERCENT_OPTIONS.map((p) => (
            <option key={p} value={p}>
              LPN {p}%
            </option>
          ))}
        </select>
        <button type="button" className="gc-compare-button" disabled={!canTrim || busy} onClick={trimNow}>
          지금 TRIM 하기
        </button>
      </div>
      {lastTrim && (
        <div className="free-chart-caption">
          LPN {lastTrim.percent}% 를 TRIM 해서 데이터가 있던 page {lastTrim.pages}개가 invalid 가 됐어요. 격자에서 초록이
          빨강으로 바뀐 걸 확인해보세요. 이 page 들은 GC 가 옮기지 않아도 돼요 (다만 block 이 지워질 때 공간이 돌아와요).
        </div>
      )}
      {!lastTrim && (
        <div className="free-chart-caption">
          ▶ 로 어느 정도 진행한 뒤 눌러보세요. 아직 쓰지 않은 LPN 은 TRIM 할 게 없어요.
        </div>
      )}

      <button type="button" className="gc-compare-button" onClick={start} disabled={running}>
        {running
          ? `비교 중... (${results.length}/2)`
          : done
            ? '다시 비교하기'
            : `TRIM 효과 비교하기 (구간마다 LPN ${percent}% TRIM)`}
      </button>
      {error && <div className="free-chart-empty">비교 중 오류: {error}</div>}
      {results.length > 0 && (
        <div className="gc-compare-scroll">
          <table className="gc-compare-table">
            <thead>
              <tr>
                <th>호스트</th>
                <th>TRIM 한 page</th>
                <th>GC 실행</th>
                <th>옮긴 page</th>
                <th>WAF</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const waf = wafOf(r);
                return (
                  <tr key={r.label}>
                    <td>{r.label === 'trim' ? 'TRIM 함' : 'TRIM 안 함'}</td>
                    <td>{r.trimmedPages}</td>
                    <td>{r.gcExecutions}</td>
                    <td>{r.pagesMoved}</td>
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
        같은 설정으로 끝까지 돌린 결과예요 (화면의 재생과는 별개). TRIM 을 모르는 FTL 은 호스트가 이미 지운 데이터도
        valid 로 믿고 GC 때마다 옮겨요. TRIM 하면 그 page 가 invalid 라서 옮길 page 가 줄고 WAF 가 내려가요. TRIM 하는 동안
        호스트가 더 많이 쓸 수 있게 되므로 호스트 쓰기 수도 달라질 수 있어요. 다만 읽기 비율을 0 으로
        하고 DRAM 캐시를 켠 채 LPN 10% 처럼 조금만 TRIM 하면, 차이가 실행마다 오르내릴 만큼 작아요 - 캐시가 이미
        덮어쓰기를 흡수해서 flash 에 남는 옛 데이터가 적기 때문이에요. 기본 설정(읽기 30%)이나 TRIM 30% 이상에서는 확실히
        내려가요.
      </div>
    </div>
  );
}
