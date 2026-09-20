import type { PresetId, PresetScenario } from '../types';

export interface PlaybackState {
  isPlaying: boolean;
  speed: number; // event-groups executed per playback tick, 1-8
  hasMore: boolean; // false once the workload's event queue is empty
  disabled: boolean; // true while the engine for the active preset isn't wired/ready yet
  onStepEventOnce: () => void;
  onStepEventMany: () => void;
  onTogglePlay: () => void;
  onRestart: () => void;
  onSpeedChange: (speed: number) => void;
}

interface Props {
  presets: PresetScenario[];
  activeId: PresetId;
  onSelect: (id: PresetId) => void;
  playback: PlaybackState;
}

export function Toolbar({ presets, activeId, onSelect, playback }: Props) {
  const {
    isPlaying,
    speed,
    hasMore,
    disabled,
    onStepEventOnce,
    onStepEventMany,
    onTogglePlay,
    onRestart,
    onSpeedChange,
  } = playback;

  return (
    <div className="sim-toolbar">
      <div className="sim-presets">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={p.id === activeId ? 'active' : ''}
            onClick={() => onSelect(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <h1 className="sim-toolbar-title">FTL Visual Simulator</h1>
      <div
        className="sim-playback"
        title={disabled ? '이 프리셋은 아직 실제 엔진에 연결되지 않았어요' : !hasMore ? '워크로드 이벤트가 모두 처리됐어요' : undefined}
      >
        <button type="button" aria-label="처음부터 다시 시작" disabled={disabled} onClick={onRestart}>
          ⏮
        </button>
        <button
          type="button"
          aria-label={isPlaying ? '일시정지' : '재생'}
          disabled={disabled || !hasMore}
          onClick={onTogglePlay}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <span>속도</span>
        <input
          className="sim-speed-slider"
          type="range"
          aria-label="재생 속도"
          min={1}
          max={8}
          step={1}
          value={speed}
          disabled={disabled}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
        />
        <span>{speed}×</span>
        <div className="sim-step-buttons">
          <button
            type="button"
            aria-label="로그 한 줄씩 실행 (→ 키로도 가능)"
            title="write/read 한 번, GC/WL 의 시작·페이지 이동·소거 완료 중 하나 - 로그에 한 줄이 새로 생길 때까지만 실행해요. → 키를 눌러도 똑같이 동작해요"
            disabled={disabled || !hasMore || isPlaying}
            onClick={onStepEventOnce}
          >
            1 step
          </button>
          <button
            type="button"
            aria-label="로그 다섯 줄 실행"
            title="1 step 을 다섯 번 실행해요"
            disabled={disabled || !hasMore || isPlaying}
            onClick={onStepEventMany}
          >
            5 steps
          </button>
        </div>
      </div>
    </div>
  );
}
