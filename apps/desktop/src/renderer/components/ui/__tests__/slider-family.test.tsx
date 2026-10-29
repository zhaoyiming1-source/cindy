// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Slider } from '../slider';
import { MediaScrubber } from '../media-scrubber';
import { EffortSlider } from '../effort-slider';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

function pointer(target: Element | Document, type: string, x: number, id = 1, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, button });
  Object.defineProperty(event, 'pointerId', { value: id });
  fireEvent(target, event);
}

describe('Slider family behavior', () => {
  it('keeps numeric keyboard bounds, steps and commit values', () => {
    const commit = vi.fn();
    render(
      <Slider
        defaultValue={[50]}
        min={0}
        max={100}
        step={10}
        onValueCommit={commit}
        aria-label="Brightness"
      />,
    );
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(commit).toHaveBeenLastCalledWith([60]);
    fireEvent.keyDown(thumb, { key: 'End' });
    expect(commit).toHaveBeenLastCalledWith([100]);
    fireEvent.keyDown(thumb, { key: 'Home' });
    expect(commit).toHaveBeenLastCalledWith([0]);
  });
  it.each(['pointercancel', 'lostpointercapture', 'blur'])(
    'restores numeric preview without committing on %s',
    (cause) => {
      const change = vi.fn(),
        commit = vi.fn();
      render(
        <Slider
          defaultValue={[50]}
          onValueChange={change}
          onValueCommit={commit}
          aria-label="Brightness"
        />,
      );
      const root = screen.getByRole('slider').closest('.cindy-slider')!;
      root.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
      pointer(root, 'pointerdown', 80);
      expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('80');
      if (cause === 'blur') fireEvent(window, new Event('blur'));
      else pointer(root, cause, 80);
      expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('50');
      expect(root.hasAttribute('data-pressed')).toBe(false);
      expect(commit).not.toHaveBeenCalled();
    },
  );
  it('seeks in seconds and preserves a fractional end time', () => {
    const seek = vi.fn();
    render(<MediaScrubber currentTime={12} duration={37.25} onSeek={seek} label="Playback" />);
    const thumb = screen.getByRole('slider');
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(seek).toHaveBeenLastCalledWith(13);
    fireEvent.keyDown(thumb, { key: 'End' });
    expect(seek).toHaveBeenLastCalledWith(37.25);
    fireEvent.keyDown(thumb, { key: 'Home' });
    expect(seek).toHaveBeenLastCalledWith(0);
  });
  it.each([0, NaN, Infinity])('does not seek with unknown duration %s', (duration) => {
    const seek = vi.fn();
    render(<MediaScrubber currentTime={0} duration={duration} onSeek={seek} label="Playback" />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(seek).not.toHaveBeenCalled();
  });
  it('ignores right-button pointer input', () => {
    const seek = vi.fn();
    render(<MediaScrubber currentTime={0} duration={60} onSeek={seek} label="Playback" />);
    pointer(screen.getByRole('slider').closest('.cindy-slider')!, 'pointerdown', 70, 1, 2);
    expect(seek).not.toHaveBeenCalled();
  });
  it('previews effort continuously and commits only the active pointer on release', () => {
    const change = vi.fn();
    render(
      <EffortSlider
        stops={['low', 'medium', 'high']}
        value="low"
        labelOf={String}
        onChange={change}
      />,
    );
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    pointer(slider, 'pointerdown', 20);
    pointer(slider, 'pointermove', 75);
    expect(change).not.toHaveBeenCalled();
    pointer(slider, 'pointerup', 0, 2);
    expect(change).not.toHaveBeenCalled();
    pointer(slider, 'pointerup', 100);
    expect(change).toHaveBeenCalledExactlyOnceWith('high');
  });
  it('keeps track presses still until release and ignores click jitter', () => {
    const change = vi.fn();
    render(
      <EffortSlider
        stops={['low', 'medium', 'high']}
        value="low"
        labelOf={String}
        onChange={change}
      />,
    );
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    pointer(slider, 'pointerdown', 58);
    pointer(slider, 'pointermove', 59);
    expect(slider.getAttribute('aria-valuetext')).toBe('low');
    expect(slider.hasAttribute('data-dragging')).toBe(false);
    pointer(slider, 'pointerup', 59);
    expect(change).toHaveBeenCalledExactlyOnceWith('medium');
  });

  it('holds the released stop while an existing task saves asynchronously', async () => {
    let resolve!: (accepted: boolean) => void;
    const onChange = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const props = {
      stops: ['low', 'medium', 'high'] as const,
      value: 'low' as const,
      labelOf: String,
      onChange,
    };
    const { rerender } = render(<EffortSlider {...props} />);
    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    pointer(slider, 'pointerdown', 100);
    pointer(slider, 'pointerup', 100);
    expect(slider.getAttribute('aria-valuetext')).toBe('high');
    rerender(<EffortSlider {...props} />); // unrelated task update still carries old effort
    expect(slider.getAttribute('aria-valuetext')).toBe('high');
    await act(async () => {
      resolve(true);
    });
    expect(slider.getAttribute('aria-valuetext')).toBe('high'); // wait for authoritative echo
    rerender(<EffortSlider {...props} value="high" />);
    rerender(<EffortSlider {...props} value="medium" />);
    expect(slider.getAttribute('aria-valuetext')).toBe('medium');
  });

  it('keeps the latest choice through an older echo and rolls back only the latest failure', async () => {
    const settle: ((accepted: boolean) => void)[] = [];
    const props = {
      stops: ['low', 'medium', 'high'] as const,
      value: 'low' as const,
      labelOf: String,
      onChange: () =>
        new Promise<boolean>((done) => {
          settle.push(done);
        }),
    };
    const { rerender } = render(<EffortSlider {...props} />);
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    rerender(<EffortSlider {...props} value="medium" />);
    expect(slider.getAttribute('aria-valuetext')).toBe('high');
    await act(async () => {
      settle[0]!(false);
    });
    expect(slider.getAttribute('aria-valuetext')).toBe('high');
    await act(async () => {
      settle[1]!(false);
    });
    expect(slider.getAttribute('aria-valuetext')).toBe('medium');
  });

  it('discards pending feedback when switching task scope', () => {
    const props = {
      stops: ['low', 'high'] as const,
      value: 'low' as const,
      labelOf: String,
      onChange: () => new Promise<boolean>(() => {}),
    };
    const { rerender } = render(<EffortSlider {...props} scopeKey="task-a" />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('high');
    rerender(<EffortSlider {...props} scopeKey="task-b" />);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('low');
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'disable', 'stops'])(
    'cancels effort when %s occurs',
    (cause) => {
      const change = vi.fn();
      const props = {
        stops: ['low', 'high'] as const,
        value: 'low' as const,
        labelOf: String,
        onChange: change,
      };
      const { rerender } = render(<EffortSlider {...props} />);
      const slider = screen.getByRole('slider');
      slider.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
      pointer(slider, 'pointerdown', 100);
      if (cause === 'pointercancel' || cause === 'lostpointercapture') pointer(slider, cause, 100);
      if (cause === 'blur') fireEvent(window, new Event('blur'));
      if (cause === 'disable') rerender(<EffortSlider {...props} disabled />);
      if (cause === 'stops')
        rerender(<EffortSlider {...props} stops={['low', 'medium', 'high']} />);
      pointer(slider, 'pointerup', 100);
      expect(change).not.toHaveBeenCalled();
      expect(slider.hasAttribute('data-dragging')).toBe(false);
    },
  );
});
