import type { LogEntry, MappingRow } from '../types';

interface Props {
  rows: MappingRow[];
  gcLog: LogEntry[];
}

// Renders unconditionally (even with zero rows) so the mapping column
// stays visible for the whole time a wired preset is selected, not just
// once the engine actually has something to show - App.tsx decides
// whether this preset gets a mapping column at all (마모평준화 시연 never
// does), this component just handles "no writes yet" within that column.
//
// `gcLog` is App.tsx's `logEntries` pre-filtered down to just GC 시작/소거
// completion lines - the standalone "이벤트 로그" panel (every event type,
// full width) was removed in favor of this narrower GC-only log living
// right under the mapping table it renders next to.
export function MappingTable({ rows, gcLog }: Props) {
  return (
    <div className="sim-panel">
      <div className="sim-panel-title">로그</div>
      <table className="mini-table">
        <tbody>
          <tr>
            <th>LPA</th>
            <th>PPA</th>
            <th>동작</th>
          </tr>
          {rows.map((r) => (
            <tr key={r.lpa}>
              <td>{r.lpa}</td>
              <td>{r.ppa}</td>
              <td style={r.op === 'read' ? { color: '#4dabf7' } : undefined}>{r.op === 'write' ? '쓰기' : '읽기'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="mini-table-empty">아직 매핑된 데이터가 없어요 - 재생 버튼을 눌러보세요</div>}
      {gcLog.length > 0 && (
        <div className="mapping-gc-log">
          {gcLog.map((e, i) => (
            <div className="log-entry" key={i}>
              <span className="log-time">{e.time}</span>
              {e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
