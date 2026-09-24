import type { StatItem } from '../types';
import type { SimulationCounters } from '../hooks/useMqsimEvents';

// WAF (Write Amplification Factor) = flash-side page writes / host-side
// page writes = (host writes + GC/WL page moves) / host writes. Both sides
// are counted when the destination page is allocated (useMqsimEvents).
// This used to divide the engine's IssuedProgramCMD by hostWrites, but
// IssuedProgramCMD only counts once the program *command* reaches the chip
// - writes still queued in the scheduler were in the denominator but not
// yet the numerator, so mid-run WAF read below 1x (e.g. 20 host writes vs
// 6 issued commands early in "매핑 기본"), which can't happen for real. The
// two agree once the run ends. Mapping-table page writes aren't counted -
// none of this project's presets issue any (the whole table fits in the
// CMT; Issued_Flash_Program_CMD_For_Mapping is 0).
export function toStatItems(state: MqsimState | null, counters: SimulationCounters): StatItem[] {
  const waf = counters.hostWrites === 0 ? null : (counters.hostWrites + counters.migrationWrites) / counters.hostWrites;

  // Both derived straight from the block snapshot already in state.blocks -
  // no separate engine export needed (unlike WAF/gcExecutions/wlExecutions,
  // which only the engine's own Stats:: counters know).
  let totalPages = 0;
  let validPages = 0;
  let totalEraseCount = 0;
  for (const block of state?.blocks ?? []) {
    totalEraseCount += block.eraseCount;
    for (const page of block.pages) {
      totalPages++;
      if (page === 'valid') validPages++;
    }
  }
  const validPageRatio = totalPages === 0 ? null : validPages / totalPages;

  return [
    {
      label: 'WAF',
      value: waf === null ? '-' : `${waf.toFixed(2)}×`,
      hint: waf === null ? '아직 쓰기가 없어요' : '1 번 쓰기 위한 실제 write 횟수 (호스트 쓰기 + GC/WL 이동)',
    },
    {
      label: 'Valid page 비율',
      value: validPageRatio === null ? '-' : `${Math.round(validPageRatio * 100)}%`,
    },
    { label: 'GC 실행 횟수', value: String(state?.stats.gcExecutions ?? 0) },
    { label: 'WL 실행 횟수', value: String(state?.stats.wlExecutions ?? 0) },
    { label: 'Erase 횟수', value: String(totalEraseCount) },
  ];
}
