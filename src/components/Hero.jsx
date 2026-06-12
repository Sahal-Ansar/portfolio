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

export default function Hero() {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const mainRef = useRef(null);
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

    // --- run only while visible + tab focused ---
    let intersecting = true;
    const updateRunning = () => {
      if (intersecting && !document.hidden) engine.start();
      else engine.stop();
    };

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

  // --- fit "SAHAL ANSAR" to span the full title width (font-metric agnostic) ---
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const fit = () => {
      const boxW = el.clientWidth; // block + width:100% => available content width
      // measure the glyph run at a reference size: take it out of flow so it
      // shrink-wraps to the text regardless of the flex layout around it
      el.style.position = 'absolute';
      el.style.width = 'auto';
      el.style.whiteSpace = 'nowrap';
      el.style.fontSize = '100px';
      const textW = el.getBoundingClientRect().width;
      el.style.position = '';
      el.style.width = '';
      el.style.whiteSpace = '';
      if (textW > 0 && boxW > 0) el.style.fontSize = (100 * boxW / textW) + 'px';
    };
    const ro = new ResizeObserver(fit);
    ro.observe(document.documentElement);
    let cancelled = false;
    document.fonts?.ready?.then(() => { if (!cancelled) fit(); });
    fit();
    return () => { cancelled = true; ro.disconnect(); };
  }, []);

  // --- nav hover: recruit particles to orbit the hovered button ---
  const onNavEnter = (e) => {
    const eng = engineRef.current;
    const cont = containerRef.current;
    if (!eng || !cont) return;
    eng.setButton(e.currentTarget.getBoundingClientRect(), cont.getBoundingClientRect());
  };
  const onNavLeave = () => engineRef.current?.clearButton();

  return (
    <section className="hero">
      {/* canvas wrapper sits behind everything; pointer handled via window */}
      <div className="hero__canvas" ref={containerRef} aria-hidden="true" />
      {fallback && <div className="hero__poster" aria-hidden="true" />}

      <div className="hero__overlay">
        <nav className="hero__nav">
          {/* TODO: replace with Lottie. Font: Oldschool Tag (drop in public/fonts/) */}
          <a className="hero__logo" href="#home">Sahal</a>

          <ul className="hero__links">
            <li>
              <a className="hero__link" href="#about"
                 onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>About</a>
            </li>
            <li>
              <a className="hero__link" href="#projects"
                 onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>Projects</a>
            </li>
            <li>
              <a className="hero__link hero__cta" href="#contact"
                 onMouseEnter={onNavEnter} onMouseLeave={onNavLeave}>
                <span className="hero__cta-label">Contact Me</span>
                <span className="hero__arrow">
                  <img className="hero__arrow-img hero__arrow-img--base" src="/images/arrow.png" alt="" />
                  <img className="hero__arrow-img hero__arrow-img--hot" src="/images/arrow_highlighted.png" alt="" />
                </span>
              </a>
            </li>
          </ul>
        </nav>

        {/* TODO: title fills are placeholders — swap in dictated values. Font: Beligat */}
        <div className="hero__title">
          <span className="hero__title-line hero__title-top">I&rsquo;M</span>
          <span ref={mainRef} className="hero__title-line hero__title-main">SAHAL ANSAR</span>
        </div>
      </div>
    </section>
  );
}
