import type { LogEntry } from '../types';

// describeEvent() (useMqsimEvents.ts) always puts the event keyword in the
// last ", "-separated segment (e.g. "Chip 0, Block 0, Page 9, GC" or
// "Chip 0, Block 0, Erase") - split on that rather than matching the
// substring "GC" anywhere, which would also light up inside "GC Start".
const DANGER_KEYWORDS = new Set(['GC Start', 'GC', 'Erase']);

function renderLogText(text: string) {
  const lastComma = text.lastIndexOf(', ');
  if (lastComma === -1) return text;
  const keyword = text.slice(lastComma + 2);
  if (!DANGER_KEYWORDS.has(keyword)) return text;
  return (
    <>
      {text.slice(0, lastComma + 2)}
      <span className="log-keyword-danger">{keyword}</span>
    </>
  );
}

// Renders unconditionally (even with zero entries) so the log column stays
// visible for the whole time a wired preset is selected, not just once the
// engine actually has something to show.
//
// Used to be a snapshot table (LPA/PPA/상태→동작 columns) with GC 시작/종료
// split into a separate list below it. Ryu wanted the LPA/PPA/동작 column
// framing gone and everything - mapping writes/reads and GC/WL events alike
// - merged into one chronologically-ordered line-per-entry log instead,
// which is exactly what `log` (App.tsx's `logEntries`, from useMqsimEvents)
// already is: each mapping_updated event is already rendered as one
// sentence ("LPA 0x0.. 이(가) Block.. Page.. 에 매핑됨 (쓰기/읽기)")
// interleaved newest-first with gc_started/gc_block_erased/wl_* lines.
export function MappingTable({ log }: { log: LogEntry[] }) {
  return (
    <div className="sim-panel">
      <div className="sim-panel-title">로그</div>
      {log.length === 0 && <div className="mini-table-empty">아직 기록된 로그가 없어요 - 재생 버튼을 눌러보세요</div>}
      <div className="log-list">
        {log.map((e) => (
          <div className="log-entry" key={e.index}>
            <span className="log-index">[{String(e.index).padStart(4, '0')}]</span>
            <span className="log-time">{e.time}</span>
            {renderLogText(e.text)}
          </div>
        ))}
      </div>
    </div>
  );
}
