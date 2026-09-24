import type { JourneyStep, LpnJourney } from '../hooks/useLpnJourney';

interface Props {
  journey: LpnJourney;
  showsGrid: boolean;
  onClose: () => void;
}

const HOW_TEXT: Record<JourneyStep['how'], string> = {
  write: '처음 쓰기',
  overwrite: '덮어쓰기 - 같은 자리에 못 쓰고 새 page 에 씀',
  gc: 'GC 가 옮김 - victim block 을 비우려고',
  wl: '정적 마모평준화가 옮김',
};

// "LPN 0x0b2 의 여정": every physical page one logical page's data has
// occupied, newest last - the out-of-place update in one list. Flash can't
// overwrite in place, so each overwrite lands on a new page and the old one
// turns invalid; GC later moves whatever is still valid before erasing.
export function LpnJourneyPanel({ journey, showsGrid, onClose }: Props) {
  const { steps, lpnLabel, erasedCount } = journey;
  return (
    <div className="journey-panel">
      <div className="journey-header">
        <span>LPN {lpnLabel} 의 여정</span>
        <button type="button" className="journey-close" onClick={onClose} aria-label="따라가기 끄기">
          ✕
        </button>
      </div>
      {steps.length === 0 ? (
        <div className="journey-note">아직 이 LPN 에 쓰기가 없어요</div>
      ) : (
        <ol className="journey-steps">
          {steps.map((step, i) => {
            const isNow = i === steps.length - 1;
            return (
              <li key={i} className={isNow ? 'now' : undefined}>
                <span className="journey-where">
                  Chip {step.chip}, Block {step.block}, Page {step.page}
                </span>
                <span className="journey-how">
                  {HOW_TEXT[step.how]}
                  {isNow ? ' · 지금 여기' : ' · 이후 무효(invalid)'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="journey-note">
        {showsGrid
          ? '격자에서 굵은 테두리 = 지금 데이터가 있는 page, 점선 = 예전 복사본(invalid, 아직 안 지워짐).'
          : '이 화면에는 page 격자가 없어서 목록으로만 보여줘요.'}
        {erasedCount > 0 && ` 예전 복사본 ${erasedCount}개는 그 block 이 이미 지워져서 사라졌어요.`}
      </div>
    </div>
  );
}
