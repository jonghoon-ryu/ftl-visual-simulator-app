import { useState } from 'react';
import type { WearRow } from '../types';
import type { WlTriggerInfo } from '../hooks/useMqsimWlHighlight';

interface Props {
  rows: WearRow[];
  caption: string;
  // Most recent WL trigger's exact condition (useMqsimWlHighlight) - null
  // before WL has ever fired this run. Powers the "왜 발동했나요?" button
  // below (Ryu, 2026-09-20: wanted to see the actual condition that was
  // satisfied, not just that WL happened).
  trigger: WlTriggerInfo | null;
}

export function WearLevelingView({ rows, caption, trigger }: Props) {
  // Collapsed by default even once a trigger exists - showing it
  // automatically would fight with ▶ auto-pausing right when this becomes
  // available (see App.tsx's onRefresh / useSimulationPlayback's
  // shouldPause) - the user asked to review it on demand via the button,
  // not have it thrust in front of them immediately.
  const [showExplanation, setShowExplanation] = useState(false);

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
      {wlTargetCount > 0 && trigger ? (
        <>
          <button type="button" className="wl-status wl-status-button" onClick={() => setShowExplanation((v) => !v)}>
            {`⭐ 마모평준화가 ${wlTargetCount}개 block 에서 발동했어요 - 왜 발동했는지 ${showExplanation ? '숨기기' : '보기'}`}
          </button>
          {showExplanation && (
            <div className="wl-explanation">
              <p>
                <strong>
                  Block {trigger.maxEraseChip}·{trigger.maxEraseBlock}
                </strong>
                는 <strong>{trigger.maxEraseCount}회</strong>로 가장 많이 닳았고,{' '}
                <strong>
                  Block {trigger.targetChip}·{trigger.targetBlock}
                </strong>
                는 <strong>{trigger.minEraseCount}회</strong>로 가장 적게 닳았습니다.
              </p>
              <p>
                두 값의 차이(<strong>{trigger.maxEraseCount - trigger.minEraseCount}</strong>)가 설정된 GC 임계값이 아닌{' '}
                <strong>마모평준화 임계값({trigger.threshold})</strong> 이상이 되어 정적 마모평준화가 발동했고, 가장 적게 닳은
                Block {trigger.targetChip}·{trigger.targetBlock}의 데이터를 다른 곳으로 옮겨서 이 block 을 다시 사용할 수 있게
                합니다.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="wl-status">아직 마모평준화가 발동하지 않았어요 - 재생을 계속하면 언젠가 발동해요</div>
      )}
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
