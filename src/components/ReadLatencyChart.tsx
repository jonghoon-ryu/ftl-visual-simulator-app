import { useState } from 'react';
import type { ReadLatencySample } from '../hooks/useReadLatencyHistory';

interface Props {
  samples: ReadLatencySample[];
  readPercentage: number;
}

const WIDTH = 480;
const HEIGHT = 90;
const PAD_LEFT = 40;
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

function gcChipSummary(chips: number[]): string {
  const counts = new Map<number, number>();
  for (const c of chips) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([c, n]) => `Chip ${c} ${n}번`).join(', ');
}

function formatUs(us: number): string {
  return us >= 1000 ? `${(us / 1000).toFixed(1)}ms` : `${Math.round(us)}µs`;
}

// "GC 시연": average read latency per playback tick, with a ● on every
// tick in which GC started. A GC ties up the chip with page moves and an
// erase, and a read that needs that chip has to wait - so the line jumps
// right where the dots are. Measured at the defaults with 30% reads (after
// the suspend fix): cache on ~10µs normally vs ~24µs in ticks with GC;
// cache off ~0.24ms vs ~1.7ms.
export function ReadLatencyChart({ samples, readPercentage }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (readPercentage === 0) {
    return (
      <div className="free-chart">
        <div className="free-chart-title">읽기 지연</div>
        <div className="free-chart-empty">
          Workload 의 "읽기 비율"을 올리면, GC 가 도는 동안 읽기가 얼마나 느려지는지 여기에 그려져요
        </div>
      </div>
    );
  }
  const withReads = samples.map((s, i) => ({ ...s, i })).filter((s) => s.reads > 0);
  if (withReads.length < 2) {
    return (
      <div className="free-chart">
        <div className="free-chart-title">읽기 지연</div>
        <div className="free-chart-empty">재생하면 구간별 평균 읽기 지연과 GC 시작 시점이 여기에 그려져요</div>
      </div>
    );
  }

  const maxAvg = Math.max(...withReads.map((s) => s.avgUs));
  const x = (i: number) => PAD_LEFT + (i / Math.max(1, samples.length - 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (us: number) => PAD_TOP + (1 - us / maxAvg) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const hitWidth = (WIDTH - PAD_LEFT - PAD_RIGHT) / Math.max(1, samples.length - 1);
  const withGc = withReads.filter((s) => s.gcStarts > 0);
  // Every tick with a GC start gets a dot - including ticks in which no read
  // finished (hollow, on the baseline: there's no latency to plot there).
  // Only plotting ticks with reads used to drop most GC starts at slow ▶
  // speeds, where a tick covers just a log line or two (Ryu, 2026-10-11).
  const gcNoReads = samples.map((s, i) => ({ ...s, i })).filter((s) => s.gcStarts > 0 && s.reads === 0);
  const withoutGc = withReads.filter((s) => s.gcStarts === 0);
  const mean = (arr: typeof withReads) =>
    arr.length === 0 ? null : arr.reduce((t, s) => t + s.avgUs * s.reads, 0) / arr.reduce((t, s) => t + s.reads, 0);
  const meanGc = mean(withGc);
  const meanNoGc = mean(withoutGc);
  const slowest = Math.max(...withReads.map((s) => s.maxUs));
  const hovered = hover !== null ? samples[hover] : undefined;

  return (
    <div className="free-chart">
      <div className="free-chart-title">읽기 지연 (구간별 평균 · 모든 칩 합산)</div>
      <div className="free-chart-legend">
        <span><span className="free-legend-line" />평균 읽기 지연</span>
        <span><span className="free-legend-dot" />그 구간에 GC 시작 (어느 칩이든)</span>
        <span><span className="free-legend-dot hollow" />GC 시작 · 그 구간에 끝난 읽기 없음</span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="free-chart-svg"
        role="img"
        aria-label={`구간별 평균 읽기 지연, 최대 ${formatUs(maxAvg)}`}
        onMouseLeave={() => setHover(null)}
      >
        <line className="free-axis" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(0)} y2={y(0)} />
        <text className="free-tick" x={PAD_LEFT - 4} y={y(0)} textAnchor="end" dominantBaseline="middle">0</text>
        <text className="free-tick" x={PAD_LEFT - 4} y={y(maxAvg)} textAnchor="end" dominantBaseline="middle">
          {formatUs(maxAvg)}
        </text>
        <polyline className="free-line" points={withReads.map((s) => `${x(s.i)},${y(s.avgUs)}`).join(' ')} />
        {hover !== null && <line className="free-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD_TOP} y2={y(0)} />}
        {withGc.map((s) => (
          <circle key={s.i} className="free-gc-dot" cx={x(s.i)} cy={y(s.avgUs)} r={4} />
        ))}
        {gcNoReads.map((s) => (
          <circle key={`n${s.i}`} className="free-gc-dot hollow" cx={x(s.i)} cy={y(0)} r={3.5} />
        ))}
        {samples.map((_, i) => (
          <rect
            key={i}
            className="free-hit"
            x={x(i) - hitWidth / 2}
            y={0}
            width={hitWidth}
            height={HEIGHT}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hovered && (
        <div className="free-tooltip">
          {`${hover! + 1}번째 갱신 · ${
            hovered.reads === 0
              ? '이 구간에 끝난 읽기 없음'
              : `읽기 ${hovered.reads}개, 평균 ${formatUs(hovered.avgUs)}, 가장 느린 읽기 ${formatUs(hovered.maxUs)}`
          }${hovered.gcStarts > 0 ? ` · GC 시작: ${gcChipSummary(hovered.gcChips)}` : ''}`}
        </div>
      )}
      <div className="free-chart-caption">
        {meanGc !== null && meanNoGc !== null
          ? `지금까지: GC 가 시작된 구간의 평균 읽기 ${formatUs(meanGc)}, 나머지 구간 ${formatUs(meanNoGc)}, 가장 느린 읽기 ${formatUs(slowest)}. `
          : ''}
        읽기 지연은 칩을 나누지 않고, 그 구간에 끝난 모든 읽기(두 칩 합산)의 평균이에요. GC 는 victim 의 page 를 옮기고 block 을 지우는 동안 그 칩을 붙잡고 있어서, 같은 칩을 읽어야 하는 요청은 기다려야
        해요 - 그래서 GC 점이 있는 곳에서 선이 튀어 올라요. DRAM 캐시를 끄면 모든 읽기가 flash 로 가서 차이가 더
        커집니다. "명령 일시정지(suspend)"를 켜면 가장 느린 읽기가 줄어드는지 비교해보세요.
      </div>
    </div>
  );
}
