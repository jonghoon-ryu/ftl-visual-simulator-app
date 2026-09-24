import type { ReactNode } from 'react';
import { CHIP_COLORS } from '../lib/chipColors';
import { pageKey } from '../lib/pageKey';
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


// Distinct grays for the 'free' cell state, one per chip - the per-chip
// colored cell border was removed earlier (too much visual noise stacked
// on top of the state colors), but an all-gray "nothing has happened yet"
// grid still looks like one undifferentiated block of chips. Kept within
// the same gray family as .cell.free's base #383c4d so it still reads as
// "free", just a tinted shade per chip.
const CHIP_FREE_GRAYS = ['#383c4d', '#454a5f', '#2e313d', '#4f4438'];

interface Props {
  blocks: BlockRow[];
  caption: string;
  // Rendered above the grid, under the caption (e.g. GcVictimExplanation).
  banner?: ReactNode;
  // Rendered below the legend, inside this panel (e.g. FreeBlockChart).
  footer?: ReactNode;
  // "Follow one write" (useLpnJourney): the tracked LPN's current page, and
  // its older copies that are invalid but not yet erased - pageKey() form.
  trackedCurrentKey?: string | null;
  trackedOldKeys?: Set<string>;
}

export function FlashGrid({ blocks, caption, banner, footer, trackedCurrentKey, trackedOldKeys }: Props) {
  // All blocks share the same page count in every preset - take it from
  // the first one so the header row lines up with each column below.
  const pageCount = blocks[0]?.pages.length ?? 0;

  return (
    <div className="sim-grid-panel">
      <div className="sim-panel-title">Flash Array</div>
      {caption && <div className="sim-caption">{caption}</div>}
      {banner}
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
            <div className={`row-cells${block.erasing ? ' erasing' : ''}`}>
              {block.pages.map((page, i) => {
                const freeGray = CHIP_FREE_GRAYS[(block.chip ?? 0) % CHIP_FREE_GRAYS.length];
                const key = block.block !== undefined ? pageKey(block.chip ?? 0, block.block, i) : null;
                const tracked = key !== null && key === trackedCurrentKey ? ' tracked-current' : key !== null && trackedOldKeys?.has(key) ? ' tracked-old' : '';
                return (
                  <div
                    key={i}
                    className={`cell ${page.state}${page.superseded ? ' superseded' : ''}${tracked}`}
                    style={page.state === 'free' ? { background: freeGray, color: freeGray } : undefined}
                    title={
                      `Chip ${block.chip} · ${block.label} / Page ${i} — ${page.state}` +
                      (page.superseded ? ' (다른 페이지로 옮겨짐 - 이전 데이터)' : '')
                    }
                  >
                    {page.state === 'valid' ? 'V' : page.state === 'invalid' ? 'X' : page.state === 'moving' ? '→' : ''}
                  </div>
                );
              })}
            </div>
            {block.isVictim && <span className="row-flag row-flag-victim">Victim</span>}
            {block.gcDestination && <span className="row-flag row-flag-gc-block">GC block</span>}
            {block.writeFrontier && <span className="row-flag row-flag-active">active block</span>}
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
      {footer}
    </div>
  );
}
