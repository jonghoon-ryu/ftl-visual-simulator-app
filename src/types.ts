export type PageState = 'valid' | 'invalid' | 'free' | 'moving';

export interface PageCell {
  state: PageState;
  note?: string;
  // True for the render right after this page's data got copied to a
  // different physical page - either a host write reusing an already-
  // mapped LPA (an overwrite), or a GC/WL migration moving this page's
  // valid data elsewhere. The page is already showing 'invalid' (or
  // 'moving', for the GC/WL case) via `state`; this just outlines it so
  // the just-superseded copy is easy to spot instead of blending into
  // every other cell in that state.
  superseded?: boolean;
}

export interface BlockRow {
  label: string;
  pages: PageCell[];
  chip?: number;
  // True for the render right after this whole block's erase transaction
  // completed - outlines the row so the just-erased block is easy to spot
  // instead of blending into every other block full of plain 'free' cells.
  erasing?: boolean;
  // True for as long as this block currently has a GC/WL operation in
  // flight (mqsim's real point-in-time block status, not a one-step
  // overlay like `erasing` above - stays true across the whole migration
  // span, not just the erase instant). Rendered as "Victim" - it's the
  // block being reclaimed, not the one migrated pages land on (see
  // `gcDestination` below for that).
  isVictim?: boolean;
  // True for as long as this block is the current GC/WL migration write
  // frontier - where migrated pages are actively landing. Rendered as
  // "GC block".
  gcDestination?: boolean;
  // True for as long as this block is the current host write frontier -
  // where new user writes are actively landing.
  writeFrontier?: boolean;
}

export interface StatItem {
  label: string;
  value: string;
  hint?: string;
}

export interface LogEntry {
  // 0-based, in chronological order (the very first event logged is 0) -
  // MappingTable.tsx shows it zero-padded to 4 digits. Newest-first display
  // order means the top of the list has the highest index.
  index: number;
  time: string;
  text: string;
}

export interface WearRow {
  label: string;
  eraseCount: number;
  maxEraseCount: number;
  level: 'cool' | 'warm' | 'hot';
  // How many times this block has been static wear-leveling's target
  // during the current run (see useMqsimWlHighlight) - persistent, not a
  // one-step flash, since WL fires too rarely for a beginner to catch live.
  // A dedicated "발동 횟수" column shows this number directly (Ryu,
  // 2026-09-20: "차라리 마모 평준화 발동 열을 새로 만들어서 이 열에 마모
  // 평준화 발동 숫자를 표기") instead of the old inline "⭐ 발동!" text.
  wlTriggerCount: number;
}

// The exact condition that made static WL fire (WL_Started_Event's min/max
// erase count + threshold fields) - powers WearLevelingView's "왜
// 발동했는지 보기" button. Lives here (not in useMqsimWlHighlight, which
// produces it from live engine events) so presets.ts's mock preview data
// can also supply one, matching the wired path's shape.
export interface WlTriggerInfo {
  targetChip: number;
  targetBlock: number;
  minEraseCount: number;
  maxEraseChip: number;
  maxEraseBlock: number;
  maxEraseCount: number;
  threshold: number;
}

export interface ParamItem {
  label: string;
  value: string;
  hint: string;
  kind: 'slider' | 'select';
  percent?: number;
}

export type PresetId = 'mapping' | 'gc' | 'wear-leveling';

export interface PresetScenario {
  id: PresetId;
  label: string;
  caption: string;
  blocks?: BlockRow[];
  wearRows?: WearRow[];
  wlTrigger?: WlTriggerInfo;
  params: ParamItem[];
  stats: StatItem[];
  log: LogEntry[];
}
