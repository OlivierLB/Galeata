import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampSize, type PanelBounds } from '../domain.ts';

// Panel sizes are a per-viewer convenience: storage may be unavailable, so every
// access is guarded and the layout still renders with defaults.
export function usePanelSize(key: string, fallback: number, bounds: PanelBounds) {
  const [size, setSize] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return clampSize(stored === null ? fallback : Number(stored), bounds, fallback);
    } catch {
      return clampSize(fallback, bounds, fallback);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(size));
    } catch {
      /* storage unavailable: keep the in-memory size */
    }
  }, [key, size]);
  const update = useCallback(
    (value: number) => setSize(clampSize(value, bounds, fallback)),
    [bounds, fallback],
  );
  return [size, update] as const;
}

/**
 * Draggable boundary between two panels.
 * `direction` is +1 when dragging right/down grows the panel, -1 otherwise.
 */
export default function Splitter({
  label,
  orientation,
  size,
  bounds,
  direction,
  onResize,
  onReset,
}: {
  label: string;
  orientation: 'vertical' | 'horizontal';
  size: number;
  bounds: PanelBounds;
  direction: 1 | -1;
  onResize: (size: number) => void;
  onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    const position = (e: { clientX: number; clientY: number }) =>
      orientation === 'vertical' ? e.clientX : e.clientY;
    const origin = position(event);
    const initial = size;
    target.setPointerCapture(event.pointerId);
    setDragging(true);
    document.body.classList.add(`resizing-${orientation}`);
    const move = (moveEvent: globalThis.PointerEvent) =>
      onResize(initial + (position(moveEvent) - origin) * direction);
    const end = () => {
      setDragging(false);
      document.body.classList.remove(`resizing-${orientation}`);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16;
    const forward = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const backward = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    if (event.key === forward) onResize(size + step * direction);
    else if (event.key === backward) onResize(size - step * direction);
    else if (event.key === 'Home') onResize(bounds.min);
    else if (event.key === 'End') onResize(bounds.max);
    else if (event.key === 'Enter') onReset();
    else return;
    event.preventDefault();
  }
  return (
    <div
      className={`splitter splitter-${orientation} ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={size}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      title={`${label} : glisser pour redimensionner, double-clic pour réinitialiser`}
      onPointerDown={start}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
