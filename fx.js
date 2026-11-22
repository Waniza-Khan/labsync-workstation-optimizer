/* LabSync — scroll parallax (GSAP ScrollTrigger, synced with Lenis) and hero particle field */
(function () {
  if (!window.gsap || !window.ScrollTrigger || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  gsap.registerPlugin(ScrollTrigger);
  const $ = s => document.querySelector(s), all = s => gsap.utils.toArray(s);

  // reading-progress bar
  gsap.to('#prog', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: .3 } });

  // hero layers move at different speeds while scrolling away
  const hero = { trigger: '.hero2', start: 'top top', end: 'bottom top', scrub: true };
  gsap.to('#fx', { yPercent: 22, scrollTrigger: hero });
  gsap.to('.hero-text', { yPercent: -16, opacity: .15, scrollTrigger: hero });
  gsap.to('.cloud', { yPercent: -42, scrollTrigger: hero });
  gsap.to('.cue', { opacity: 0, scrollTrigger: { trigger: '.hero2', start: '8% top', end: '25% top', scrub: true } });

  // hero intro
  gsap.from('.hero-text > *', { y: 44, opacity: 0, stagger: .12, duration: .95, ease: 'power3.out', delay: .15 });
  gsap.from('.cloud', { scale: .88, opacity: 0, duration: 1.2, ease: 'power3.out', delay: .4 });

  // background orb drifts slower than the page; section titles rise in
  gsap.to('.orb', { yPercent: 35, scrollTrigger: { trigger: '.wrap', start: 'top bottom', end: 'bottom top', scrub: 1 } });
  all('.stitle, .schedhead').forEach(t => gsap.from(t.children, { y: 54, opacity: 0, stagger: .12, duration: .9, ease: 'power3.out', scrollTrigger: { trigger: t, start: 'top 88%' } }));
  gsap.from('.dt-row', { x: -30, opacity: 0, stagger: .04, duration: .6, ease: 'power3.out', scrollTrigger: { trigger: '#dtgrid', start: 'top 88%' } });
  gsap.from('#list', { y: 60, opacity: 0, duration: .9, ease: 'power3.out', scrollTrigger: { trigger: '#list', start: 'top 92%' } });

  // smooth scroll for the hero button
  $('#bStart').onclick = () => window.lenis ? lenis.scrollTo('#book', { offset: -70, duration: 1.4 }) : $('#book').scrollIntoView({ behavior: 'smooth' });

  // coloured particle network that reacts to the pointer
  const cv = $('#fx'), ctx = cv.getContext('2d'), cols = ['#ef4444', '#34d399', '#60a5fa', '#e5e7eb', '#fbbf24'];
  let W, H, P = [], mx = 0, my = 0;
  function size() {
    const d = Math.min(devicePixelRatio || 1, 2); W = cv.offsetWidth; H = cv.offsetHeight;
    cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    P = Array.from({ length: Math.round(Math.min(95, W / 14)) }, () => ({ x: Math.random() * W, y: Math.random() * H, z: .3 + Math.random() * .9, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25, c: cols[Math.floor(Math.random() * cols.length)] }));
  }
  size(); addEventListener('resize', size);
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; });
  let sx = 0, sy = 0;
  gsap.ticker.add(() => {
    sx += (mx - sx) * .06; sy += (my - sy) * .06; ctx.clearRect(0, 0, W, H);
    P.forEach(p => { p.x = (p.x + p.vx + W) % W; p.y = (p.y + p.vy + H) % H; p.rx = p.x + sx * 60 * p.z; p.ry = p.y + sy * 60 * p.z; });
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j], d = Math.hypot(a.rx - b.rx, a.ry - b.ry);
      if (d < 110) { ctx.strokeStyle = `rgba(255,255,255,${.08 * (1 - d / 110)})`; ctx.beginPath(); ctx.moveTo(a.rx, a.ry); ctx.lineTo(b.rx, b.ry); ctx.stroke(); }
    }
    P.forEach(p => { ctx.fillStyle = p.c; ctx.globalAlpha = .55 + p.z * .4; ctx.beginPath(); ctx.arc(p.rx, p.ry, 1.2 + p.z * 1.4, 0, 6.283); ctx.fill(); });
    ctx.globalAlpha = 1;
  });
})();