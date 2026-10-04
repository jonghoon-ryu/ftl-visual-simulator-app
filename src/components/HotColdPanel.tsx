import { useEffect, useRef, useState } from 'react';
import {
  buildHotColdWorkloadXml,
  buildSsdConfigXml,
  HOT_COLD_PARAMS,
  HOT_COLD_MIXED_HOT_LPN_FRACTION,
} from '../data/mqsimConfigs';
import type { BlockComposition, CompareMessage, CompareResult } from '../workers/compare.worker';
import { Term } from './Term';

const LABELS: Record<string, string> = {
  mixed: '섞어서 쓰기 (한 줄로)',
  separated: '분리해서 쓰기 (hot / cold 따로)',
};

function CompositionBars({ blocks }: { blocks: BlockComposition[] }) {
  return (
    <div className="hc-bars" role="img" aria-label="block 별 내용물">
      {blocks.map((b, i) => {
        const total = b.hot + b.cold + b.invalid + b.free || 1;
        const seg = (cls: string, n: number) => (n > 0 ? <span className={`hc-seg ${cls}`} style={{ height: `${(n / total) * 100}%` }} /> : null);
        return (
          <div
            key={i}
            className="hc-bar"
            title={`Block ${i}: hot ${b.hot} · cold ${b.cold} · invalid ${b.invalid} · free ${b.free}`}
          >
            {seg('free', b.free)}
            {seg('invalid', b.invalid)}
            {seg('cold', b.cold)}
            {seg('hot', b.hot)}
          </div>
        );
      })}
    </div>
  );
}

// "GC 시연": hot/cold data separation. The same data set - 20% hot data taking
// 80% of the writes, 80% cold data taking 20% - is written two ways on a small
// fixed device (HOT_COLD_PARAMS): through ONE write stream, where hot and cold
// pages end up interleaved in the same blocks, or through TWO streams with
// their own write blocks, so a block holds only hot or only cold data. Hot data
// dies young, so blocks of pure hot data are nearly all invalid by the time GC
// picks them and cost almost nothing to clean; mixed blocks drag still-valid
// cold pages along. Runs in compare.worker.ts, off the visible run.
export function HotColdPanel() {
  const [results, setResults] = useState<CompareResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);

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
    const ssdConfigXml = buildSsdConfigXml(HOT_COLD_PARAMS);
    workerRef.current.postMessage({
      type: 'compare',
      runId,
      jobs: [
        {
          label: 'mixed',
          ssdConfigXml,
          workloadXml: buildHotColdWorkloadXml(HOT_COLD_PARAMS, 'mixed'),
          composition: { mode: 'lpn', hotLpnFraction: HOT_COLD_MIXED_HOT_LPN_FRACTION },
        },
        {
          label: 'separated',
          ssdConfigXml,
          workloadXml: buildHotColdWorkloadXml(HOT_COLD_PARAMS, 'separated'),
          composition: { mode: 'stream', hotStream: 0 },
        },
      ],
    });
  };

  const done = results.length === 2;
  const wafOf = (r: CompareResult) => (r.hostWrites === 0 ? null : (r.hostWrites + r.pagesMoved) / r.hostWrites);

  return (
    <div className="gc-compare">
      <div className="free-chart-title">
        <Term id="hotCold">핫/콜드 분리</Term> 비교
      </div>
      <button type="button" className="gc-compare-button" onClick={start} disabled={running}>
        {running ? `비교 중... (${results.length}/2)` : done ? '다시 비교하기' : '핫/콜드 데이터 섞기 vs 분리 비교하기'}
      </button>
      {error && <div className="free-chart-empty">비교 중 오류: {error}</div>}
      {results.length > 0 && (
        <>
          <div className="gc-compare-scroll">
            <table className="gc-compare-table">
              <thead>
                <tr>
                  <th>쓰는 방식</th>
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
                      <td>{LABELS[r.label] ?? r.label}</td>
                      <td>{r.gcExecutions}</td>
                      <td>{r.pagesMoved}</td>
                      <td>{waf === null ? '-' : `${waf.toFixed(2)}×`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {results.map(
            (r) =>
              r.blocks && (
                <div key={r.label} className="hc-block-row">
                  <div className="hc-block-label">{LABELS[r.label]} — 끝났을 때 block 별 내용물</div>
                  <CompositionBars blocks={r.blocks} />
                </div>
              ),
          )}
          <div className="hc-legend">
            <span><i className="hc-swatch hot" /> hot 데이터</span>
            <span><i className="hc-swatch cold" /> cold 데이터</span>
            <span><i className="hc-swatch invalid" /> invalid</span>
            <span><i className="hc-swatch free" /> 빈 page</span>
          </div>
        </>
      )}
      <div className="free-chart-caption">
        작은 SSD(block 32개, Over-provisioning 10%, DRAM 캐시 끔)에 같은 데이터를 두 방식으로 써서 끝까지 돌린 결과예요.
        데이터의 20%(hot)가 쓰기의 80% 를 받고, 나머지 80%(cold)는 쓰기의 20% 만 받아요. 섞어 쓰면 한 block 안에 자주 바뀌는
        hot 과 거의 안 바뀌는 cold 가 함께 들어가서, GC 가 block 을 비울 때 아직 유효한 cold page 를 같이 옮겨야 해요.
        분리하면 hot-only block 은 거의 전부 invalid 가 된 뒤에 GC 되어 옮길 게 적어요. 이 엔진은 GC 가 옮기는 데이터를
        이미 따로 쓰기 때문에 차이가 크지는 않지만, 방향은 일관돼요.
      </div>
    </div>
  );
}
