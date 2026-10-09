interface Props {
  onClose: () => void;
}

// A single, comprehensive in-app reference - consolidates every "이게 왜
//이래요?" question Ryu asked while testing this app in one place (Page
// 크기/접근 패턴이 화면에서 안 보이는 이유, GC 임계값의 정확한 뜻, 프리셋이
//왜 따로 있는지, 마모평준화 발동을 어떻게 확인하는지, 등), rather than
// leaving that knowledge scattered across chat history a future user of the
// app would never see. Plain content component - App.tsx owns the open/
// close state and the floating "사용법" button that triggers it.
export function UsageGuide({ onClose }: Props) {
  return (
    <div className="usage-guide-backdrop" onClick={onClose}>
      <div className="usage-guide-panel" onClick={(e) => e.stopPropagation()}>
        <div className="usage-guide-header">
          <h2>사용법</h2>
          <button type="button" className="usage-guide-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="usage-guide-body">
          <section>
            <h3>이 시뮬레이터는 무엇인가요?</h3>
            <p>
              FTL(Flash Translation Layer, 플래시 변환 계층)이 SSD 안에서 실제로 무엇을 하는지 눈으로 보여주는
              시뮬레이터입니다. FTL 을 흉내낸 코드가 아니라, 실제 학술용 SSD 시뮬레이터인{' '}
              <strong>MQSim</strong>의 C++ 엔진을 그대로 WASM 으로 컴파일해서 브라우저에서 돌리고 있습니다 - 그래서
              여기서 보는 동작(GC 발동 시점, 마모평준화 등)은 실제 SSD 펌웨어와 같은 로직으로 계산된 결과입니다.
            </p>
          </section>

          <section>
            <h3>세 가지 프리셋 - 왜 따로 있나요?</h3>
            <p>
              위쪽 탭 세 개(매핑 기본 / GC 시연 / 마모평준화 시연)는 각각 다른 개념 하나씩만 깨끗하게 보여주도록
              일부러 완전히 다르게 튜닝돼 있습니다. 하나로 합치면 한쪽 개념을 보여주는 설정이 다른 쪽 개념을
              가려버리기 때문입니다.
            </p>
            <table className="usage-guide-table">
              <thead>
                <tr>
                  <th></th>
                  <th>매핑 기본</th>
                  <th>GC 시연</th>
                  <th>마모평준화 시연</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>보여주려는 것</td>
                  <td>write 가 매핑 테이블을 채우는 모습</td>
                  <td>GC 가 실제로 발동해서 페이지를 옮기는 모습</td>
                  <td>마모평준화가 닳지 않은 block 을 순환시키는 모습</td>
                </tr>
                <tr>
                  <td>GC 임계값</td>
                  <td>5% (GC 가 거의 안 켜지게)</td>
                  <td>50% (GC 가 일찍 켜지게)</td>
                  <td>50%</td>
                </tr>
                <tr>
                  <td>같은 주소를 얼마나 반복해서 쓰나</td>
                  <td>거의 안 함 (device 전체에 골고루)</td>
                  <td>자주 함 (좁은 25% 영역만) - 그래야 지워질 데이터가 생김</td>
                  <td>자주 함</td>
                </tr>
              </tbody>
            </table>
            <p>
              매핑 기본과 GC 시연은 같은 설정(위 표에서 다른 항목 - GC 임계값, working set 비율 등)을 공유하면 한쪽이
              항상 망가집니다: GC 시연 설정을 매핑 기본에 쓰면 좁은 영역만 계속 덮어써서 매핑이 다양하게 채워지는
              모습을 못 보고, 반대로 매핑 기본 설정을 GC 시연에 쓰면 GC 가 사실상 영원히 안 켜집니다.
            </p>
          </section>

          <section>
            <h3>화면 구성</h3>
            <ul>
              <li>
                <strong>맨 위 "레슨 바"</strong> - 지금 프리셋에서 무엇을 보면 되는지 한두 문장으로 알려주고, ◂ 이전 / 다음
                ▸ 으로 매핑 → GC → 마모평준화 순서로 넘어갑니다.
              </li>
              <li>
                <strong>왼쪽: FLASH ARRAY</strong> (마모평준화 시연은 block 별 erase count) - 위에 "예측해보기" 퀴즈가
                있습니다.
              </li>
              <li>
                <strong>가운데: 로그</strong> - 일어난 사건이 시간 순서로 쌓입니다. 줄을 클릭하면 그 데이터를 따라갑니다.
              </li>
              <li>
                <strong>오른쪽: 두 개의 탭</strong>
                <ul>
                  <li>
                    <strong>설정 · 통계</strong>(기본) - 파라미터, workload, 통계. 자주 안 쓰는 설정은 "고급 설정" 안에
                    접혀 있습니다.
                  </li>
                  <li>
                    <strong>비교 실험실</strong> - <em>GC 시연에서만</em> 나타납니다(다른 프리셋에는 탭 자체가 없습니다).
                    같은 설정으로 시뮬레이션을 끝까지 다시 돌려 비교하는 실험들이 모여 있습니다. 아래 "비교 실험실"
                    참고.
                  </li>
                </ul>
              </li>
            </ul>
          </section>

          <section>
            <h3>처음이라면</h3>
            <ul>
              <li>
                처음 열면 <strong>"왜 FTL 이 필요할까?"</strong> 인트로가 나옵니다. 같은 데이터를 두 번 써 보면서 flash
                가 덮어쓰기를 못 한다는 것과, FTL 을 켜면 어떻게 해결되는지를 직접 눌러 볼 수 있습니다. 레슨 바의 "처음이라면"
                링크로 언제든 다시 열 수 있습니다.
              </li>
              <li>
                그다음 <strong>레슨 1 → 2 → 3</strong> (매핑 → GC → 마모평준화) 순서로 보면 됩니다.
              </li>
              <li>
                <strong>점선 밑줄이 있는 용어</strong>(WAF, Over-provisioning, GC 임계값 …)에 마우스를 올리거나 Tab 으로
                포커스하면 쉬운 말 설명이 나옵니다.
              </li>
            </ul>
          </section>

          <section>
            <h3>재생 컨트롤</h3>
            <ul>
              <li>
                <strong>⏮</strong> - 현재 프리셋을 처음부터 다시 시작합니다. 파라미터를 바꾼 뒤에도 자동으로
                호출됩니다.
              </li>
              <li>
                <strong>▶ / ⏸</strong> - 재생/일시정지. 재생 중에는 "속도" 배수만큼 매 0.3초마다 한 번에 여러
                이벤트를 처리합니다. 워크로드의 이벤트가 모두 끝나면(더 이상 진행할 게 없으면) 자동으로
                일시정지됩니다.
              </li>
              <li>
                <strong>속도 (1×~8×)</strong> - 한 번에 몇 개의 이벤트를 처리할지 정합니다. GC 시연/마모평준화 시연은
                실제로 GC/WL 이 발동하기까지 수백만 개의 이벤트가 필요해서, 기본값이 최고 속도(8×)로 맞춰져
                있습니다.
              </li>
              <li>
                <strong>로그 1줄</strong> - 로그에 새 줄이 정확히 하나 생길 때까지만 진행합니다 (→ 키로도 가능). Write
                하나, Read 하나, GC/WL 의 시작·페이지 이동·소거 중 하나 - 딱 하나의 사건만 보고 싶을 때 씁니다.
              </li>
              <li>
                <strong>로그 5줄</strong> - 로그 1줄 을 다섯 번 반복합니다.
              </li>
            </ul>
          </section>

          <section>
            <h3>FLASH ARRAY 화면 (매핑 기본 / GC 시연)</h3>
            <p>
              칩(Chip)과 block, page 번호별로 칸이 나열됩니다. 각 칸의 색이 그 페이지의 상태를 나타냅니다:
            </p>
            <ul>
              <li><span className="swatch valid" /> <strong>valid (초록, V)</strong> - 유효한 데이터가 있는 페이지</li>
              <li><span className="swatch invalid" /> <strong>invalid (빨강, X)</strong> - 지워질 예정인, 이미 다른 곳으로 옮겨졌거나 덮어써진 페이지</li>
              <li><span className="swatch moving" /> <strong>GC 로 이동 중 (노랑, →)</strong> - GC/WL 이 지금 이 페이지를 다른 곳으로 옮기고 있음 (한 스텝 동안만 표시)</li>
              <li><span className="swatch free" /> <strong>free (회색)</strong> - 아직 아무것도 쓰이지 않은 빈 페이지. 칩마다 살짝 다른 회색으로 표시돼서 어느 칩인지 구분됩니다.</li>
            </ul>
            <p>
              block 행 오른쪽에 붙는 라벨도 있습니다: <strong>active block</strong>(지금 host write 가 채워지고 있는
              block), <strong>GC block</strong>(다음 GC/WL 이동이 도착할 block - GC 가 아직 한 번도 안 켜졌어도
              항상 표시됩니다, MQSim 이 미리 예약해두기 때문), <strong>Victim</strong>(방금 GC 대상으로 선택된
              block).
            </p>
          </section>

          <section>
            <h3>BLOCK 별 ERASE COUNT 화면 (마모평준화 시연 전용)</h3>
            <p>
              block 마다 지금까지 몇 번 지워졌는지(erase count)를 막대그래프로 보여줍니다. 많이 닳은 block 은
              🔥, 거의 안 닳은 block 은 ❄️ 로 표시됩니다. 마모평준화(static WL)가 실제로 발동하면 그 block 행에{' '}
              <strong>⭐ 마모평준화 발동!</strong> 표시가 계속 남습니다 - 이 실행 전체에서 딱 1~2 번만 일어나는
              드문 사건이라, 재생 중 실시간으로 포착하기 어렵기 때문에 사라지지 않는 표시로 만들어뒀습니다.
            </p>
          </section>

          <section>
            <h3>로그 패널</h3>
            <p>일어난 사건을 시간 순서대로 보여줍니다. 대표적인 줄 형태:</p>
            <ul>
              <li><code>LPN 0x0xx → Chip N, Block N, Page N, Write</code> - 호스트가 이 논리 주소(LPN)에 새로 씀</li>
              <li><code>LPN 0x0xx: 이전 위치 → 새 위치, Write</code> - 이미 매핑돼 있던 LPN 을 덮어씀 (이전 페이지는 invalid 가 됨)</li>
              <li><code>Chip N, Block N, GC Start</code> / <code>WL Start</code> - GC/WL 이 이 block 을 대상으로 선택함</li>
              <li><code>원래 위치 → 새 위치, GC</code> / <code>WL</code> - 유효한 페이지 하나를 옮기는 중</li>
              <li><code>Chip N, Block N, Erase</code> - 옮기기가 끝나서 block 을 지움</li>
              <li><code>LPN 0x0xx: Chip N, Block N, Page N, TRIM</code> - 호스트가 이 LPN 을 지웠다고 알려서 그 page 가 invalid 가 됨</li>
            </ul>
          </section>

          <section>
            <h3>통계 패널</h3>
            <ul>
              <li><strong>WAF</strong> (Write Amplification Factor) - 호스트가 1번 쓰기를 요청할 때 실제로 flash 에는 몇 번 write 가 일어났는지. GC/WL 로 인한 페이지 이동도 전부 write 이므로, WAF 가 높을수록 GC/WL 이 활발하다는 뜻입니다.</li>
              <li><strong>호스트 요청 → flash 쓰기</strong> - 호스트가 보낸 쓰기 요청 수와 실제로 flash 에 쓴 page 수. 차이는 DRAM 쓰기 캐시가 흡수하거나 합친 것입니다.</li>
              <li><strong>Valid page 비율</strong> - 전체 페이지 중 지금 유효한 데이터를 담고 있는 비율.</li>
              <li><strong>GC/WL 실행 횟수</strong> - 지금까지 GC/마모평준화가 발동한 총 횟수.</li>
              <li><strong>Erase 횟수</strong> - 지금까지 지워진 block 의 총 개수.</li>
            </ul>
          </section>

          <section>
            <h3>비교 실험실 (GC 시연)</h3>
            <p>
              각 버튼은 <em>화면의 재생과는 별개로</em> 같은 설정으로 시뮬레이션을 끝까지 다시 돌려 결과를 표로
              보여줍니다. 설정을 바꾸면 이전 결과는 지워집니다.
            </p>
            <ul>
              <li><strong>GC 알고리즘 비교</strong> - victim 을 고르는 7가지 방법의 GC 횟수·옮긴 page 수·WAF.</li>
              <li>
                <strong>TRIM</strong> - 호스트가 "이 데이터는 이제 필요 없다" 고 알리는 명령입니다. <em>지금 TRIM 하기</em>는
                재생을 멈춘 상태에서 LPN 의 10/30/60% 를 TRIM 해서 격자의 초록(valid)이 빨강(invalid)으로 바뀌는 걸
                보여주고, <em>TRIM 효과 비교하기</em>는 TRIM 하는 호스트와 안 하는 호스트의 WAF 를 비교합니다 (TRIM 하면
                GC 가 옮길 page 가 줄어듭니다).
              </li>
              <li>
                <strong>핫/콜드 분리</strong> - 자주 바뀌는 데이터(hot)와 거의 안 바뀌는 데이터(cold)를 한 줄로 섞어 쓸
                때와 따로 모아 쓸 때를 비교합니다. block 별 내용물 그림에서 섞어 쓰면 한 block 에 둘이 같이 들어가는 것이
                보입니다. 이 실험은 자체 작은 SSD 에서 돌아가서 위쪽 파라미터와 무관합니다.
              </li>
              <li><strong>순차 vs 무작위 쓰기</strong> - 쓰기 패턴이 GC 비용에 미치는 영향.</li>
              <li><strong>Over-provisioning 별 WAF</strong> - OP 0~30% 곡선.</li>
              <li>
                <strong>맨 아래의 두 차트</strong>는 재생을 따라갑니다: <em>빈 block 수 변화</em>(빈 block 이 임계값 아래로
                내려가면 GC ● 가 시작되는 톱니 모양)와 <em>읽기 지연</em>(읽기 비율을 올리면 GC 가 도는 동안 읽기가 얼마나
                느려지는지).
              </li>
            </ul>
          </section>

          <section>
            <h3>배우기 도구들</h3>
            <ul>
              <li>
                <strong>예측해보기</strong> - 각 프리셋 위의 퀴즈. 답을 고르면 이유와 "화면 어디서 확인하나" 를 알려줍니다.
              </li>
              <li>
                <strong>한 쓰기 따라가기</strong> - 로그의 LPN 을 클릭하면 그 데이터가 거친 물리 page 의 여정(처음 쓰기 →
                덮어쓰기 → GC 이동 → TRIM …)이 목록과 격자(굵은 테두리 = 지금 위치, 점선 = 예전 복사본)로 표시됩니다.
              </li>
              <li>
                <strong>왜 이 block 을 골랐나요?</strong> (GC 시연) - 가장 최근 GC 의 victim block 이 가진 valid/invalid
                page 수와, 선택한 GC 알고리즘이 그 block 을 고른 규칙.
              </li>
            </ul>
          </section>

          <section>
            <h3>파라미터 하나씩</h3>
            <p>
              Page 크기 · 명령 일시정지 · 매핑 방식 · 시드는 <strong>"고급 설정"</strong> 안에 접혀 있습니다 (처음엔 건드리지
              않아도 됩니다).
            </p>
            <ul>
              <li>
                <strong>Page 크기</strong> (고급 설정) - 바꿔도 <em>화면상 차이가 없습니다.</em> Read/Program 지연시간이
                페이지 크기와 무관하게 고정값으로 처리되고, Flash Array 는 페이지 개수만 그리기 때문입니다.
                (매핑 기본에서만 슬라이더 옆에 이 안내가 표시됩니다.)
              </li>
              <li>
                <strong>칩(Chip) 개수</strong> - Flash Array 에 칩 배지가 몇 개 나열되는지. 칩이 늘어나면 워크로드가
                칩들에 번갈아 분산됩니다.
              </li>
              <li>
                <strong>Block 개수 / Block 당 Page 개수</strong> - Flash Array 화면의 행/열 개수를 그대로 결정합니다.
                (Page 크기와 헷갈리기 쉬운데, 이건 순수하게 <em>개수</em>이지 바이트 크기가 아닙니다.)
              </li>
              <li>
                <strong>Over-provisioning</strong> - 전체 물리 용량 중 호스트에게는 안 보이게 떼어놓는 여유 공간의
                비율. 이 여유분이 클수록 GC 가 덜 자주, 덜 급하게 발동합니다 (WAF 가 낮아짐).
              </li>
              <li>
                <strong>GC 임계값</strong> - "빈 block 비율이 이 아래로 떨어지면 GC 시작"이라는 뜻입니다. 직관과
                반대로, <em>높을수록</em> 빈 block 이 아직 많이 남아있어도 GC 가 일찍 발동합니다 (매핑 기본은 GC 가
                거의 안 켜지도록 낮게, GC 시연/마모평준화 시연은 자주 켜지도록 높게 설정돼 있습니다). 매핑 기본에서는
                범위가 1~10%로 좁혀져 있는데, 이 프리셋에서는 GC 가 초점이 아니라는 뜻입니다.
              </li>
              <li>
                <strong>마모평준화 임계값</strong> (마모평준화 시연에서만) - 가장 많이 닳은 block 과 가장 적게 닳은
                block 의 erase 횟수 차이가 이 값 이상이 되면 정적 마모평준화가 발동해, 가장 적게 닳은 block 의
                (한 번 쓰고 안 건드리는) cold 데이터를 다른 곳으로 옮깁니다. 기본값 3 에서 7번 발동하고, 1 로 낮추면
                차이가 조금만 벌어져도 발동해 수백 번 헛돌며, 5 이상이면 이 데모의 실행 길이 안에서는 차이가 거기까지
                벌어지지 않아 발동하지 않습니다.
              </li>
              <li>
                <strong>GC 알고리즘</strong> - 지워질 block(victim)을 어떻게 고를지 정하는 방식입니다. RGA(기본)와
                Greedy 는 무효 페이지가 많은 block 을 고르고, Random 계열은 무작위로, FIFO 는 오래된 block 부터
                고릅니다. 어느 쪽이 실제로 덜 옮기는지는 설정마다 달라서, GC 시연의 <strong>비교 실험실</strong> 탭에 있는 <em>GC 알고리즘 비교</em> 버튼으로
                같은 설정에서 7개를 끝까지 돌려 비교해볼 수 있습니다 - 이 데모처럼 block 이 적으면 교과서와 다른 결과(예:
                Random 이 오히려 적게 옮김)가 나오기도 해요.
              </li>
              <li>
                <strong>매핑 방식</strong> (고급 설정) - Page-level 만 실제로 동작합니다. Hybrid 는 MQSim 원본 자체에도 구현이
                없어서 선택은 보이지만 비활성화돼 있습니다.
              </li>
              <li>
                <strong>엔진 시드 / 워크로드 시드</strong> (고급 설정) - 각각 GC 알고리즘 내부의 무작위성(예: 후보 block 추첨)과,
                어떤 주소를 읽고 쓸지 정하는 워크로드 생성기의 무작위성을 결정합니다. 같은 시드면 항상 똑같은 결과가
                나옵니다 (재현 가능).
              </li>
              <li>
                <strong>접근 패턴 (Random / Sequential)</strong> - Random 은 매번 완전히 무작위 주소를, Sequential
                은 무작위로 정해진 시작 주소에서부터 1씩 증가하는 주소를 씁니다. <em>단, 이 차이는 로그의 LPN 숫자에서만
                보입니다</em> - Flash Array 화면에 실제로 채워지는 칸의 순서는 항상 똑같습니다 (물리적인 페이지 배치는
                논리 주소 순서와 무관하게, 그냥 빈 칸을 순서대로 채우기 때문입니다).
              </li>
              <li>
                <strong>읽기 비율</strong> (0~50%) - 호스트 요청 중 읽기의 비율. 한 번도 안 쓴 LPN 을 읽으면 flash 를 거치지
                않고 바로 끝납니다(실제 SSD 가 0 을 돌려주듯). GC 시연에서 올리면 비교 실험실 맨 아래 "읽기 지연" 차트로
                GC 가 읽기를 느리게 만드는 것을 볼 수 있습니다.
              </li>
              <li>
                <strong>DRAM 쓰기 캐시</strong> - 켜면 SSD 안의 DRAM 이 쓰기를 먼저 받아 같은 page 에 대한 반복 쓰기를
                흡수하고, 꺼지면 거의 모든 요청이 flash 쓰기가 되어 GC 가 훨씬 자주 일어납니다. 통계의 "호스트 요청 → flash
                쓰기" 로 확인해 보세요.
              </li>
              <li>
                <strong>명령 일시정지 (suspend)</strong> (고급 설정) - program/erase 는 읽기보다 훨씬 오래 걸립니다. 켜면
                칩이 그 작업을 잠깐 멈추고 기다리던 읽기를 먼저 처리해서, GC 가 도는 동안 가장 느린 읽기가 줄어듭니다.
              </li>
            </ul>
          </section>

          <section>
            <h3>자주 헷갈리는 점</h3>
            <ul>
              <li>
                <strong>파라미터를 바꿨는데 화면에 아무 변화가 없어요.</strong> Page 크기와 접근 패턴이 대표적인
                경우입니다 - 둘 다 실제로는 엔진에 정상적으로 전달되지만, 그 효과가 이 앱이 보여주는 화면(칸 색깔,
                칸 배치)에는 반영되지 않는 부분에서만 나타납니다. 위 "파라미터 하나씩"에서 각각의 정확한 위치를
                확인하세요.
              </li>
              <li>
                <strong>비교 실험실 탭이 안 보여요.</strong> 정상입니다 - GC 시연에서만 나타납니다. 위쪽 탭에서 GC 시연을
                선택하세요.
              </li>
              <li>
                <strong>GC block 라벨이 아직 GC 가 한 번도 안 켜졌는데 보여요.</strong> 정상입니다 - MQSim 은
                시뮬레이션 시작부터 각 칩마다 "다음 GC 이동이 도착할 block"을 미리 예약해두기 때문에, 실제 GC
                발동 여부와 상관없이 항상 어딘가에 GC block 라벨이 붙어 있습니다.
              </li>
              <li>
                <strong>마모평준화 시연을 재생해도 아무 일도 안 일어나는 것 같아요.</strong> 정상입니다 - WL 은
                이 규모에서 실행 전체에 딱 1번 정도만 발동하도록 설계돼 있고, 발동 전까지는 화면 상단에 "아직
                마모평준화가 발동하지 않았어요" 안내가 표시됩니다. 발동하면 배너와 해당 block 행에 ⭐ 표시가
                남습니다.
              </li>
            </ul>
          </section>

          <section>
            <h3>출처와 라이선스</h3>
            <p>
              이 앱의 시뮬레이션 엔진은 ETH Zürich SAFARI Research Group 의{' '}
              <a href="https://github.com/CMU-SAFARI/MQSim" target="_blank" rel="noopener noreferrer">MQSim</a>{' '}
              C++ 소스를 수정해 WebAssembly 로 컴파일한 것입니다. MQSim 은 MIT 라이선스로 배포됩니다.
            </p>
            <p>
              Copyright (c) 2018, SAFARI Research Group at ETH Zurich University ·{' '}
              <a href={`${import.meta.env.BASE_URL}licenses/MQSim-LICENSE.txt`} target="_blank" rel="noopener noreferrer">
                라이선스 전문 (MIT)
              </a>
            </p>
            <p>
              원본에서 바뀐 부분(라이브러리화, 시각화용 이벤트 훅, 버그 수정)은 저장소의{' '}
              <code>engine/mqsim/NOTICE.md</code> 와 소스 안의 주석에 정리되어 있습니다.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
