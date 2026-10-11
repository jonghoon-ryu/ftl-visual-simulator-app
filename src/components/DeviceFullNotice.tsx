// Shown once a run has ended with host writes still parked for free space.
// Explains it per chip from the engine's own numbers, because "the device is
// full" next to a grid with empty rows reads as a contradiction (Ryu,
// 2026-10-11): the empty rows are the mapping block, the write frontiers and
// the GC reserve, none of which may hold host data, and each LPN can only
// ever be written to its own chip (LPN mod chip count - CWDP allocation).
export function DeviceFullNotice({ state, chipCount }: { state: MqsimState; chipCount: number }) {
  const { writesWaitingPerPlane, freeBlocksPerPlane, writeFloorBlocks } = state.stats;
  const stuckChips = writesWaitingPerPlane.map((n, chip) => ({ chip, n })).filter((c) => c.n > 0);
  const invalidOn = (chip: number) =>
    state.blocks.filter((b) => b.chip === chip).reduce((sum, b) => sum + b.pages.filter((p) => p === 'invalid').length, 0);

  return (
    <div className="device-full-status">
      <strong>장치가 가득 찼어요{stuckChips.length > 0 ? ` - ${stuckChips.map((c) => `Chip ${c.chip}`).join(', ')}` : ''}</strong>
      {stuckChips.map(({ chip, n }) => {
        const invalid = invalidOn(chip);
        return (
          <p key={chip}>
            Chip {chip} 에 쓸 호스트 쓰기 {n}개가 끝내 기다리다 멈췄어요. Chip {chip} 의 빈 block 이{' '}
            {freeBlocksPerPlane[chip]}개로, GC 가 쓸 예비분({writeFloorBlocks}개)보다 적어지면 MQSim 은 그 칩의 호스트 쓰기를
            멈춰요.{' '}
            {invalid === 0
              ? `그런데 Chip ${chip} 에는 GC 가 치울 invalid page 가 하나도 없어서(남은 데이터가 전부 valid) 빈 block 을 다시 늘릴 수 없어요.`
              : `Chip ${chip} 에 invalid page 가 ${invalid}개 있지만, 그것만으로는 GC 가 빈 block 을 예비분 이상으로 되돌리지 못했어요.`}
          </p>
        );
      })}
      <p>
        격자에 보이는 빈 block 은 <b>GC 예비</b>·<b>매핑용</b>·쓰기 위치(active block, GC block)라 호스트 데이터를 받을 수
        없어요.
        {chipCount > 1 &&
          ` 그리고 각 LPN 은 번호로 정해진 칩에만 쓰여서(LPN 을 칩 개수 ${chipCount} 로 나눈 나머지가 칩 번호), 다른 칩에 빈 block 이 있어도 옮겨 쓸 수 없어요.`}{' '}
        Workload 의 작업 범위를 줄이거나, Over-provisioning · Block 개수 · Block 당 Page 개수를 늘려보세요.
      </p>
    </div>
  );
}
