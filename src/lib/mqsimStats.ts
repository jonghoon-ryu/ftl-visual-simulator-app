import type { StatItem } from '../types';
import type { SimulationCounters } from '../hooks/useMqsimEvents';

// WAF (Write Amplification Factor) = flash-side page writes / host-side
// page writes. issuedProgramCmd already counts every physical page program
// (user writes + GC/WL copy-writes); hostWrites (from useMqsimEvents) counts
// only host-triggered logical page writes - see that hook's doc comment for
// why it's the right denominator instead of a raw request count.
export function toStatItems(state: MqsimState | null, counters: SimulationCounters): StatItem[] {
  const issuedProgramCmd = state?.stats.issuedProgramCmd ?? 0;
  const waf = counters.hostWrites === 0 ? null : issuedProgramCmd / counters.hostWrites;

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
      hint: waf === null ? '아직 쓰기가 없어요' : '1 번 쓰기 위한 실제 write 횟수',
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
