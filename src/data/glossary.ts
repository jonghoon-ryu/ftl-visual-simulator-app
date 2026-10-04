// Plain-language definitions shown by <Term> on hover/focus. Keys are short
// ids used at the call sites (ParamPanel, StatsPanel); keep each definition to
// one or two sentences a first-time reader can follow without other context.
export interface GlossaryEntry {
  term: string;
  short: string;
}

export const glossary = {
  lpn: {
    term: 'LPN (논리 페이지 번호)',
    short: '호스트(컴퓨터)가 "이 번호의 데이터를 달라/저장해라" 할 때 쓰는 주소예요. 실제로 flash 의 어디에 있는지는 FTL 이 따로 기억해요.',
  },
  page: {
    term: 'Page',
    short: 'flash 에 쓰고 읽는 최소 단위(보통 4~16KB). 한 번 쓴 page 는 지우기 전까지 다시 쓸 수 없어요.',
  },
  block: {
    term: 'Block',
    short: 'page 여러 개를 묶은, flash 에서 지울 수 있는 최소 단위. 지우려면 block 안의 page 를 전부 한꺼번에 지워야 해요.',
  },
  valid: {
    term: 'Valid / Invalid page',
    short: 'valid 는 지금 쓰이는 최신 데이터, invalid 는 같은 LPN 에 새로 쓰면서 낡아진 옛 복사본이에요. invalid 는 block 을 지워야 비로소 공간이 돌아와요.',
  },
  op: {
    term: 'Over-provisioning (OP)',
    short: '사용자에게 보이는 용량보다 SSD 가 몰래 더 갖고 있는 여유 공간 비율이에요. 여유가 클수록 GC 가 덜 급하고 WAF 가 낮아져요.',
  },
  gc: {
    term: 'GC (Garbage Collection)',
    short: '빈 block 이 모자라면, invalid page 가 많은 block 을 골라 거기 남은 valid page 만 다른 곳에 옮기고 block 을 지워서 빈 공간을 되찾는 청소 작업이에요.',
  },
  gcThreshold: {
    term: 'GC 임계값',
    short: '전체 block 중 빈 block 의 비율이 이 값 아래로 내려가면 GC 가 시작돼요.',
  },
  victim: {
    term: 'Victim',
    short: 'GC 가 지우려고 고른 block 이에요. 어떤 block 을 고르느냐(GC 알고리즘)에 따라 옮겨야 하는 valid page 수, 즉 GC 비용이 달라져요.',
  },
  waf: {
    term: 'WAF (Write Amplification Factor)',
    short: '호스트가 1 page 를 쓰려고 할 때 flash 에 실제로 쓰는 page 수예요. GC 가 valid page 를 옮기느라 쓰기 때문에 1 보다 커지고, 낮을수록 좋아요.',
  },
  wl: {
    term: 'WL (Wear Leveling, 마모평준화)',
    short: 'flash block 은 지울 수 있는 횟수에 한계가 있어요. 특정 block 만 닳지 않도록 FTL 이 지우는 횟수를 고르게 나누는 일이에요.',
  },
  staticWl: {
    term: '정적 마모평준화',
    short: '한 번 쓰고 거의 안 바뀌는(cold) 데이터가 덜 닳은 block 을 차지하고 있으면, 그 데이터를 많이 닳은 block 쪽으로 옮겨서 덜 닳은 block 도 쓰이게 만드는 방식이에요.',
  },
  erase: {
    term: 'Erase',
    short: 'block 하나를 통째로 지우는 동작. program(쓰기)보다 훨씬 느리고 block 수명을 깎아요.',
  },
  suspend: {
    term: '명령 일시정지 (suspend)',
    short: '오래 걸리는 program/erase 를 잠시 멈추고 기다리던 읽기를 먼저 처리하는 기능이에요.',
  },
  mapping: {
    term: '매핑 방식',
    short: 'LPN 을 물리 위치로 바꾸는 표(매핑 테이블)를 어떤 단위로 관리하느냐예요. Page-level 은 page 하나하나를 따로 기억해요.',
  },
  trim: {
    term: 'TRIM',
    short: '파일을 지웠을 때 운영체제가 SSD 에 "이 주소의 데이터는 이제 필요 없다" 고 알려주는 명령이에요. FTL 은 그 page 를 invalid 로 표시해서 GC 가 옮길 필요가 없게 만들어요.',
  },
  dramCache: {
    term: 'DRAM 쓰기 캐시',
    short: 'SSD 안의 빠른 메모리가 쓰기를 먼저 받아두는 곳이에요. 같은 page 를 반복해서 쓰면 flash 까지 내려가는 쓰기가 줄어요.',
  },
  seed: {
    term: '시드',
    short: '무작위 값을 만드는 출발점이에요. 같은 시드면 매번 똑같은 결과가 나와서 실험을 다시 재현할 수 있어요.',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof glossary;
