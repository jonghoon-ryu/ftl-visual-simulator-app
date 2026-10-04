import { useState } from 'react';

interface Props {
  onClose: () => void;
}

type Cell = { state: 'free' | 'valid' | 'invalid'; label: string };

const PAGES = 8;
const emptyBlock = (): Cell[] => Array.from({ length: PAGES }, () => ({ state: 'free', label: '' }));

// Interactive "why does an FTL exist" demo: one block, two flash rules
// (no in-place overwrite, erase only a whole block), and a switch that turns
// the FTL's answer (write elsewhere + remember in a table) on and off.
export function WhyFtlIntro({ onClose }: Props) {
  const [ftl, setFtl] = useState(false);
  const [cells, setCells] = useState<Cell[]>(emptyBlock);
  const [table, setTable] = useState<Record<string, number>>({});
  const [version, setVersion] = useState<Record<string, number>>({ A: 0, B: 0 });
  const [message, setMessage] = useState('버튼을 눌러보세요. 아직 아무것도 쓰지 않았어요.');

  const reset = () => {
    setCells(emptyBlock());
    setTable({});
    setVersion({ A: 0, B: 0 });
    setMessage('처음 상태로 돌아왔어요.');
  };

  const nextFree = () => cells.findIndex((c) => c.state === 'free');

  const write = (name: 'A' | 'B') => {
    const i = nextFree();
    if (i < 0) {
      setMessage('빈 page 가 없어요. block 을 지우거나(위험!) FTL 의 청소(GC)가 필요한 상황이에요.');
      return;
    }
    const alreadyAt = table[name];
    const v = version[name] + 1;
    const label = v === 1 ? name : `${name}${"'".repeat(v - 1)}`;

    if (alreadyAt === undefined) {
      setCells(cells.map((c, k) => (k === i ? { state: 'valid', label } : c)));
      setTable({ ...table, [name]: i });
      setVersion({ ...version, [name]: v });
      setMessage(`데이터 ${name} 를 Page ${i} 에 썼어요.`);
      return;
    }

    if (!ftl) {
      setMessage(
        `❌ 안 돼요! Page ${alreadyAt} 에는 이미 데이터가 있어요. flash 는 쓴 page 를 제자리에서 덮어쓸 수 없고, 고치려면 block 전체를 지워야 해요. FTL 을 켜면 어떻게 되는지 보세요.`,
      );
      return;
    }

    setCells(
      cells.map((c, k) => (k === alreadyAt ? { ...c, state: 'invalid' } : k === i ? { state: 'valid', label } : c)),
    );
    setTable({ ...table, [name]: i });
    setVersion({ ...version, [name]: v });
    setMessage(
      `✅ FTL 이 새 데이터 ${label} 를 빈 Page ${i} 에 쓰고, ${name} 의 위치를 Page ${alreadyAt} → ${i} 로 바꿔 기억했어요. 옛 Page ${alreadyAt} 은 invalid(낡은 복사본)가 됐어요.`,
    );
  };

  const eraseBlock = () => {
    const lost = cells.filter((c) => c.state === 'valid').map((c) => c.label);
    setCells(emptyBlock());
    setTable({});
    setVersion({ A: 0, B: 0 });
    setMessage(
      lost.length > 0
        ? `⚠️ block 을 통째로 지웠어요. 아직 필요한 데이터(${lost.join(', ')})까지 같이 사라졌어요! 그래서 FTL 은 valid page 를 먼저 다른 곳에 옮긴 뒤에만 지워요 - 그게 GC 예요.`
        : '빈 block 이라 잃은 데이터는 없어요. 지우기는 block 전체를 한 번에 하는 동작이에요.',
    );
  };

  return (
    <div className="usage-guide-backdrop" onClick={onClose}>
      <div className="usage-guide-panel" onClick={(e) => e.stopPropagation()}>
        <div className="usage-guide-header">
          <h2>왜 FTL 이 필요할까?</h2>
          <button type="button" className="usage-guide-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="usage-guide-body">
          <section>
            <p>
              SSD 의 저장 칩(NAND flash)에는 두 가지 규칙이 있어요. <strong>① 이미 쓴 page 는 제자리에서 덮어쓸 수 없다.</strong>{' '}
              <strong>② 지우기는 page 가 아니라 block(page 여러 개 묶음) 전체 단위로만 된다.</strong> 그런데 컴퓨터는 "같은
              번호에 다시 쓰기" 를 아무렇지 않게 해요. 이 둘 사이를 이어주는 것이 FTL 이에요.
            </p>
          </section>

          <section>
            <h3>직접 해보기</h3>
            <p>
              같은 데이터 A 를 두 번 써보세요. FTL 이 꺼진 상태와 켜진 상태에서 무슨 일이 일어나는지 비교해보세요.
            </p>
            <label className="why-ftl-toggle">
              <input type="checkbox" checked={ftl} onChange={(e) => setFtl(e.target.checked)} /> FTL 켜기
            </label>
            <div className="why-ftl-block" aria-label="flash block 하나">
              {cells.map((c, i) => (
                <div key={i} className={`why-ftl-cell ${c.state}`}>
                  <span className="why-ftl-idx">P{i}</span>
                  <span>{c.label || '·'}</span>
                </div>
              ))}
            </div>
            <div className="why-ftl-actions">
              <button type="button" onClick={() => write('A')}>
                데이터 A 쓰기
              </button>
              <button type="button" onClick={() => write('B')}>
                데이터 B 쓰기
              </button>
              <button type="button" onClick={eraseBlock}>
                Block 지우기
              </button>
              <button type="button" onClick={reset}>
                처음으로
              </button>
            </div>
            <div className="why-ftl-message" role="status">
              {message}
            </div>
            {ftl && (
              <div className="why-ftl-table">
                <strong>FTL 의 매핑 테이블</strong>
                {Object.keys(table).length === 0 ? (
                  <span> — 비어 있어요</span>
                ) : (
                  Object.entries(table).map(([name, page]) => (
                    <span key={name} className="why-ftl-entry">
                      {name} → Page {page}
                    </span>
                  ))
                )}
              </div>
            )}
          </section>

          <section>
            <h3>그래서 FTL 이 하는 일</h3>
            <ul>
              <li>
                <strong>매핑</strong> — 덮어쓰기는 항상 새 빈 page 에 쓰고, "이 번호의 최신 데이터는 어디" 를 표로 기억해요.
              </li>
              <li>
                <strong>GC (청소)</strong> — 낡은(invalid) page 만 쌓이면 빈 공간이 없어져요. 그래서 valid page 를 옮기고 block
                을 지워서 공간을 되찾아요.
              </li>
              <li>
                <strong>마모평준화</strong> — block 은 지울 수 있는 횟수에 한계가 있어서, 특정 block 만 닳지 않도록 골고루
                쓰게 해요.
              </li>
            </ul>
            <p>이 세 가지를 위의 세 레슨에서 차례로 직접 보게 됩니다.</p>
          </section>

          <section>
            <button type="button" className="why-ftl-start" onClick={onClose}>
              레슨 1 시작하기
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
