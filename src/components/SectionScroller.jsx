import { useEffect, useRef } from 'react';
import './SectionScroller.css';

// Three stacked full-viewport panels: HERO -> TRANSITION (transition1.png, the
// hero background continued downward) -> ABOUT. You don't rest on the transition
// panel — it's a "semi page" you scroll THROUGH on the way between hero and about.
//
// Scroll drives progress `t` (0 = hero, 1 = about) directly, so the page moves
// visibly from the first scroll — weighty/slow to start (ease-in-out-sine), then
// accelerating. Past a commit point it auto-finishes; let go before and it eases
// back. Travel spans two viewport heights (through the transition panel).
//
// IMPORTANT: the transform is applied to each SECTION (a viewport-sized box), not
// the track. A transform ancestor becomes the reference for descendant
// `background-attachment: fixed`; keeping it per-section (= viewport size) keeps
// the title's photo-fill aligned with the hero canvas.

const SENS = 0.0006;     // wheel delta -> progress (lower = heavier / more scroll)
const SNAP_POINT = 0.55; // once you scroll PAST the transition midpoint, snap to about
const SNAP_DUR = 950;    // ms for the auto-finish — long = heavy/premium
// No back-snap and no idle snap-back: scrolling is a free, weighty scrub; the only
// auto-move is the forward commit to About once you're past the transition midpoint.

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// weighty but immediately perceptible, accelerates through the middle, eases out
const easeMove = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeSnap = (t) => 1 - Math.pow(1 - t, 3);

export default function SectionScroller({ children, onActiveChange }) {
  const trackRef = useRef(null);
  const kids = Array.isArray(children) ? children : [children];

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const s = { t: 0, animating: false, raf: 0, lastActive: 0 };
    const H = () => window.innerHeight;
    const sections = () => Array.from(track.children);

    const render = () => {
      // travel spans 2 viewport heights (hero -> transition -> about)
      const y = -easeMove(s.t) * 2 * H();
      const tf = `translate3d(0, ${y}px, 0)`;
      for (const sec of sections()) sec.style.transform = tf;
      // engine runs while the hero is on screen (it scrolls off around t = 0.5)
      const want = s.t < 0.5 ? 0 : 1;
      if (want !== s.lastActive) { s.lastActive = want; onActiveChange?.(want); }
    };
    render();

    const snapTo = (target) => {
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
      s.t = clamp01(s.t + e.deltaY * SENS);
      render();
      // forward-only: once you've scrolled past the transition midpoint, complete
      // to About. Scrolling up is a free scrub back — no snap.
      if (e.deltaY > 0 && s.t >= SNAP_POINT) snapTo(1);
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
      const d = touchY - e.touches[0].clientY;
      s.t = clamp01(s.t + d * 0.0022);
      touchY = e.touches[0].clientY;
      render();
      if (d > 0 && s.t >= SNAP_POINT) snapTo(1);
    };
    const onTouchEnd = () => { touchY = null; };

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
      cancelAnimationFrame(s.raf);
    };
  }, [kids.length, onActiveChange]);

  return (
    <div className="snap-root">
      <div className="snap-track" ref={trackRef}>
        <div className="snap-section">{kids[0]}</div>

        {/* transition "semi page": hero background continued downward */}
        <div className="snap-section snap-xtn" />

        <div className="snap-section">{kids[1]}</div>
      </div>
    </div>
  );
}
