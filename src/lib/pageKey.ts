// Shared identity for one physical page (chip/block/page), used to
// correlate a gc_page_migrated/wl_page_migrated event (useMqsimMigrations)
// with the matching cell in a state snapshot (toBlockRows) - both must
// build the key the same way for the 'moving' overlay to land on the right
// cell.
export function pageKey(chip: number, block: number, page: number): string {
  return `${chip}:${block}:${page}`;
}
