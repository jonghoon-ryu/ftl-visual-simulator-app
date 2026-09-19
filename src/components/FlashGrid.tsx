import type { BlockRow } from '../types';

const LABELS: Record<string, string> = {
  valid: 'valid ( 유효한 데이터 )',
  invalid: 'invalid ( 지워질 예정 )',
  free: 'free ( 빈 페이지 )',
  moving: 'GC 로 이동 중',
};

// Always all four, in a fixed order - a beginner needs to see what every
// color means before they've ever pressed play (a preset that hasn't run
// yet only has 'free' pages, so deriving the legend from what's currently
// on screen would hide the other three until something happens to show
// them).
const ALL_STATES: (keyof typeof LABELS)[] = ['valid', 'invalid', 'moving', 'free'];

// One accent per chip - ParamPanel currently caps chip count at 4, so 4 is
// enough; indexed with % so a larger chip count still degrades gracefully
// instead of going undefined.
const CHIP_COLORS = ['#4dabf7', '#b980f0', '#ff8ac2', '#4ecdc4'];

interface Props {
  blocks: BlockRow[];
  caption: string;
}

export function FlashGrid({ blocks, caption }: Props) {
  // All blocks share the same page count in every preset - take it from
  // the first one so the header row lines up with each column below.
  const pageCount = blocks[0]?.pages.length ?? 0;

  return (
    <div className="sim-grid-panel">
      <div className="sim-panel-title">Flash Array — Block × Page</div>
      {caption && <div className="sim-caption">{caption}</div>}
      <div className="grid-row grid-header-row">
        <div className="chip-badge chip-badge-spacer">Chip</div>
        <div className="row-label">Page</div>
        <div className="row-cells">
          {Array.from({ length: pageCount }, (_, i) => (
            <div key={i} className="cell cell-header">
              {i}
            </div>
          ))}
        </div>
      </div>
      {blocks.map((block) => {
        const chipColor = CHIP_COLORS[(block.chip ?? 0) % CHIP_COLORS.length];
        return (
          <div className="grid-row" key={`${block.chip ?? 0}-${block.label}`}>
            <div className="chip-badge" style={{ background: chipColor }}>
              {block.chip}
            </div>
            <div className="row-label">{block.label}</div>
            <div className="row-cells">
              {block.pages.map((page, i) => (
                <div
                  key={i}
                  className={`cell ${page.state}`}
                  title={`Chip ${block.chip} · ${block.label} / Page ${i} — ${page.state}`}
                >
                  {page.state === 'valid' ? 'V' : page.state === 'invalid' ? 'X' : page.state === 'moving' ? '→' : ''}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="sim-legend">
        {ALL_STATES.map((state) => (
          <span key={state}>
            <span className={`swatch ${state}`} />
            {LABELS[state]}
          </span>
        ))}
      </div>
    </div>
  );
}
