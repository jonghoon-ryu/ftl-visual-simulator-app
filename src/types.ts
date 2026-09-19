export type PageState = 'valid' | 'invalid' | 'free' | 'moving';

export interface PageCell {
  state: PageState;
  note?: string;
}

export interface BlockRow {
  label: string;
  pages: PageCell[];
  chip?: number;
}

export interface MappingRow {
  lpa: string;
  ppa: string;
  op: 'read' | 'write';
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
  mapping: MappingRow[];
  params: ParamItem[];
  stats: StatItem[];
  log: LogEntry[];
}
