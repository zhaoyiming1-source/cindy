import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import './slider.css';
import { cn } from '@/lib/utils';
import type { Effort } from '@/lib/userPreferences.types';
import { effortTierColor, effortTierColorAt } from '@/themes/effortTierColors';

type Gesture = {
  id: number;
  phase: 'pressed' | 'dragging';
  startX: number;
  scope: string;
  left: number;
  width: number;
  offset: number;
  position: number;
  frame: number | null;
  target: HTMLDivElement;
};

/** One continuous visual position while captured; snap and commit once on release. */
export function EffortSlider({
  stops,
  value,
  recommended,
  labelOf,
  onChange,
  disabled = false,
  scopeKey,
}: {
  stops: readonly Effort[];
  value: Effort | null;
  recommended?: Effort | null;
  labelOf: (effort: Effort) => string;
  onChange: (effort: Effort) => void | boolean | Promise<void | boolean>;
  scopeKey?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const revisionRef = useRef(0);
  const [pending, setPending] = useState<{ effort: Effort; scope: string } | null>(null);
  const [preview, setPreview] = useState<{ index: number; scope: string } | null>(null);
  const selectionScope = `${scopeKey ?? ''}:${stops.join(',')}`;
  const lastIndex = Math.max(0, stops.length - 1);
  const pendingCurrent = pending?.scope === selectionScope && pending.effort !== value;
  const displayValue = pendingCurrent ? pending.effort : value;
  const valueIndex = Math.max(0, displayValue ? stops.indexOf(displayValue) : -1);
  const activeIndex = preview?.scope === selectionScope ? preview.index : valueIndex;
  const activeStop = stops[activeIndex] ?? stops[0];
  const dragging = preview?.scope === selectionScope;

  useEffect(() => {
    if (pending && !pendingCurrent) setPending(null);
  }, [pending, pendingCurrent]);

  // Pixel updates stay local to the two transforms. React only updates at stop boundaries.
  const paint = (position: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.setProperty('--effort-position', String(lastIndex ? position / lastIndex : 0));
    track.style.setProperty('--effort-color', effortTierColorAt(stops, position));
  };
  const showPreview = (position: number) => {
    const index = Math.round(position);
    setPreview((previous) =>
      previous?.index === index && previous.scope === selectionScope
        ? previous
        : { index, scope: selectionScope },
    );
  };
  const release = () => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
    gesture.target.removeAttribute('data-dragging');
    if (gesture.target.hasPointerCapture(gesture.id))
      gesture.target.releasePointerCapture(gesture.id);
  };
  const cancel = () => {
    release();
    setPreview(null);
  };
  const cancelRef = useRef(cancel);
  useLayoutEffect(() => {
    cancelRef.current = cancel;
    const gesture = gestureRef.current;
    if (gesture && (disabled || gesture.scope !== selectionScope)) cancel();
    if (!gestureRef.current) paint(valueIndex);
  });
  useEffect(() => {
    const cancelCurrent = () => cancelRef.current();
    window.addEventListener('blur', cancelCurrent);
    window.addEventListener('resize', cancelCurrent);
    return () => {
      window.removeEventListener('blur', cancelCurrent);
      window.removeEventListener('resize', cancelCurrent);
      const gesture = gestureRef.current;
      if (gesture?.frame != null) cancelAnimationFrame(gesture.frame);
      gestureRef.current = null;
    };
  }, []);

  const commit = (index: number) => {
    const next = stops[index];
    if (!next || next === displayValue) return;
    const revision = ++revisionRef.current;
    setPending({ effort: next, scope: selectionScope });
    const rollback = () => {
      if (revision === revisionRef.current) setPending(null);
    };
    try {
      const result = onChange(next);
      if (result && typeof result === 'object' && 'then' in result) {
        void result.then((accepted) => {
          if (accepted === false) rollback();
        }, rollback);
      } else if (result === false) rollback();
    } catch {
      rollback();
    }
  };
  const positionAt = (gesture: Gesture, clientX: number) =>
    Math.min(1, Math.max(0, (clientX - gesture.left - gesture.offset) / gesture.width)) * lastIndex;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || event.isPrimary === false || gestureRef.current) return;
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const thumb = (event.target as Element).closest('[data-effort-thumb]');
    const thumbRect = thumb?.getBoundingClientRect();
    const offset = thumbRect ? event.clientX - (thumbRect.left + thumbRect.width / 2) : 0;
    const gesture: Gesture = {
      id: event.pointerId,
      phase: thumb ? 'dragging' : 'pressed',
      startX: event.clientX,
      scope: selectionScope,
      left: rect.left,
      width: rect.width,
      offset,
      position: 0,
      frame: null,
      target,
    };
    gesture.position = positionAt(gesture, event.clientX);
    gestureRef.current = gesture;
    target.focus();
    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    // Track presses wait for release: a click animates directly to its stop.
    // Grabbing the thumb tracks immediately, preserving even one-pixel drags.
    if (gesture.phase === 'dragging') {
      target.setAttribute('data-dragging', '');
      paint(gesture.position);
      showPreview(gesture.position);
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.id !== event.pointerId || disabled) return;
    if (gesture.phase === 'pressed') {
      // client coordinates and DOM geometry are both CSS pixels, independent of Retina DPR.
      if (Math.abs(event.clientX - gesture.startX) < 3) return;
      gesture.phase = 'dragging';
      gesture.target.setAttribute('data-dragging', '');
    }
    gesture.position = positionAt(gesture, event.clientX);
    if (gesture.frame !== null) return;
    gesture.frame = requestAnimationFrame(() => {
      gesture.frame = null;
      if (gestureRef.current !== gesture) return;
      paint(gesture.position);
      showPreview(gesture.position);
    });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const index = Math.round(positionAt(gesture, event.clientX));
    release();
    if (!disabled) commit(index);
    setPreview(null);
  };
  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.id === event.pointerId) cancel();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? lastIndex
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? valueIndex + 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
              ? valueIndex - 1
              : null;
    if (index === null) return;
    event.preventDefault();
    event.stopPropagation();
    commit(Math.min(lastIndex, Math.max(0, index)));
  };
  return (
    <div
      className={cn('group/effort relative min-w-0 flex-1 pl-1.5 pr-2.5', disabled && 'opacity-50')}
    >
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={t('newChat.modelSelector.effortLabel')}
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={activeIndex}
        aria-valuetext={activeStop ? labelOf(activeStop) : undefined}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onKeyDown={onKeyDown}
        className={cn(
          'cindy-effort-slider relative flex h-[38px] touch-none items-center',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
        )}
      >
        <div className="absolute inset-x-0 h-3 rounded-full bg-[var(--slider-track)]" />
        <div
          data-effort-fill
          className="cindy-effort-fill absolute left-0 z-[1] h-3 w-full rounded-full"
        />
        {stops.map((stop, index) =>
          index === 0 || index === lastIndex ? null : (
            <div
              key={stop}
              aria-hidden
              // 档位停点:设计稿是「用面板底色打孔」的实心点(color-mix(card 65%)),
              // 之前用 opacity 让它糊在轨道色里,拖动时几乎看不见档位在哪。
              className="absolute z-[2] h-[5px] w-[5px] -translate-x-1/2 rounded-full"
              style={{
                left: `${(index / lastIndex) * 100}%`,
                backgroundColor: 'color-mix(in srgb, var(--model-dropdown-bg) 65%, transparent)',
              }}
            />
          ),
        )}
        <div className="cindy-effort-position absolute inset-0 z-[3] pointer-events-none">
          <div
            data-effort-thumb
            className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-[var(--model-dropdown-bg)] pointer-events-auto"
          >
            <div
              className={cn(
                'pointer-events-none absolute bottom-[calc(100%-2px)] left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 py-1',
                'bg-[var(--tooltip-bg)] text-11 text-[var(--tooltip-text)] opacity-0 transition-opacity duration-100',
                'group-hover/effort:opacity-100',
                dragging && 'opacity-100',
              )}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: effortTierColor(activeStop) }}
              />
              <span>{activeStop ? labelOf(activeStop) : ''}</span>
              {recommended && activeStop === recommended && (
                <span className="opacity-70">
                  · {t('newChat.modelSelector.unified.recommended')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* 端点标签只在拖动时浮现:静态时它们既占视觉又没人看(设计稿 v4)。 */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-1 -bottom-0.5 flex justify-between text-10 text-[var(--text-tertiary)]',
          'transition-opacity duration-150',
          dragging ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span>{t('newChat.modelSelector.unified.effortEndFast')}</span>
        <span>{t('newChat.modelSelector.unified.effortEndSmart')}</span>
      </div>
    </div>
  );
}
