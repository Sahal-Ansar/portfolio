import { useEffect, useRef } from 'react';
import './SectionScroller.css';

// Full-section snap scroller with a SCRUBBED, premium feel.
//
// Scroll input drives a progress value `t` (0 = hero, 1 = about) directly, so the
// page moves VISIBLY from the very first scroll — heavy/slow at the start (the
// ease curve is flat there), accelerating as you go. Once you cross a small commit
// threshold it auto-finishes quickly on its own; if you let go before that, it
// snaps back. There is never a resting half-and-half state.
//
// During the cross, a transition layer (transition1.png + a gradual backdrop blur)
// rises and peaks at the midpoint, masking the seam between the two animations.

const SENS = 0.0018;     // wheel delta -> progress (higher = less scrolling needed)
const COMMIT = 0.3;      // progress past which the move auto-completes
const SNAP_DUR = 500;    // ms for the auto-finish (and snap-back)
const IDLE = 150;        // ms of no scroll before snapping to the nearest section
const MAX_BLUR = 18;     // px, peak transition blur

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// visible movement: weighty/slow to start but immediately perceptible, then
// accelerates through the middle and eases out (ease-in-out-sine)
const easeMove = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
// auto-finish: fast out, gentle settle
const easeSnap = (t) => 1 - Math.pow(1 - t, 3);

export default function SectionScroller({ children, onActiveChange }) {
  const trackRef = useRef(null);
  const blurRef = useRef(null);
  const imgRef = useRef(null);
  const count = Array.isArray(children) ? children.length : 1;

  useEffect(() => {
    const track = trackRef.current;
    const blur = blurRef.current;
    const img = imgRef.current;
    if (!track) return;

    const s = { t: 0, animating: false, raf: 0, idle: 0, lastActive: 0 };
    const H = () => window.innerHeight;

    const render = () => {
      const v = easeMove(s.t);
      track.style.transform = `translate3d(0, ${-v * H()}px, 0)`;
      // transition layer peaks at the midpoint (0 at both ends)
      const p = Math.sin(clamp01(s.t) * Math.PI);
      const b = (p * MAX_BLUR).toFixed(2);
      if (blur) {
        blur.style.backdropFilter = `blur(${b}px) saturate(${1 + p * 0.3})`;
        blur.style.webkitBackdropFilter = `blur(${b}px) saturate(${1 + p * 0.3})`;
      }
      if (img) img.style.opacity = String(p);
      // engine runs whenever the hero is at all on screen (t < 1)
      const want = s.t >= 0.999 ? 1 : 0;
      if (want !== s.lastActive) { s.lastActive = want; onActiveChange?.(want); }
    };
    render();

    const snapTo = (target) => {
      clearTimeout(s.idle);
      if (Math.abs(target - s.t) < 0.001) { s.t = target; render(); return; }
      s.animating = true;
      const from = s.t;
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / SNAP_DUR);
        s.t = from + (target - from) * easeSnap(k);
        render();
        if (k < 1) s.raf = requestAnimationFrame(step);
        else { s.animating = false; s.t = target; render(); }
      };
      s.raf = requestAnimationFrame(step);
    };

    const onWheel = (e) => {
      e.preventDefault(); // jack scroll (also blocks ctrl-zoom)
      if (s.animating) return;
      clearTimeout(s.idle);
      const dy = e.deltaY;
      s.t = clamp01(s.t + dy * SENS);
      render();
      if (dy > 0 && s.t >= COMMIT) return snapTo(1);
      if (dy < 0 && s.t <= 1 - COMMIT) return snapTo(0);
      // released mid-scrub without committing -> settle back to the nearest section
      s.idle = setTimeout(() => { if (!s.animating) snapTo(s.t < 0.5 ? 0 : 1); }, IDLE);
    };

    const onKey = (e) => {
      if (s.animating) return;
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); snapTo(1); }
      else if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); snapTo(0); }
    };

    let touchY = null;
    const onTouchStart = (e) => { touchY = e.touches[0].clientY; };
    const onTouchMove = (e) => {
      e.preventDefault();
      if (touchY == null || s.animating) return;
      const dy = touchY - e.touches[0].clientY;
      s.t = clamp01(s.t + dy * 0.004);
      touchY = e.touches[0].clientY;
      render();
    };
    const onTouchEnd = () => { if (!s.animating) snapTo(s.t < COMMIT ? 0 : s.t > 1 - COMMIT ? 1 : s.t < 0.5 ? 0 : 1); touchY = null; };

    const onResize = () => { if (!s.animating) render(); };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
      clearTimeout(s.idle);
      cancelAnimationFrame(s.raf);
    };
  }, [count, onActiveChange]);

  return (
    <div className="snap-root">
      <div className="snap-track" ref={trackRef}>
        {(Array.isArray(children) ? children : [children]).map((child, i) => (
          <div className="snap-section" key={i}>{child}</div>
        ))}
      </div>

      {/* transition layer: gradual backdrop blur + transition image, peaks mid-cross */}
      <div className="snap-transition" aria-hidden="true">
        <div className="snap-transition__blur" ref={blurRef} />
        <div className="snap-transition__img" ref={imgRef} />
      </div>
    </div>
  );
}
