import './About.css';

// Second section: full-screen black for now. A second interactable animation will
// live here later — which is why the scroll snaps fully between this and the hero
// (no half-and-half state where both animations would be visible at once).
export default function About() {
  return (
    <section className="about" aria-label="About">
      <span className="about__placeholder">About</span>
    </section>
  );
}
