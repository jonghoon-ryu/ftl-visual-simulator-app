import type { PresetScenario } from '../types';

function row(states: string): { state: 'valid' | 'invalid' | 'free' | 'moving' }[] {
  const map = { V: 'valid', X: 'invalid', F: 'free', M: 'moving' } as const;
  return states.split('').map((c) => ({ state: map[c as keyof typeof map] }));
}

export const presets: PresetScenario[] = [
  {
    id: 'mapping',
    label: '매핑 기본',
    caption:
      '🔵 LPA 0x001 을 처음 썼어요 — 비어있던 Block 0 · Page 0 에 매핑되고, 매핑 테이블에 새 항목이 생겨요',
    blocks: [
      { label: 'Block 0', pages: row('VVVFFFFFFFFFFFFF') },
      { label: 'Block 1', pages: row('FFFFFFFFFFFFFFFF') },
    ],
    params: [
      { label: 'Over-provisioning', value: '7%', hint: '여유 공간을 더 두면 GC 가 덜 급해져요', kind: 'slider', percent: 30 },
      { label: '매핑 방식', value: 'Page-level', hint: 'Hybrid 로 바꾸면 log-block 방식으로 동작', kind: 'select' },
    ],
    stats: [
      { label: 'WAF', value: '1.0×', hint: '아직 재기록이 없어서 이상적인 값' },
      { label: 'GC 실행 횟수', value: '0' },
    ],
    log: [{ time: '00:00:01', text: 'LPA 0x001 이 Block 0 · Page 0 에 매핑됨' }],
  },
  {
    id: 'gc',
    label: 'GC 시연',
    caption:
      '🔶 Block 2 가 꽉 차서 정리를 시작해요 — 유효한 페이지 4개를 새 block(5)으로 옮기는 중 (GC)',
    blocks: [
      { label: 'Block 0', pages: row('VVXVXVVXVVVVVFVV') },
      { label: 'Block 1', pages: row('XFXVFVFVVVVFVXXV') },
      { label: 'Block 2', pages: row('VVVVVMMXMMXXXXXX') },
      { label: 'Block 3', pages: row('XVFVVFVXVXFXFVXX') },
      { label: 'Block 5 (GC 대상)', pages: row('FFFFFFFVFFFVFVFF') },
    ],
    params: [
      { label: 'Over-provisioning', value: '7%', hint: '여유 공간을 더 두면 GC 가 덜 급해져요', kind: 'slider', percent: 30 },
      { label: 'GC 임계값', value: '5%', hint: '빈 block 이 이 아래로 떨어지면 GC 시작', kind: 'slider', percent: 55 },
      { label: '매핑 방식', value: 'Page-level', hint: 'Hybrid 로 바꾸면 log-block 방식으로 동작', kind: 'select' },
    ],
    stats: [
      { label: 'WAF', value: '1.8×', hint: '1 번 쓰려고 실제로는 1.8 번 write 함 — 낮을수록 좋음' },
      { label: 'Valid page 비율', value: '62%', hint: '전체 페이지 중 아직 쓸모있는 비율' },
      { label: 'GC 실행 횟수', value: '14' },
    ],
    log: [
      { time: '12:03:41', text: 'Block 2 의 valid page 4개를 Block 5 로 이동 시작 (GC)' },
      { time: '12:03:40', text: 'LPA 0x0F4 에 새 데이터가 쓰이면서 기존 페이지가 invalid 로 표시됨' },
      { time: '12:03:38', text: '빈 block 비율이 5% 아래로 떨어져 GC 트리거됨' },
    ],
  },
  {
    id: 'wear-leveling',
    label: '마모평준화 시연',
    caption:
      '🟨 Block 2(118회)는 마모가 심하고 Block 5(9회)는 거의 안 닳았어요 — static WL 이 Block 5 의 cold 데이터를 옮겨서 Block 5 를 free pool 로 돌려보내는 중',
    wearRows: [
      { label: 'Block 0', eraseCount: 42, maxEraseCount: 120, level: 'warm' },
      { label: 'Block 1', eraseCount: 55, maxEraseCount: 120, level: 'warm' },
      { label: 'Block 2', eraseCount: 118, maxEraseCount: 120, level: 'hot' },
      { label: 'Block 3', eraseCount: 47, maxEraseCount: 120, level: 'warm' },
      { label: 'Block 4', eraseCount: 30, maxEraseCount: 120, level: 'cool' },
      { label: 'Block 5', eraseCount: 9, maxEraseCount: 120, level: 'cool' },
    ],
    params: [
      { label: 'Static WL 임계값', value: 'erase count 차이 100', hint: '이 차이를 넘으면 cold 데이터를 강제로 옮김', kind: 'slider', percent: 70 },
    ],
    stats: [
      { label: '최대-최소 erase 차이', value: '109', hint: '이 값이 클수록 마모가 한쪽으로 쏠린 것' },
      { label: 'WL 발동 횟수', value: '3' },
    ],
    log: [
      { time: '12:05:02', text: 'Block 2 와 Block 5 의 erase count 차이(109)가 임계값을 넘어 static WL 트리거됨' },
      { time: '12:05:03', text: 'Block 5 의 cold 데이터를 Block 2 로 이동 — Block 5 가 free pool 로 돌아감' },
    ],
  },
];
