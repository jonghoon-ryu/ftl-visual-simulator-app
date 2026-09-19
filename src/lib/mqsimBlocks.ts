import { blockKey, pageKey } from './pageKey';
import type { BlockRow } from '../types';

// Converts the WASM engine's real per-block/page snapshot into the
// BlockRow[] shape FlashGrid.tsx renders. getState() itself never reports
// 'moving' (see Block_Page_State's doc comment in Flash_Block_Manager_Base.h
// - a point-in-time snapshot can't see a transient GC/WL page move) - the
// optional `movingKeys` param (from useMqsimMigrations, built from real
// gc_page_migrated/wl_page_migrated events) overlays it back on top for
// whichever pages actually moved during the most recent step.
export function toBlockRows(
  state: MqsimState | null,
  movingKeys?: Set<string>,
  supersededKeys?: Set<string>,
  erasingBlockKeys?: Set<string>,
): BlockRow[] {
  if (!state) return [];

  // Block numbers restart at 0 per chip - FlashGrid.tsx shows the chip
  // number as its own badge to the left of the label (and keys rows on
  // chip+block together), so "Block N" alone is fine even with multiple
  // chips.
  return state.blocks.map((block) => ({
    label: `Block ${block.block}`,
    pages: block.pages.map((pageState, page) => {
      const key = pageKey(block.chip, block.block, page);
      return {
        state: movingKeys?.has(key) ? 'moving' : pageState,
        superseded: supersededKeys?.has(key) ?? false,
      };
    }),
    chip: block.chip,
    erasing: erasingBlockKeys?.has(blockKey(block.chip, block.block)) ?? false,
    isVictim: block.hasOngoingGcWl,
    gcDestination: block.isGcWriteFrontier,
    writeFrontier: block.isWriteFrontier,
  }));
}
