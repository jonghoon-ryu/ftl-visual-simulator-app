import type { WearRow } from '../types';

interface Props {
  rows: WearRow[];
  caption: string;
}

export function WearLevelingView({ rows, caption }: Props) {
  // Static WL fires at most once or twice in a whole run and there's
  // otherwise zero indication it ever happened (found 2026-09-20 - Ryu
  // tested this preset and couldn't tell whether it had worked) - this
  // banner and each affected row's own marker below persist for the rest
  // of the run instead of a one-step flash, since a beginner has no
  // realistic chance of watching for the exact moment live.
  const wlTargetCount = rows.filter((row) => row.wasWlTarget).length;
  return (
    <div className="sim-grid-panel">
      <div className="sim-panel-title">Block 별 Erase Count ( 마모 평준화 대상 )</div>
      {caption && <div className="sim-caption">{caption}</div>}
      <div className="wl-status">
        {wlTargetCount > 0
          ? `⭐ 마모평준화가 ${wlTargetCount}개 block 에서 발동했어요 - 아래에 표시됩니다`
          : '아직 마모평준화가 발동하지 않았어요 - 재생을 계속하면 언젠가 발동해요'}
      </div>
      {rows.map((row) => (
        <div className={`wl-row${row.wasWlTarget ? ' wl-target' : ''}`} key={row.label}>
          <div className="wl-label">{row.label}</div>
          <div className="wl-track">
            <div
              className={`wl-fill ${row.level}`}
              style={{ width: `${Math.round((row.eraseCount / row.maxEraseCount) * 100)}%` }}
            />
          </div>
          <div className="wl-count">
            {row.eraseCount} 회 erase {row.level === 'hot' ? '🔥' : row.level === 'cool' ? '❄️' : ''}
            {row.wasWlTarget ? ' ⭐ 마모평준화 발동!' : ''}
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
