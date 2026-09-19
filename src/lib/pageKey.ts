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
