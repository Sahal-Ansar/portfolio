import { useEffect, useRef } from 'react';
import './SectionScroller.css';

// Full-section snap scroller. Scroll input is "jacked": instead of free scrolling
// (which would leave you parked half-on-the-hero / half-on-the-next section — bad,
// because each section has its own interactable animation), a deliberate scroll
// past a threshold animates the WHOLE viewport to the next/prev section.
//
// The motion is intentionally heavy + premium: a long duration with an
// ease-in-out-quint ("plateau") curve — slow/weighty to start, then it carries
// itself the rest of the way and settles. There is no resting in-between state.

const DURATION = 1200;   // ms — long = heavy/premium
const THRESHOLD = 130;   // accumulated wheel delta before a snap fires (the "heavy" resistance)
const COOLDOWN = 160;    // ms after a snap before input is accepted again

// ease-in-out-quint: flat (heavy) at the start, accelerates, gentle settle
const easePlateau = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

export default function SectionScroller({ children, onActiveChange }) {
  const trackRef = useRef(null);
  const st = useRef({ active: 0, animating: false, accum: 0, raf: 0, lockUntil: 0 });
  const count = Array.isArray(children) ? children.length : 1;

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const s = st.current;
    const H = () => window.innerHeight;

    const place = () => { track.style.transform = `translate3d(0, ${-s.active * H()}px, 0)`; };
    place();

    const animateTo = (target) => {
      if (target < 0 || target >= count || target === s.active || s.animating) return;
      s.animating = true;
      s.accum = 0;
      const from = -s.active * H();
      const to = -target * H();
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / DURATION);
        track.style.transform = `translate3d(0, ${from + (to - from) * easePlateau(t)}px, 0)`;
        if (t < 1) {
          s.raf = requestAnimationFrame(step);
        } else {
          s.animating = false;
          s.active = target;
          s.lockUntil = performance.now() + COOLDOWN;
          onActiveChange?.(target);
        }
      };
      s.raf = requestAnimationFrame(step);
    };

    const tryStep = (dir) => {
      if (s.animating || performance.now() < s.lockUntil) return;
      animateTo(s.active + dir);
    };

    const onWheel = (e) => {
      e.preventDefault(); // jack scroll (also blocks ctrl-zoom)
      if (s.animating || performance.now() < s.lockUntil) return;
      s.accum += e.deltaY;
      if (s.accum > THRESHOLD) tryStep(1);
      else if (s.accum < -THRESHOLD) tryStep(-1);
    };

    // bleed off stray accumulation so only a sustained, deliberate scroll triggers
    const decay = setInterval(() => { if (!s.animating) s.accum *= 0.85; }, 120);

    const onKey = (e) => {
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); tryStep(1); }
      else if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); tryStep(-1); }
    };

    let touchY = null;
    const onTouchStart = (e) => { touchY = e.touches[0].clientY; };
    const onTouchMove = (e) => {
      e.preventDefault();
      if (touchY == null || s.animating) return;
      const dy = touchY - e.touches[0].clientY;
      if (Math.abs(dy) > 60) { tryStep(dy > 0 ? 1 : -1); touchY = null; }
    };

    const onResize = () => { if (!s.animating) place(); };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('resize', onResize);
      clearInterval(decay);
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
    </div>
  );
}
