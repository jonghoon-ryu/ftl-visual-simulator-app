import type { WearRow } from '../types';

interface Props {
  rows: WearRow[];
  caption: string;
}

export function WearLevelingView({ rows, caption }: Props) {
  return (
    <div className="sim-grid-panel">
      <div className="sim-panel-title">Block 별 Erase Count ( 마모 평준화 대상 )</div>
      {caption && <div className="sim-caption">{caption}</div>}
      {rows.map((row) => (
        <div className="wl-row" key={row.label}>
          <div className="wl-label">{row.label}</div>
          <div className="wl-track">
            <div
              className={`wl-fill ${row.level}`}
              style={{ width: `${Math.round((row.eraseCount / row.maxEraseCount) * 100)}%` }}
            />
          </div>
          <div className="wl-count">
            {row.eraseCount} 회 erase {row.level === 'hot' ? '🔥' : row.level === 'cool' ? '❄️' : ''}
          </div>
        </div>
      ))}
      <div className="sim-legend">
        <span><span className="swatch valid" />cool ( 적게 닳음 )</span>
        <span><span className="swatch moving" />warm</span>
        <span><span className="swatch invalid" />hot ( 많이 닳음 )</span>
      </div>
    </div>
  );
}
