import { Icon } from './Icon.tsx';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { animations } from '../mascot/animations.ts';
import { mascot } from '../mascot/store.ts';
import { FRAME_HEIGHT, FRAME_WIDTH, spriteAtlas } from '../mascot/sprites.ts';

const MOTION_KEY = 'galeata:mascot-motion';
function readMotion() {
  try { return localStorage.getItem(MOTION_KEY) !== 'false'; }
  catch { return true; }
}

export default function TurtleMascot({ agentId, compact = false }: { agentId?: string; compact?: boolean }) {
  const snapshot = useSyncExternalStore(mascot.subscribe, useCallback(() => mascot.getOverview(agentId), [agentId]));
  const [motion, setMotion] = useState(readMotion);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const moving = motion && !reduced;
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(MOTION_KEY, String(motion)); } catch { /* optional storage */ }
  }, [motion]);
  useEffect(() => {
    let disposed = false;
    let tick: number | undefined;
    let atlas: HTMLCanvasElement | undefined;
    let visible = true;
    let elapsed = 0;
    let previousTime: number | undefined;
    let paintedAt = -Infinity;
    const definition = animations[snapshot.animation];
    const stop = () => {
      if (tick !== undefined) window.clearTimeout(tick);
      tick = undefined;
      previousTime = undefined;
    };
    const draw = (now: number) => {
      tick = undefined;
      if (disposed || !visible || !atlas || !canvas.current) return;
      if (moving && !document.hidden && previousTime !== undefined) elapsed += now - previousTime;
      previousTime = now;
      const context = canvas.current.getContext('2d');
      if (!context) return;
      // Schedule only useful paints; idle poses need no display-rate callbacks.
      if (now - paintedAt >= 1000 / 30) {
        paintedAt = now;
        const duration = 1000 / definition.fps;
        const position = Math.floor(elapsed / duration);
        const frame = definition.frames[position % definition.frames.length];
        const next = definition.frames[(position + 1) % definition.frames.length];
        const transition = Math.min(80, duration * 0.45);
        const progress = moving ? Math.max(0, (elapsed % duration - duration + transition) / transition) : 0;
        const blend = progress * progress * (3 - 2 * progress);
        context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        context.globalAlpha = 1 - blend;
        context.drawImage(atlas, frame * FRAME_WIDTH, 0, FRAME_WIDTH, FRAME_HEIGHT,
          0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        if (blend > 0) {
          // Add premultiplied colors so the character does not dim during a dissolve.
          context.globalCompositeOperation = 'lighter';
          context.globalAlpha = blend;
          context.drawImage(atlas, next * FRAME_WIDTH, 0, FRAME_WIDTH, FRAME_HEIGHT,
            0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        }
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        canvas.current.dataset.frame = String(frame);
      }
      if (moving && !document.hidden) {
        tick = window.setTimeout(() => draw(performance.now()),
          snapshot.animation === 'idle' || snapshot.animation === 'waiting' ? 100 : 1000 / 30);
      }
    };
    const resume = () => {
      stop();
      paintedAt = -Infinity;
      if (visible && !document.hidden && atlas) draw(performance.now());
    };
    const visibility = () => {
      stop();
      if (!document.hidden) resume();
    };
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      stop();
      if (visible && !document.hidden) resume();
    });
    if (canvas.current) observer.observe(canvas.current);
    void spriteAtlas(snapshot.animation).then((loaded) => {
      if (disposed) return;
      atlas = loaded;
      setFailed(false);
      resume();
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
    };
  }, [snapshot.animation, moving]);
  return (
    <div className={`turtle-mascot ${compact ? 'compact' : ''}`} data-animation={snapshot.animation} data-moving={moving}>
      <button className="mascot-greet" title={`${snapshot.label} · Faire danser la mascotte`} aria-label="Faire danser la mascotte"
        onClick={() => mascot.react('play', agentId)}>
        <canvas ref={canvas} width={FRAME_WIDTH} height={FRAME_HEIGHT}
          role="img" aria-label={`Mascotte : ${snapshot.label}`} />
        {failed ? <span className="mascot-fallback" aria-hidden="true">🐢</span> : null}
      </button>
      {!compact ? <span className="mascot-caption">{snapshot.label}</span> : null}
      {!compact && !reduced ? (
        <button className="mascot-motion" aria-label={motion ? 'Mettre la mascotte en pause' : 'Animer la mascotte'}
          title={motion ? 'Mettre la mascotte en pause' : 'Animer la mascotte'}
          onClick={() => setMotion((value) => !value)}><Icon name={motion ? "pause" : "play"} size={12} /></button>
      ) : null}
    </div>
  );
}
