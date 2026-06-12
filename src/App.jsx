import { useCallback, useEffect, useState } from 'react';
import Hero from './components/Hero.jsx';
import About from './components/About.jsx';
import SectionScroller from './components/SectionScroller.jsx';

export default function App() {
  const [active, setActive] = useState(0); // 0 = hero, 1 = about

  // Lock browser zoom (keyboard + pinch). Wheel-zoom (ctrl+wheel) is already
  // blocked by the scroller, which preventDefaults all wheel input.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '_', '0'].includes(e.key)) e.preventDefault();
    };
    const onGesture = (e) => e.preventDefault();
    window.addEventListener('keydown', onKey);
    window.addEventListener('gesturestart', onGesture);
    window.addEventListener('gesturechange', onGesture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('gesturestart', onGesture);
      window.removeEventListener('gesturechange', onGesture);
    };
  }, []);

  const onActiveChange = useCallback((i) => setActive(i), []);

  return (
    <SectionScroller onActiveChange={onActiveChange}>
      {/* hero engine runs only while the hero section is the active one */}
      <Hero active={active === 0} />
      <About />
    </SectionScroller>
  );
}
