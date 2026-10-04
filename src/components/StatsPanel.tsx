import type { StatItem } from '../types';
import { Term } from './Term';
import type { GlossaryKey } from '../data/glossary';

// Stat labels that have a glossary entry get a hover definition.
const LABEL_TERMS: Record<string, GlossaryKey> = {
  WAF: 'waf',
  'Valid page 비율': 'valid',
  'GC 실행 횟수': 'gc',
  'WL 실행 횟수': 'wl',
  'Erase 횟수': 'erase',
};

export function StatsPanel({ stats }: { stats: StatItem[] }) {
  return (
    <div className="sim-panel">
      <div className="sim-panel-title">통계</div>
      {stats.map((s) => {
        const term = LABEL_TERMS[s.label];
        return (
          <div key={s.label}>
            <div className="stat-row">
              <span>{term ? <Term id={term}>{s.label}</Term> : s.label}</span>
              <span className="stat-value">{s.value}</span>
            </div>
            {s.hint && <div className="stat-hint" style={{ marginTop: '-6px', marginBottom: '8px' }}>{s.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}
