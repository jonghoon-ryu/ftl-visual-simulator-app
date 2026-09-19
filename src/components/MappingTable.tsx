import type { MappingRow } from '../types';

// Renders unconditionally (even with zero rows) so the mapping column
// stays visible for the whole time a wired preset is selected, not just
// once the engine actually has something to show - App.tsx decides
// whether this preset gets a mapping column at all (마모평준화 시연 never
// does), this component just handles "no writes yet" within that column.
export function MappingTable({ rows }: { rows: MappingRow[] }) {
  return (
    <div className="sim-panel">
      <div className="sim-panel-title">매핑 테이블 ( 일부 )</div>
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
    </div>
  );
}
