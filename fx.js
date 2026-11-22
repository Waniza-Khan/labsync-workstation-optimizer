window.LabSyncFX = {
  init() {
    if (window.Lenis) {
      const lenis = new Lenis({ smoothWheel: true });
      const raf = time => { lenis.raf(time); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  },
  animateCards() {
    if (window.gsap) gsap.from('.pc-card', { y: 14, opacity: 0, stagger: 0.025, duration: 0.45, ease: 'power2.out' });
  },
  pulse(element) {
    if (window.gsap) gsap.fromTo(element, { scale: 0.96 }, { scale: 1, duration: 0.35, ease: 'back.out(2)' });
  }
};
