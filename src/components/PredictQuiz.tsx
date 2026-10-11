import { useState } from 'react';
import type { PresetId } from '../types';

interface Question {
  prompt: string;
  options: string[];
  answer: number;
  // Why - shown after an answer is picked, right or wrong.
  explanation: string;
  // Where on this screen the learner can see it happen for themselves.
  howToCheck: string;
}

// Numbers quoted below are this project's defaults (OP 20%, GC threshold 30%),
// re-measured 2026-10-11 with engine/tests/cache/claims.mts + wlth.mts. Re-measure
// if defaults change.
const QUESTIONS: Partial<Record<PresetId, Question[]>> = {
  mapping: [
    {
      prompt: '이미 쓴 LPN 에 다시 쓰면, 새 데이터는 어디에 저장될까요?',
      options: ['원래 있던 page 에 그대로 덮어쓴다', '빈 page 에 새로 쓰고, 원래 page 는 무효(invalid)가 된다', '그 block 을 통째로 지우고 다시 쓴다'],
      answer: 1,
      explanation:
        'flash 는 이미 쓴 page 에 다시 쓸 수 없고, 지우는 건 block 단위로만 됩니다. 그래서 FTL 은 새 데이터를 빈 page 에 쓰고 매핑 테이블만 새 위치로 바꾼 뒤, 예전 page 는 무효로 표시해둡니다 (out-of-place update).',
      howToCheck: '로그에서 "LPN 0x… : Chip … -> Chip …, Write" 처럼 화살표가 있는 줄이 덮어쓰기예요. 그 줄을 클릭하면 예전 page 는 점선, 새 page 는 굵은 테두리로 보여요.',
    },
  ],
  gc: [
    {
      prompt: 'GC 는 언제 시작될까요?',
      options: ['빈 block 이 하나도 없을 때', '빈 block 수가 GC 임계값 아래로 내려갔을 때', '일정한 시간마다'],
      answer: 1,
      explanation:
        '빈 block 이 완전히 바닥나면 쓰기를 받을 수 없어서, FTL 은 빈 block 이 임계값 아래로 내려가는 순간 미리 GC 를 시작합니다. GC 임계값 슬라이더가 바로 그 기준이에요.',
      howToCheck: '오른쪽 "비교 실험실" 탭 맨 아래의 "빈 block 수 변화" 차트에서 GC 시작 점(●)이 모두 점선(임계값) 아래에 찍혀요.',
    },
    {
      prompt: '기본 알고리즘 RGA 는 어떤 block 을 GC victim 으로 고를까요?',
      options: ['무작위로 몇 개를 뽑아, 그중 invalid page 가 가장 많은 block', '가장 오래전에 쓴 block', '가장 많이 닳은 block'],
      answer: 0,
      explanation:
        'invalid page 가 많을수록 옮길 valid page 가 적어서 GC 가 쌉니다. RGA 는 전부 비교하는 대신 log₂(block 개수)개만 무작위로 뽑아 그중 가장 좋은 것을 고르는 절충안이에요. (가장 오래된 block 은 FIFO, 가장 많이 닳은 block 은 GC 가 아니라 마모평준화가 신경 쓰는 기준이에요.)',
      howToCheck: 'GC 가 시작되면 격자 위에 뜨는 "왜 골랐는지 보기" 에서 victim 의 valid/invalid 수를 확인해보세요.',
    },
    {
      prompt: 'DRAM 쓰기 캐시를 끄면 호스트 요청 하나당 GC 는 어떻게 될까요?',
      options: ['줄어든다', '거의 같다', '늘어난다'],
      answer: 2,
      explanation:
        '캐시가 켜져 있으면 같은 page 에 대한 반복 쓰기를 DRAM 이 흡수해서, 요청 일부만 flash 에 닿아요. 끄면 거의 모든 요청이 flash 쓰기가 되니 요청 하나당 GC 가 약 1.5배가 됩니다. 기본 설정에서 끝까지 돌리면 켬: 요청 12,679 → flash 쓰기 6,354, GC 536번 / 끔: 요청 6,771 → flash 쓰기 4,679, GC 431번. GC 총 횟수만 보면 켰을 때가 더 많은데, 같은 시뮬레이션 시간 동안 캐시 덕분에 요청을 거의 두 배 처리했기 때문이에요 - 그래서 요청 수로 나눠서 비교해야 해요 (WAF 도 1.38× → 1.51×).',
      howToCheck: 'Workload 의 "DRAM 쓰기 캐시" 를 끄고 끝까지 재생해보세요. 통계의 "GC 실행 횟수" 를 "호스트 요청" 수로 나눈 값을 캐시를 켰을 때와 비교해보세요.',
    },
    {
      prompt: '호스트가 어떤 데이터를 TRIM(삭제 알림)하면, 나중에 GC 는 어떻게 달라질까요?',
      options: ['달라지지 않는다', '그 page 는 invalid 라서 옮기지 않아도 돼 GC 가 더 싸진다', 'TRIM 한 page 는 즉시 지워진다'],
      answer: 1,
      explanation:
        'TRIM 을 모르면 FTL 은 삭제된 데이터도 valid 라고 믿고 GC 때마다 계속 옮깁니다. TRIM 을 받으면 그 page 를 invalid 로 표시해서 GC 가 옮길 필요가 없어지고, WAF 가 내려가요. 다만 page 는 지우는 단위가 block 이라서 즉시 지워지지는 않고, 그 block 이 GC 로 지워질 때 공간이 돌아옵니다.',
      howToCheck: '오른쪽 "비교 실험실" 탭에서 "TRIM" 의 "지금 TRIM 하기" 를 눌러 격자에서 초록(valid) page 가 빨간(invalid) 으로 바뀌는 걸 보고, "TRIM 효과 비교" 로 WAF 차이를 확인해보세요.',
    },
    {
      prompt: '기본 설정에서, 다음 GC 알고리즘 중 WAF 가 가장 낮은 것은?',
      options: ['RGA', 'Greedy', 'Random', 'FIFO'],
      answer: 1,
      explanation:
        '기본 설정에서는 invalid 가 가장 많은 block 을 고르는 Greedy 가 1.34× 로 가장 낮아요 (Cost-Benefit 1.37×, RGA 1.38×, FIFO 1.40×, Random 1.69×). Random 은 invalid 개수를 보지 않고 고르니 valid page 가 많은 block 이 뽑혀 옮길 게 많아져요. 다만 block 이 적은 작은 규모에서는 한 번의 선택이 다음 GC 들의 상황까지 바꿔서 순위가 설정마다 달라집니다 - 작업 범위나 OP 를 바꾸고 직접 돌려 비교해보세요.',
      howToCheck: '오른쪽 "비교 실험실" 탭에서 "GC 알고리즘 비교" 버튼으로 7개를 직접 돌려 표로 확인해보세요.',
    },
  ],
  'wear-leveling': [
    {
      prompt: '정적 마모평준화(static WL)가 옮기는 데이터는 어떤 데이터일까요?',
      options: ['계속 덮어쓰는 hot 데이터', '한 번 쓰고 다시 안 건드리는 cold 데이터', '빈 block'],
      answer: 1,
      explanation:
        'cold 데이터가 앉아 있는 block 은 지워질 일이 없어 erase 횟수가 계속 0 에 머물고, 다른 block 들만 닳습니다. 정적 마모평준화는 그 차이가 임계값 이상 벌어지면 cold 데이터를 다른 곳으로 옮겨서, 덜 닳은 block 도 다시 쓰이게 해요.',
      howToCheck: '각 block 의 "데이터" 열에서 cold 인 block 들의 erase 횟수를 hot block 과 비교해보고, 발동하면 ⭐ 표시된 block 이 어떤 데이터였는지 보세요.',
    },
    {
      prompt: '마모평준화 임계값을 3 에서 1 로 낮추면 발동 횟수는?',
      options: ['줄어든다', '거의 같다', '크게 늘어난다'],
      answer: 2,
      explanation:
        '임계값은 "가장 많이 닳은 block 과 가장 적게 닳은 block 의 erase 차이"의 기준이에요. 1 이면 차이가 조금만 벌어져도 발동해서, 기본 설정에서 92번 → 366번으로 늘어납니다 - 대부분은 불필요한 데이터 이동이라 WAF 도 올라가요.',
      howToCheck: '오른쪽 설정의 "마모평준화 임계값" 을 1 로 바꾸고 재생해 통계의 WL 실행 횟수를 비교해보세요.',
    },
  ],
};

interface Props {
  presetId: PresetId;
}

// "예측해보기": a short predict-then-check card at the top of each preset -
// guess first, then see the answer and exactly where on the screen it shows
// up. Answers are fixed facts or this project's measured defaults (see the
// comment on QUESTIONS), never guessed.
export function PredictQuiz({ presetId }: Props) {
  const questions = QUESTIONS[presetId] ?? [];
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  if (questions.length === 0) return null;
  const q = questions[Math.min(index, questions.length - 1)];

  if (collapsed) {
    return (
      <button type="button" className="quiz-reopen" onClick={() => setCollapsed(false)}>
        🤔 예측해보기 열기
      </button>
    );
  }

  return (
    <div className="quiz-card">
      <div className="quiz-header">
        <span>
          🤔 예측해보기 ({index + 1}/{questions.length})
        </span>
        <button type="button" className="quiz-close" onClick={() => setCollapsed(true)} aria-label="예측해보기 접기">
          접기
        </button>
      </div>
      <div className="quiz-prompt">{q.prompt}</div>
      <div className="quiz-options">
        {q.options.map((option, i) => {
          const state =
            picked === null ? '' : i === q.answer ? ' correct' : i === picked ? ' wrong' : ' dimmed';
          return (
            <button
              type="button"
              key={i}
              className={`quiz-option${state}`}
              disabled={picked !== null}
              onClick={() => setPicked(i)}
            >
              {picked !== null && i === q.answer ? '✓ ' : picked === i ? '✗ ' : ''}
              {option}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="quiz-answer">
          <p>
            <strong>{picked === q.answer ? '정답이에요!' : '아쉬워요 - 정답은 ✓ 표시한 것이에요.'}</strong> {q.explanation}
          </p>
          <p className="quiz-check">👀 확인하는 법: {q.howToCheck}</p>
          <div className="quiz-nav">
            {index + 1 < questions.length ? (
              <button
                type="button"
                className="quiz-next"
                onClick={() => {
                  setIndex(index + 1);
                  setPicked(null);
                }}
              >
                다음 문제 →
              </button>
            ) : (
              <button
                type="button"
                className="quiz-next"
                onClick={() => {
                  setIndex(0);
                  setPicked(null);
                }}
              >
                처음부터 다시
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
