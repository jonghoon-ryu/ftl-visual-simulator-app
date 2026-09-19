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
}

export interface StatItem {
  label: string;
  value: string;
  hint?: string;
}

export interface LogEntry {
  time: string;
  text: string;
}

export interface WearRow {
  label: string;
  eraseCount: number;
  maxEraseCount: number;
  level: 'cool' | 'warm' | 'hot';
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
  params: ParamItem[];
  stats: StatItem[];
  log: LogEntry[];
}
