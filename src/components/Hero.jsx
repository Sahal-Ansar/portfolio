import { useEffect, useRef, useState } from 'react';
import LightField from '../lib/LightField.js';
import './Hero.css';

// Course-correction phase: focus on matching ref.png's lighting/atmosphere.
// The nav + hero text and the mouse interaction are intentionally off for now.
const SHOW_OVERLAY = false;
const INTERACTION = false;

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
      config.pointScale = 2.7;
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

    // --- pointer -> sim (disabled for now) ---
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

  // --- Phase 2 stub: nav-button particle attraction --------------------------
  // When built, these would push/clear an attractor so particles float to the
  // hovered button and orbit it (reusing the engine's swirl-around-a-point force).
  // const onNavEnter = (i, el) => {
  //   const eng = engineRef.current; if (!eng) return;
  //   const r = el.getBoundingClientRect();
  //   const c = containerRef.current.getBoundingClientRect();
  //   eng.attractors[i].pos.set(
  //     (r.left + r.width / 2 - c.left) / c.width,
  //     1 - (r.top + r.height / 2 - c.top) / c.height
  //   );
  //   eng.attractors[i].active = true;
  // };
  // const onNavLeave = (i) => { engineRef.current && (engineRef.current.attractors[i].active = false); };

  return (
    <section className="hero">
      {/* canvas wrapper sits behind everything; pointer handled via window */}
      <div className="hero__canvas" ref={containerRef} aria-hidden="true" />
      {fallback && <div className="hero__poster" aria-hidden="true" />}

      {/* Overlay hidden for now while we match ref.png's lighting (SHOW_OVERLAY). */}
      {SHOW_OVERLAY && (
        <div className="hero__overlay">
          <nav className="hero__nav">
            {/* TODO: replace font — brushy display face for the logo (stand-in: Permanent Marker) */}
            <a className="hero__logo" href="#home">Sahal</a>
            <ul className="hero__links">
              {/* Phase 2: add onMouseEnter={(e)=>onNavEnter(0,e.currentTarget)} onMouseLeave={()=>onNavLeave(0)} */}
              <li><a href="#home">Home</a></li>
              <li><a href="#projects">Projects</a></li>
              <li><button type="button" className="hero__cta">Contact Me</button></li>
            </ul>
          </nav>

          <div className="hero__intro">
            <span className="hero__hello">Hello! I&rsquo;m</span>
            {/* TODO: replace font — calligraphic script for the name (stand-in: Tangerine / Pinyon Script) */}
            <h1 className="hero__name">Sahal Ansar</h1>
            <span className="hero__role">UI/UX Developer</span>
          </div>
        </div>
      )}
    </section>
  );
}
