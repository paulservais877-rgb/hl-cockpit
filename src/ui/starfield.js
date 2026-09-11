/* Personal Alpha OS — discreet animated starfield (respects prefers-reduced-motion) */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  function start(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars = [], w = 0, h = 0, dpr = Math.min(root.devicePixelRatio || 1, 2), raf = 0, last = 0;
    function resize() {
      w = root.innerWidth; h = root.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((w * h) / 9000);
      stars = Array.from({ length: Math.min(n, 220) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.1 + 0.2, a: Math.random() * 0.5 + 0.15, p: Math.random() * Math.PI * 2, s: Math.random() * 0.6 + 0.2, drift: (Math.random() - 0.5) * 0.004 }));
      draw(0);
    }
    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const tw = reduced ? 1 : 0.7 + 0.3 * Math.sin(s.p + t * 0.0009 * s.s);
        ctx.globalAlpha = s.a * tw;
        ctx.fillStyle = s.r > 0.9 ? "#dfe7ff" : "#ffffff";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        if (!reduced) { s.y += s.drift; if (s.y < 0) s.y = h; if (s.y > h) s.y = 0; }
      }
      ctx.globalAlpha = 1;
    }
    function loop(t) { if (t - last > 66) { draw(t); last = t; } raf = requestAnimationFrame(loop); }
    resize();
    root.addEventListener("resize", resize);
    if (!reduced) raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(raf); else if (!reduced) raf = requestAnimationFrame(loop); });
  }
  AOS.starfield = { start };
})(typeof window !== "undefined" ? window : globalThis);
