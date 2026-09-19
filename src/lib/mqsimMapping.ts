import type { MappingRow } from '../types';

// How many mapped rows to show in the "매핑 테이블 (일부)" panel - the
// underlying getState().mapping array covers every LPA in the address
// space (mostly unmapped until written), so this is a display-side slice,
// not a limit the engine itself applies.
const MAX_DISPLAY_ROWS = 20;

// Converts the WASM engine's raw getState().mapping (BigInt lpa/ppa, a
// decomposed physical address once mapped) into the plain-string rows
// MappingTable.tsx renders. Unmapped LPAs (never written) are dropped -
// showing hundreds of "미기록" rows on load isn't useful to a beginner.
//
// `lastOps` (from useMqsimEvents) is the most recent read/write touch per
// LPA, tracked from the real mapping_updated event stream - the state
// snapshot alone only knows the *current* PPA, not what kind of access put
// it there or last queried it. An LPA that's currently mapped must have
// been written at least once, so it's always present in lastOps once
// mapped; the `?? true` fallback only matters for the render right after a
// restart, before the next commit() has caught up.
export function toMappingRows(state: MqsimState | null, lastOps: Map<bigint, boolean>): MappingRow[] {
  if (!state) return [];

  // Same convention as toBlockRows() in mqsimBlocks.ts - only show the chip
  // number once there's more than one to tell apart.
  const multiChip = new Set(state.blocks.map((block) => block.chip)).size > 1;

  return state.mapping
    .filter((row): row is MqsimMappingRow & { address: MqsimPageAddress } => row.mapped && row.address !== null)
    .slice(0, MAX_DISPLAY_ROWS)
    .map((row) => ({
      lpa: `0x${row.lpa.toString(16).padStart(3, '0')}`,
      ppa: multiChip ? `C${row.address.chip}·B${row.address.block}·P${row.address.page}` : `B${row.address.block}·P${row.address.page}`,
      op: (lastOps.get(row.lpa) ?? true) ? 'write' : 'read',
    }));
}
