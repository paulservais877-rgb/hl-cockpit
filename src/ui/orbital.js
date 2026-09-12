/* Personal Alpha OS — Orbital map. Positions are bodies orbiting the account:
   size = exposure · orbit distance = distance to liquidation (closer = more dangerous) · brightness = conviction alignment ·
   orbital wobble = volatility · halo = liquidation gravity (share of portfolio risk). */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, fmt } = AOS.util;

  function create(canvas, { onSelect } = {}) {
    const ctx = canvas.getContext("2d");
    const reduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let bodies = [], account = null, level = "NORMAL", raf = 0, w = 0, h = 0, dpr = 1, privacy = false, t0 = performance.now();
    function resize() {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = Math.max(260, Math.min(420, rect.width * 0.62));
      dpr = Math.min(root.devicePixelRatio || 1, 2);
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function update(analysis, opts = {}) {
      privacy = !!opts.privacy;
      const snap = analysis?.snapshot; account = snap?.account || null; level = analysis?.risk?.level || "NORMAL";
      const eq = account?.equity || 1;
      const verdicts = analysis?.orchestration?.verdicts || [];
      const grav = analysis?.risk?.gravity || [];
      bodies = (snap?.positions || []).map((p, i) => {
        const v = verdicts.find((x) => x.coin === p.coin);
        const g = grav.find((x) => x.coin === p.coin);
        const vol = analysis?.features?.byCoin?.[p.coin]?.vol;
        const conv = v ? clamp(Math.abs(v.aligned), 0, 1) : 0.3;
        const dist = isNum(p.liqDist) ? clamp(p.liqDist, 0.03, 0.6) : 0.4;
        const prev = bodies.find((b) => b.coin === p.coin);
        return { coin: p.coin, side: p.side, size: Math.sqrt(clamp(p.notional / eq, 0.02, 6)), dist, conv, vol: isNum(vol) ? clamp(vol / 1.2, 0.3, 2) : 1, grav: g?.share || 0, pnl: p.upnl, roe: p.roe, liqDist: p.liqDist, angle: prev ? prev.angle : (i / Math.max(snap.positions.length, 1)) * Math.PI * 2 + 0.6, speed: (0.00004 + 0.00006 * (isNum(vol) ? clamp(vol / 1.2, 0.3, 2) : 1)) * (i % 2 ? 1 : -1), phase: Math.random() * 6 };
      });
      if (!raf) frame(performance.now());
    }
    function frame(t) {
      draw(t);
      raf = (!reduced && !document.hidden) ? requestAnimationFrame(frame) : 0;
    }
    function bodyPos(b, t) {
      const cx = w / 2, cy = h / 2;
      const Rmax = Math.min(w, h) * 0.44, Rmin = Math.min(w, h) * 0.13;
      const r = Rmin + (Rmax - Rmin) * (b.dist / 0.6);
      const wob = reduced ? 0 : Math.sin(t * 0.0012 * b.vol + b.phase) * (2 + 6 * b.vol);
      const a = b.angle + (reduced ? 0 : (t - t0) * b.speed);
      return { x: cx + Math.cos(a) * (r + wob), y: cy + Math.sin(a) * (r * 0.78 + wob), r, a };
    }
    function draw(t) {
      if (!w) resize();
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const Rmax = Math.min(w, h) * 0.44, Rmin = Math.min(w, h) * 0.13;
      // danger rings (liquidation zone) — closer to center is more dangerous
      for (const [d, col] of [[0.05, "rgba(255,61,90,.35)"], [0.15, "rgba(240,106,126,.22)"], [0.25, "rgba(230,180,80,.18)"], [0.6, "rgba(196,208,232,.08)"]]) {
        const r = Rmin + (Rmax - Rmin) * (d / 0.6);
        ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.78, 0, 0, Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
      }
      // account core
      const lvlCol = { NORMAL: "#45d39a", WATCH: "#e6b450", STRESSED: "#f2994a", DANGER: "#f06a7e", CRITICAL: "#ff3d5a" }[level] || "#8b93a7";
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34);
      g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.25, lvlCol); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e7eaf1"; ctx.font = "600 11px JetBrains Mono, monospace"; ctx.textAlign = "center";
      ctx.fillText(privacy ? "•••••" : fmt.usd(account?.equity), cx, cy + 50);
      ctx.fillStyle = "#8b93a7"; ctx.font = "500 9px JetBrains Mono, monospace"; ctx.fillText(AOS.i18n ? AOS.i18n.level(level) : level, cx, cy + 62);
      // bodies
      for (const b of bodies) {
        const { x, y } = bodyPos(b, t);
        const R = 5 + b.size * 8;
        // couleur Velvet de l'actif pour le corps ; le sens (long/short) tient dans l'anneau
        const col = AOS.palette ? AOS.palette.rgb(b.coin).join(",") : b.side === "LONG" ? "111,211,176" : "240,132,151";
        const sideCol = b.side === "LONG" ? "rgba(111,211,176,.85)" : "rgba(240,132,151,.85)";
        // gravity halo
        if (b.grav > 0.05) { const hg = ctx.createRadialGradient(x, y, R, x, y, R + 18 + 40 * b.grav); hg.addColorStop(0, `rgba(${col},${0.18 + 0.25 * b.grav})`); hg.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, y, R + 18 + 40 * b.grav, 0, Math.PI * 2); ctx.fill(); }
        // body — brightness = conviction alignment
        const alpha = 0.45 + 0.55 * b.conv;
        const bg = ctx.createRadialGradient(x - R * 0.3, y - R * 0.3, 1, x, y, R);
        bg.addColorStop(0, `rgba(255,255,255,${0.5 * alpha})`); bg.addColorStop(0.4, `rgba(${col},${alpha})`); bg.addColorStop(1, `rgba(${col},${alpha * 0.55})`);
        ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
        // side ring (long/short) then pnl ring
        ctx.beginPath(); ctx.arc(x, y, R + 2, 0, Math.PI * 2); ctx.strokeStyle = sideCol; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, R + 5, 0, Math.PI * 2); ctx.strokeStyle = isNum(b.pnl) ? (b.pnl >= 0 ? "rgba(69,211,154,.55)" : "rgba(240,106,126,.55)") : "rgba(255,255,255,.2)"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);
        // label
        ctx.fillStyle = "#e7eaf1"; ctx.font = "700 11px JetBrains Mono, monospace"; ctx.textAlign = "center"; ctx.fillText(b.coin, x, y - R - 10);
        ctx.fillStyle = "#8b93a7"; ctx.font = "500 9.5px JetBrains Mono, monospace";
        ctx.fillText((privacy ? "" : fmt.usdSigned(b.pnl, 0) + " · ") + (isNum(b.liqDist) ? "liq " + (b.liqDist * 100).toFixed(0) + "%" : "liq —"), x, y + R + 13);
        b._x = x; b._y = y; b._R = R;
      }
    }
    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const hit = bodies.find((b) => Math.hypot(b._x - x, b._y - y) <= (b._R || 10) + 8);
      if (hit && onSelect) onSelect(hit.coin);
    });
    root.addEventListener("resize", () => { resize(); if (reduced) draw(performance.now()); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !raf && !reduced) frame(performance.now()); });
    resize();
    return { update, redraw: () => draw(performance.now()) };
  }
  AOS.orbital = { create };
})(typeof window !== "undefined" ? window : globalThis);
