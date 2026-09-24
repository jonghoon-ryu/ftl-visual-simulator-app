import { useState } from 'react';
import type { SsdParams } from '../data/mqsimConfigs';
import type { LastGcInfo } from '../hooks/useFreeBlockHistory';

interface Props {
  gc: LastGcInfo | null;
  params: SsdParams;
}

// "GC 시연"'s counterpart to WearLevelingView's "왜 발동했는지 보기": why GC
// started (free blocks below the threshold), what this victim costs (valid
// pages = what must be moved, invalid pages = what gets reclaimed), and how
// the selected GC 알고리즘 picked it - so switching the policy dropdown and
// comparing victims shows why victim selection drives WAF.
export function GcVictimExplanation({ gc, params }: Props) {
  const [open, setOpen] = useState(false);
  if (!gc) {
    return <div className="gc-status">아직 GC 가 시작되지 않았어요 - 빈 block 이 임계값 아래로 줄어들면 시작돼요</div>;
  }
  const where = params.chipCount > 1 ? `Chip ${gc.chip} · Block ${gc.block}` : `Block ${gc.block}`;
  return (
    <>
      <button type="button" className="gc-status gc-status-button" onClick={() => setOpen((v) => !v)}>
        {`🧹 ${gc.count}번째 GC 가 ${where} 를 청소 대상(victim)으로 골랐어요 - 왜 골랐는지 ${open ? '숨기기' : '보기'}`}
      </button>
      {open && (
        <div className="gc-explanation">
          <p>
            <strong>왜 지금 GC?</strong> 이 칩의 빈 block 이 <strong>{gc.freeBlocks}개</strong>로, GC 임계값{' '}
            <strong>{gc.gcThresholdBlocks}개</strong>보다 적어졌기 때문이에요. 쓸 자리가 더 모자라기 전에 미리 청소를
            시작합니다.
          </p>
          <p>
            <strong>이 block 을 청소하면?</strong> {gc.pagesPerBlock}개 page 중 <strong>invalid {gc.invalidPages}개</strong>는
            덮어써서 이미 쓸모없는 page 라 지우기만 하면 되지만, <strong>valid {gc.validPages}개</strong>는 아직 살아있는
            데이터라 다른 block 으로 먼저 옮겨야 해요. 그래서 valid 가 적은 victim 일수록 GC 가 싸고, 옮긴 만큼 WAF 가
            올라갑니다.
          </p>
          <p>
            <strong>어떻게 골랐나?</strong> {policyRule(params)}
          </p>
        </div>
      )}
    </>
  );
}

function policyRule(params: SsdParams): string {
  switch (params.gcBlockSelectionPolicy) {
    case 'RGA': {
      const sample = Math.max(1, Math.floor(Math.log2(params.blockNoPerPlane)));
      return `RGA 는 다 쓴 block 중 무작위로 ${sample}개(= log₂(block 개수))를 뽑아, 그중 invalid page 가 가장 많은 block 을 고릅니다. 모든 block 을 다 보진 않으니 최선이 아닐 수도 있지만 빠르고 대체로 괜찮은 선택이에요.`;
    }
    case 'GREEDY':
      return 'Greedy 는 다 쓴 block 전부를 보고 invalid page 가 가장 많은 block 을 고릅니다 - 옮길 valid page 가 가장 적은, 가장 싼 victim 이에요.';
    case 'RANDOM':
      return 'Random 은 아무 block 이나 무작위로 고릅니다 (다 안 쓴 block 도 후보). invalid 개수를 보지 않으니 운에 따라 비싼 victim 이 뽑힐 수도 있지만, 뽑힌 block 에 청소할 게 없으면 그 GC 기회를 건너뛰기도 해요 - 실제로 얼마나 옮기는지는 아래 "GC 알고리즘 비교"로 확인해보세요.';
    case 'RANDOM_P':
      return 'Random-p 는 다 쓴 block 중에서 무작위로 고릅니다 - Random 보다는 낫지만 invalid 개수는 보지 않아요.';
    case 'RANDOM_PP':
      return 'Random-pp 는 다 쓴 block 중 invalid page 가 일정 개수 이상인 block 에서 무작위로 고릅니다 (이 데모 설정에서는 그 기준이 사실상 0 이라 Random-p 와 같게 동작해요).';
    case 'FIFO':
      return 'FIFO 는 가장 먼저 쓰기 시작한 block 부터 차례로 고릅니다 (invalid 가 하나도 없는 block 은 건너뜀). 오래된 block 일수록 덮어쓴 page 가 많을 거라는 가정이에요.';
  }
}
