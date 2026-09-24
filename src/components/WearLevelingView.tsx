import type { ReactNode } from 'react';
import { useState } from 'react';
import type { WearRow, WlTriggerInfo } from '../types';

interface Props {
  rows: WearRow[];
  // Rendered at the bottom of this panel (e.g. FreeBlockChart).
  footer?: ReactNode;
  caption: string;
  // Most recent WL trigger's exact condition (useMqsimWlHighlight) - null
  // before WL has ever fired this run. Powers the "왜 발동했나요?" button
  // below (Ryu, 2026-09-20: wanted to see the actual condition that was
  // satisfied, not just that WL happened).
  trigger: WlTriggerInfo | null;
  // Whether the "⭐ 발동했어요" banner (and its explanation button) should
  // currently show - false once dismissed (useMqsimWlHighlight.
  // dismissBanner, called from App.tsx right as ▶ resumes playback past the
  // pause WL caused). The row-level 발동 횟수 column below is a separate,
  // permanent record and isn't affected by this (Ryu, 2026-09-20: only the
  // top banner reads as stale once the sim is running again, not the row).
  bannerVisible: boolean;
}

export function WearLevelingView({ rows, caption, trigger, bannerVisible, footer }: Props) {
  // Collapsed by default even once a trigger exists - showing it
  // automatically would fight with ▶ auto-pausing right when this becomes
  // available (see App.tsx's onRefresh / useSimulationPlayback's
  // shouldPause) - the user asked to review it on demand via the button,
  // not have it thrust in front of them immediately.
  const [showExplanation, setShowExplanation] = useState(false);

  // Static WL fires at most once or twice in a whole run and there's
  // otherwise zero indication it ever happened (found 2026-09-20 - Ryu
  // tested this preset and couldn't tell whether it had worked) - this
  // banner and each affected row's own 발동 횟수 marker below persist for
  // the rest of the run instead of a one-step flash, since a beginner has
  // no realistic chance of watching for the exact moment live.
  const wlTargetCount = rows.filter((row) => row.wlTriggerCount > 0).length;
  // Only the live-engine rows know which flow a block's data came from.
  const showDataKind = rows.some((row) => row.dataKind !== undefined);
  return (
    <div className="sim-grid-panel">
      <div className="sim-panel-title">Block 별 Erase Count ( 마모 평준화 대상 )</div>
      {caption && <div className="sim-caption">{caption}</div>}
      {wlTargetCount > 0 && trigger && bannerVisible ? (
        <>
          <button type="button" className="wl-status wl-status-button" onClick={() => setShowExplanation((v) => !v)}>
            {`⭐ 정적 마모평준화가 ${wlTargetCount}개 block 에서 발동했어요 - 왜 발동했는지 ${showExplanation ? '숨기기' : '보기'}`}
          </button>
          {showExplanation && (
            <div className="wl-explanation">
              <p>
                <strong>Block {trigger.maxEraseBlock}</strong>는 <strong>{trigger.maxEraseCount}회</strong>로 가장 많이
                닳았고, <strong>Block {trigger.targetBlock}</strong>는 <strong>{trigger.minEraseCount}회</strong>로 가장
                적게 닳았습니다.
              </p>
              <p>
                두 값의 차이(<strong>{trigger.maxEraseCount - trigger.minEraseCount}</strong>)가 설정된 GC 임계값이 아닌{' '}
                <strong>마모평준화 임계값({trigger.threshold})</strong> 이상이 되어 정적 마모평준화가 발동했고, 가장 적게 닳은
                Block {trigger.targetBlock}의 데이터를 다른 곳으로 옮겨서 이 block 을 다시 사용할 수 있게 합니다.
              </p>
              <p>
                가장 적게 닳은 block 이 여러 개 동률일 수도 있는데, 그럴 땐 그 중{' '}
                <strong>block 번호가 가장 낮은 block</strong>이 선택돼요 — Block {trigger.targetBlock}가 유일하게
                특별해서가 아니라, 동률 중 번호가 가장 낮았기 때문일 수 있습니다.
              </p>
            </div>
          )}
        </>
      ) : wlTargetCount === 0 ? (
        <div className="wl-status">아직 정적 마모평준화가 발동하지 않았어요 - 재생을 계속하면 언젠가 발동해요</div>
      ) : null}
      <div className="wl-row wl-header">
        <div className="wl-label" />
        {showDataKind && <div className="wl-data">데이터</div>}
        <div className="wl-track" />
        <div className="wl-count">Erase Count</div>
        <div className="wl-trigger-count">발동 횟수</div>
      </div>
      {rows.map((row) => (
        <div className={`wl-row${row.wlTriggerCount > 0 ? ' wl-target' : ''}`} key={row.label}>
          <div className="wl-label">{row.label}</div>
          {showDataKind && (
            <div className="wl-data">
              {row.dataKind ? <span className={`wl-data-tag ${row.dataKind}`}>{row.dataKind}</span> : '-'}
            </div>
          )}
          <div className="wl-track">
            <div
              className={`wl-fill ${row.level}`}
              style={{ width: `${Math.round((row.eraseCount / row.maxEraseCount) * 100)}%` }}
            />
          </div>
          <div className="wl-count">
            {row.eraseCount} 회 erase {row.level === 'hot' ? '🔥' : row.level === 'cool' ? '❄️' : ''}
          </div>
          <div className="wl-trigger-count">{row.wlTriggerCount > 0 ? `⭐ ${row.wlTriggerCount}회` : '-'}</div>
        </div>
      ))}
      <div className="sim-legend">
        <span><span className="swatch valid" />cool ( 적게 닳음 )</span>
        <span><span className="swatch moving" />warm</span>
        <span><span className="swatch invalid" />hot ( 많이 닳음 )</span>
      </div>
      {showDataKind && (
        <div className="sim-caption wl-data-caption">
          데이터 열: <b>cold</b> = 한 번 쓰고 다시 안 건드리는 데이터 (정적 마모평준화가 옮기는 대상), <b>hot</b> =
          계속 덮어쓰는 데이터. 막대 색(마모 정도)과는 다른 기준이에요.
        </div>
      )}
      {footer}
    </div>
  );
}
