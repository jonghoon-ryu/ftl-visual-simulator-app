import type { PresetId } from '../types';

interface Lesson {
  presetId: PresetId;
  title: string;
  goal: string;
}

// Order a first-time visitor should follow. Each goal says what to look for
// on screen, since the presets are otherwise just three unlabelled tabs.
const LESSONS: Lesson[] = [
  {
    presetId: 'mapping',
    title: '매핑',
    goal: '같은 LPN 에 다시 쓰면 데이터가 어디로 가는지 지켜보세요. ▶ 를 누르거나 → 키로 로그를 한 줄씩 진행해요. 로그의 LPN 을 클릭하면 그 데이터의 여정이 보여요.',
  },
  {
    presetId: 'gc',
    title: 'GC (청소)',
    goal: '빈 block 이 줄어들면 FTL 이 청소(GC)를 시작해요. ▶ 를 누르고 아래 차트의 톱니 모양과 "왜 이 block 을 골랐나요?" 를 찾아보세요.',
  },
  {
    presetId: 'wear-leveling',
    title: '마모평준화',
    goal: 'block 마다 지운 횟수가 크게 벌어지지 않도록 FTL 이 데이터를 옮겨요. ▶ 를 누르고 정적 마모평준화(★)가 발동하는 순간을 기다려보세요.',
  },
];

interface Props {
  activeId: PresetId;
  onSelect: (id: PresetId) => void;
  onOpenIntro: () => void;
}

export function LessonBar({ activeId, onSelect, onOpenIntro }: Props) {
  const index = LESSONS.findIndex((l) => l.presetId === activeId);
  if (index < 0) return null;
  const lesson = LESSONS[index];
  const prev = LESSONS[index - 1];
  const next = LESSONS[index + 1];

  return (
    <div className="lesson-bar">
      <div className="lesson-bar-text">
        <span className="lesson-bar-step">
          레슨 {index + 1}/{LESSONS.length} · {lesson.title}
        </span>
        <span className="lesson-bar-goal">{lesson.goal}</span>
      </div>
      <div className="lesson-bar-actions">
        <button type="button" className="lesson-bar-link" onClick={onOpenIntro}>
          처음이라면: 왜 FTL 이 필요할까?
        </button>
        <button type="button" disabled={!prev} onClick={() => prev && onSelect(prev.presetId)}>
          ◂ 이전
        </button>
        <button type="button" disabled={!next} onClick={() => next && onSelect(next.presetId)}>
          다음 ▸
        </button>
      </div>
    </div>
  );
}
