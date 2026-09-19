import type { BlockRow } from '../types';

// Converts the WASM engine's real per-block/page snapshot into the
// BlockRow[] shape FlashGrid.tsx renders. No 'moving' state comes from
// here (see Block_Page_State's doc comment in Flash_Block_Manager_Base.h -
// a point-in-time snapshot can't see a transient GC/WL page move).
export function toBlockRows(state: MqsimState | null): BlockRow[] {
  if (!state) return [];

  // Block numbers restart at 0 per chip, so with more than one chip
  // configured (ParamPanel's 칩 개수), "Block 0" would otherwise appear once
  // per chip and collide as a React list key - prefix with the chip id
  // whenever more than one is actually present in this snapshot.
  const multiChip = new Set(state.blocks.map((block) => block.chip)).size > 1;

  return state.blocks.map((block) => ({
    label: multiChip ? `Chip ${block.chip} · Block ${block.block}` : `Block ${block.block}`,
    pages: block.pages.map((pageState) => ({ state: pageState })),
  }));
}
