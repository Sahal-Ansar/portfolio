import { useEffect } from 'react';
import Hero from './components/Hero.jsx';

export default function App() {
  // Lock browser zoom. The layout is sized in vw and the title is fitted to the
  // viewport width, so a stray ctrl-scroll / ctrl-+/- would throw it off. (Can't
  // block the browser's menu zoom, but this covers keyboard, wheel and pinch.)
  useEffect(() => {
    const onWheel = (e) => { if (e.ctrlKey) e.preventDefault(); };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '_', '0'].includes(e.key)) {
        e.preventDefault();
      }
    };
    const onGesture = (e) => e.preventDefault(); // Safari pinch-zoom
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('gesturestart', onGesture);
    window.addEventListener('gesturechange', onGesture);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('gesturestart', onGesture);
      window.removeEventListener('gesturechange', onGesture);
    };
  }, []);

  return (
    <main>
      <Hero />
      {/* Out of scope for now: Projects, Contact, etc. */}
    </main>
  );
}
