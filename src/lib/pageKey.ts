// Shared identity for one physical page (chip/block/page), used to
// correlate a gc_page_migrated/wl_page_migrated event (useMqsimMigrations)
// with the matching cell in a state snapshot (toBlockRows) - both must
// build the key the same way for the 'moving' overlay to land on the right
// cell.
export function pageKey(chip: number, block: number, page: number): string {
  return `${chip}:${block}:${page}`;
}

// Same idea as pageKey(), one level up - identifies a whole block (chip +
// block, no page) so a gc_block_erased/wl_block_erased event can be
// correlated with the matching block row.
export function blockKey(chip: number, block: number): string {
  return `${chip}:${block}`;
}

// Identity for one *logical* page. Each IO flow (stream) has its own logical
// address space, so an LPA alone is ambiguous once a preset runs more than
// one flow - "마모평준화 시연"'s cold flow and hot flow both have an LPA 5,
// and they are different pages. Events from a single-flow preset carry
// streamId 0.
export function streamLpaKey(streamId: number | undefined, lpa: bigint): string {
  return `${streamId ?? 0}:${lpa}`;
}
