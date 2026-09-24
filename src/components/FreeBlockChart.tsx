import { useState } from 'react';
import type { FreeBlockHistory, FreeBlockMarker } from '../hooks/useFreeBlockHistory';
import { CHIP_COLORS } from '../lib/chipColors';

interface Props {
  history: FreeBlockHistory;
}

// Fixed drawing size - the SVG scales to the panel width via viewBox.
const WIDTH = 480;
const HEIGHT = 72;
const PAD_LEFT = 22;
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

// "빈 block 수가 GC 임계값 아래로 떨어지면 GC 가 시작된다" as a picture:
// one small chart per chip (small multiples rather than one chart with a
// line per chip - the app's chip badge colors are too close for color alone
// to tell lines apart, so each chip gets its own chart and a text label).
export function FreeBlockChart({ history }: Props) {
  const [hover, setHover] = useState<{ chip: number; index: number } | null>(null);
  const { samples, markers, gcThresholdBlocks } = history;
  const chipCount = samples[0]?.freeBlocksPerChip.length ?? 0;

  if (samples.length < 2 || chipCount === 0) {
    return (
      <div className="free-chart">
        <div className="free-chart-title">빈 block 수 변화</div>
        <div className="free-chart-empty">재생하면 칩별 빈 block 수와 GC 발동 시점이 여기에 그려져요</div>
      </div>
    );
  }

  const maxFree = Math.max(
    gcThresholdBlocks + 2,
    ...samples.flatMap((sample) => sample.freeBlocksPerChip),
    ...markers.map((marker) => marker.freeBlocks),
  );
  const x = (index: number) => PAD_LEFT + (index / (samples.length - 1)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (free: number) => PAD_TOP + (1 - free / maxFree) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const hitWidth = (WIDTH - PAD_LEFT - PAD_RIGHT) / Math.max(1, samples.length - 1);

  return (
    <div className="free-chart">
      <div className="free-chart-title">빈 block 수 변화</div>
      <div className="free-chart-legend">
        <span><span className="free-legend-line" />빈 block 수</span>
        <span><span className="free-legend-threshold" />GC 임계값 ({gcThresholdBlocks}개)</span>
        <span><span className="free-legend-dot" />GC 시작</span>
        <span><span className="free-legend-star">★</span>정적 WL 시작</span>
      </div>
      {Array.from({ length: chipCount }, (_, chip) => {
        const points = samples.map((sample, index) => `${x(index)},${y(sample.freeBlocksPerChip[chip])}`).join(' ');
        const chipMarkers = markers.filter((marker) => marker.chip === chip);
        const hovered = hover?.chip === chip ? hover.index : null;
        return (
          <div className="free-chart-row" key={chip}>
            {chipCount > 1 && (
              <div className="free-chart-chip">
                <span className="free-chip-swatch" style={{ background: CHIP_COLORS[chip % CHIP_COLORS.length] }} />
                Chip {chip}
              </div>
            )}
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="free-chart-svg"
              role="img"
              aria-label={`Chip ${chip} 빈 block 수 변화, GC 임계값 ${gcThresholdBlocks}개`}
              onMouseLeave={() => setHover(null)}
            >
              <line className="free-axis" x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(0)} y2={y(0)} />
              <text className="free-tick" x={PAD_LEFT - 4} y={y(0)} textAnchor="end" dominantBaseline="middle">0</text>
              <text className="free-tick" x={PAD_LEFT - 4} y={y(maxFree)} textAnchor="end" dominantBaseline="middle">
                {maxFree}
              </text>
              <line
                className="free-threshold"
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={y(gcThresholdBlocks)}
                y2={y(gcThresholdBlocks)}
              />
              <polyline className="free-line" points={points} />
              {hovered !== null && (
                <line className="free-crosshair" x1={x(hovered)} x2={x(hovered)} y1={PAD_TOP} y2={y(0)} />
              )}
              {chipMarkers.map((marker, i) =>
                marker.kind === 'gc' ? (
                  <circle
                    key={i}
                    className="free-gc-dot"
                    cx={x(marker.sampleIndex)}
                    cy={y(marker.freeBlocks)}
                    r={4}
                  />
                ) : (
                  <text
                    key={i}
                    className="free-wl-star"
                    x={x(marker.sampleIndex)}
                    y={y(marker.freeBlocks)}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    ★
                  </text>
                ),
              )}
              {samples.map((_, index) => (
                <rect
                  key={index}
                  className="free-hit"
                  x={x(index) - hitWidth / 2}
                  y={0}
                  width={hitWidth}
                  height={HEIGHT}
                  onMouseEnter={() => setHover({ chip, index })}
                />
              ))}
            </svg>
            {hovered !== null && (
              <div className="free-tooltip">
                {describeSample(hovered, samples[hovered].freeBlocksPerChip[chip], gcThresholdBlocks, chipMarkers)}
              </div>
            )}
          </div>
        );
      })}
      <div className="free-chart-caption">
        빈 block 이 임계값 아래로 내려가는 순간 GC 가 시작돼 block 을 비우고, 빈 block 수가 다시 올라갑니다 - 그래서
        선이 임계값 근처에서 톱니 모양으로 오르내려요.
      </div>
    </div>
  );
}

function describeSample(index: number, free: number, threshold: number, chipMarkers: FreeBlockMarker[]): string {
  const here = chipMarkers.filter((marker) => marker.sampleIndex === index);
  const parts = [`${index + 1}번째 갱신 · 빈 block ${free}개 (임계값 ${threshold}개)`];
  for (const marker of here) {
    if (marker.kind === 'gc') {
      const moved =
        marker.validPages !== undefined && marker.pagesPerBlock !== undefined
          ? `, victim 의 valid page ${marker.validPages}/${marker.pagesPerBlock}개를 옮김`
          : '';
      parts.push(`GC 시작: 빈 block 이 ${marker.freeBlocks}개로 임계값 아래${moved}`);
    } else {
      parts.push('정적 마모평준화 시작');
    }
  }
  return parts.join(' — ');
}
