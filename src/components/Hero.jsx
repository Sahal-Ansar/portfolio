import { useEffect, useRef, useState } from 'react';
import LightField from '../lib/LightField.js';
import './Hero.css';

// Mouse interaction is live; nav-button hover recruits particles to orbit the button.
const INTERACTION = true;

// --- environment detection ------------------------------------------------
function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function isMobile() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 720;
}

// WebGL2 + float textures are required for the GPGPU sim; otherwise show a poster.
function webglSupported() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return !!gl;
  } catch {
    return false;
  }
}

export default function Hero({ active = true }) {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const mainRef = useRef(null);
  const topRef = useRef(null);
  const clearTimer = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const updateRunningRef = useRef(() => {});
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!webglSupported()) {
      setFallback(true);
      return;
    }

    // tune the simulation down for reduced-motion / mobile
    const reduced = prefersReducedMotion();
    const mobile = isMobile();
    const config = {};
    if (mobile) {
      config.simSize = 110;
      config.maxDpr = 1.5;
    }
    if (reduced) {
      config.reducedMotion = true;
      config.simSize = 64;
    }

    let engine;
    try {
      engine = new LightField(container, {
        config,
        onError: () => setFallback(true)
      });
    } catch {
      setFallback(true);
      return;
    }
    engineRef.current = engine;

    // --- run only while the hero is the active section, visible + tab focused ---
    let intersecting = true;
    const updateRunning = () => {
      if (activeRef.current && intersecting && !document.hidden) engine.start();
      else engine.stop();
    };
    updateRunningRef.current = updateRunning;

    const io = new IntersectionObserver(
      (entries) => { intersecting = entries[0].isIntersecting; updateRunning(); },
      { threshold: 0.05 }
    );
    io.observe(container);

    const onVisibility = () => updateRunning();
    document.addEventListener('visibilitychange', onVisibility);

    // --- pointer -> sim (cursor excitement) ---
    let onPointerMove, onPointerLeave;
    if (INTERACTION) {
      onPointerMove = (e) => {
        const rect = container.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = 1 - (e.clientY - rect.top) / rect.height; // y up
        const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
        engine.setPointer(x, y, inside);
      };
      onPointerLeave = () => engine.setPointerInside(false);
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerout', onPointerLeave);
    }

    updateRunning();

    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (onPointerMove) window.removeEventListener('pointermove', onPointerMove);
      if (onPointerLeave) window.removeEventListener('pointerout', onPointerLeave);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // stop/start the engine when this section becomes (in)active
  useEffect(() => { updateRunningRef.current(); }, [active]);

  // --- fit "SAHAL ANSAR" to span the title width + align the title photo-fills ---
  useEffect(() => {
    const main = mainRef.current;
    const cont = containerRef.current;
    if (!main) return;

    const fit = () => {
      const boxW = main.clientWidth; // block + width:100% => available content width
      // measure the glyph run at a reference size, out of flow so it shrink-wraps
      main.style.position = 'absolute';
      main.style.width = 'auto';
      main.style.whiteSpace = 'nowrap';
      main.style.fontSize = '100px';
      const textW = main.getBoundingClientRect().width;
      main.style.position = '';
      main.style.width = '';
      main.style.whiteSpace = '';
      if (textW > 0 && boxW > 0) main.style.fontSize = (100 * boxW / textW) + 'px';
    };

    // Position each title's photo layer to match the canvas cover-fit, so the
    // blend reads against the SAME pixels as the hero behind it. (Done in JS
    // because background-attachment:fixed misbehaves inside the transformed
    // scroller.) Measuring relative to the canvas cancels the section transform.
    const IMG_ASPECT = 2411 / 1104;
    const alignTitles = () => {
      if (!cont) return;
      const cr = cont.getBoundingClientRect();
      const W = cr.width, Hh = cr.height;
      if (!W || !Hh) return;
      let cw, ch;
      if (W / Hh < IMG_ASPECT) { ch = Hh; cw = Hh * IMG_ASPECT; }
      else { cw = W; ch = W / IMG_ASPECT; }
      const ox = (W - cw) / 2, oy = (Hh - ch) / 2;
      const apply = (el, gradLayers, useVars) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = ox - (r.left - cr.left);
        const py = oy - (r.top - cr.top);
        if (useVars) {
          // SAHAL ANSAR: the photo lives on ::before; feed it via custom props
          el.style.setProperty('--ph-size', `${cw}px ${ch}px`);
          el.style.setProperty('--ph-pos', `${px}px ${py}px`);
          return;
        }
        const sizes = [], poss = [];
        for (let i = 0; i < gradLayers; i++) { sizes.push('auto'); poss.push('0 0'); }
        sizes.push(`${cw}px ${ch}px`); poss.push(`${px}px ${py}px`);
        el.style.backgroundSize = sizes.join(', ');
        el.style.backgroundPosition = poss.join(', ');
      };
      apply(topRef.current, 1, false);  // I'M: simple clip-text, set directly
      apply(mainRef.current, 0, true);  // SAHAL ANSAR: backing + ::before, via vars
    };

    const update = () => { fit(); alignTitles(); };
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    let cancelled = false;
    document.fonts?.ready?.then(() => { if (!cancelled) update(); });
    update();
    return () => { cancelled = true; ro.disconnect(); };
  }, []);

  // --- nav hover: recruit particles to orbit the hovered button ---
  const onNavEnter = (e) => {
    clearTimeout(clearTimer.current); // cancel a pending release (hopping between buttons)
    const eng = engineRef.current;
    const cont = containerRef.current;
    if (!eng || !cont) return;
    eng.setButton(e.currentTarget.getBoundingClientRect(), cont.getBoundingClientRect());
  };
  // defer the release a beat so moving to an adjacent button slides the orbit
  // over (the next enter cancels this) instead of releasing then re-grabbing
  const onNavLeave = () => {
    clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => engineRef.current?.clearButton(), 60);
  };

  return (
    <section className="hero">
      {/* canvas wrapper sits behind everything; pointer handled via window */}
      <div className="hero__canvas" ref={containerRef} aria-hidden="true" />
      {fallback && <div className="hero__poster" aria-hidden="true" />}

      <div className="hero__overlay">
        <nav className="hero__nav">
          {/* TODO: replace with Lottie. Font: Oldschool Tag (drop in public/fonts/) */}
          <a className="hero__logo" href="#home">Sahal</a>

          {/* glass division: frosted pill wrapping the three buttons */}
          <div className="hero__links">
            <a className="hero__link" href="#about"
               onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>About</a>
            <a className="hero__link" href="#projects"
               onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>Projects</a>
            <a className="hero__link hero__cta" href="#contact"
               onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>
              <span className="hero__cta-label">Contact Me</span>
              <span className="hero__arrow">
                <img className="hero__arrow-img hero__arrow-img--base" src="/images/arrow.png" alt="" />
                <img className="hero__arrow-img hero__arrow-img--hot" src="/images/arrow_highlighted.png" alt="" />
              </span>
            </a>
          </div>
        </nav>

        {/* Photo-fill position is JS-aligned to the canvas (alignTitles). Font: Beligat */}
        <div className="hero__title">
          <span ref={topRef} className="hero__title-line hero__title-top">I&rsquo;M</span>
          {/* A–N join is a Beligat ligature (single run + letter-spacing:0 + features) */}
          <span ref={mainRef} className="hero__title-line hero__title-main">SAHAL ANSAR</span>
        </div>
      </div>
    </section>
  );
}
