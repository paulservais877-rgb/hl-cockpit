/* Alpha OS — scène « Marée » (portée de Cryptex, sans doctrine) : mer WebGL, lune, étoiles, étoiles filantes,
   éclairs en tempête, baleine par nuit calme. La scène ne DÉCIDE rien : elle SUBIT le niveau de la Sentinelle
   via body[data-state] = safe | warn | crit. Pas d'images : tout est CSS, SVG ou canvas.
   Respecte prefers-reduced-motion et se met en pause quand l'onglet est caché. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const doc = root.document;

  const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FRAG = `
    precision highp float;
    uniform vec2  uRes; uniform float uTime; uniform float uChop; uniform float uSpeed;
    uniform vec3  uDeep; uniform vec3 uHorizon; uniform vec3 uGlint;
    uniform float uMoonX; uniform float uGlintW; uniform float uGlintStr; uniform float uFlash;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++){ v += a * noise(p); p = m * p; a *= 0.5; } return v; }
    float waveH(vec2 p, float t){ float h = fbm(p + vec2(t * 0.45, t * 0.16)); h += 0.55 * fbm(p * 2.6 - vec2(t * 0.62, t * 0.10)); return h; }
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes; float yd = uv.y; float near = 1.0 - yd; float t = uTime * uSpeed;
      float dist = 1.0 / (near * 0.92 + 0.018); float aspect = uRes.x / uRes.y;
      vec2 wp = vec2((uv.x - 0.5) * aspect * dist * 1.25, dist * 2.0); float trailX = (uv.x - uMoonX) * aspect;
      float eps = 0.085; float h = waveH(wp, t); float hx = waveH(wp + vec2(eps, 0.0), t); float hy = waveH(wp + vec2(0.0, eps), t);
      vec2 slope = vec2(hx - h, hy - h) / eps * uChop * 0.115;
      float gx = trailX / 0.55; float glowX = exp(-gx * gx);
      vec3 horizonDark = mix(uDeep, uHorizon, 0.45); vec3 horizonCol = mix(horizonDark, uHorizon, glowX);
      float fres = pow(yd, 2.1); vec3 col = mix(uDeep, horizonCol, clamp(fres * 0.9 + slope.y * 0.35 + h * 0.05, 0.0, 1.0));
      float gw = uGlintW * (0.38 + yd * 1.25); float facet = trailX + slope.x * 1.7; float q = facet / gw; float trail = exp(-q * q);
      float sp = pow(clamp(1.0 - abs(facet) / (gw * 1.5), 0.0, 1.0), 2.0);
      float glitter = smoothstep(0.58, 0.95, noise(wp * 7.0 + vec2(t * 1.4, -t))) * sp;
      float breathe = 0.9 + 0.1 * sin(uTime * 0.55); float glint = (trail * 0.5 + glitter * 1.15) * uGlintStr * breathe;
      float cq = trailX / (uGlintW * 0.85); float core = exp(-cq * cq) * pow(yd, 3.2) * 0.95;
      col += uGlint * (glint * (0.35 + yd * 0.8) + core);
      col = mix(col, horizonCol + uGlint * core * 0.6, smoothstep(0.86, 1.0, yd));
      col += vec3(0.62, 0.70, 0.85) * uFlash * (0.22 + 0.55 * pow(yd, 2.0));
      col *= mix(1.0, 0.5, smoothstep(0.45, 1.0, near));
      gl_FragColor = vec4(col, 1.0);
    }`;

  const hex = (c) => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
  const MOODS = {
    safe: { label: "Nuit calme", water: { deep: hex("#03141f"), horizon: hex("#2e6b78"), glint: hex("#ff8243"), chop: 0.55, speed: 0.45, glintW: 0.105, glintStr: 1.3 } },
    warn: { label: "Crépuscule", water: { deep: hex("#0a121a"), horizon: hex("#6b5535"), glint: hex("#ffb454"), chop: 1.25, speed: 0.85, glintW: 0.075, glintStr: 0.8 } },
    crit: { label: "Tempête", water: { deep: hex("#10070d"), horizon: hex("#55161e"), glint: hex("#ff4d3f"), chop: 2.1, speed: 1.3, glintW: 0.09, glintStr: 0.95 } },
  };
  const LEVEL_TO_STATE = { NORMAL: "safe", WATCH: "warn", STRESSED: "warn", DANGER: "crit", CRITICAL: "crit" };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const lerp = (a, b, k) => a + (b - a) * k;

  const reduced = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let state = "safe", started = false, visible = true;

  // ---- mer (WebGL) ----------------------------------------------------------------------------------------
  const water = { gl: null, canvas: null, uni: {}, cur: clone(MOODS.safe.water), tgt: clone(MOODS.safe.water), moonX: 0.505, flash: 0, flashTgt: 0, raf: 0, t0: 0, last: 0, ok: false };
  function compile(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function waterInit(cv) {
    water.canvas = cv;
    let gl = null;
    try { gl = cv.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" }); } catch (e) { gl = null; }
    if (!gl) { cv.style.background = "linear-gradient(180deg,#123641,#03141f)"; return false; }
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ["uRes", "uTime", "uChop", "uSpeed", "uDeep", "uHorizon", "uGlint", "uMoonX", "uGlintW", "uGlintStr", "uFlash"]) water.uni[n] = gl.getUniformLocation(prog, n);
    } catch (e) { cv.style.background = "linear-gradient(180deg,#123641,#03141f)"; return false; }
    water.gl = gl; water.ok = true; water.t0 = performance.now();
    waterResize();
    return true;
  }
  function waterResize() {
    const cv = water.canvas, gl = water.gl; if (!cv || !gl) return;
    // résolution réduite sur petit écran : la mer est faite de dégradés, la netteté ne s'y voit pas, la batterie oui
    const dpr = Math.min(root.devicePixelRatio || 1, root.innerWidth < 700 ? 0.9 : 1.25);
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); gl.viewport(0, 0, cv.width, cv.height);
  }
  function waterRender(tSec) {
    const gl = water.gl, c = water.cur, g = water.tgt, u = water.uni; if (!gl) return;
    const k = reduced ? 1 : 0.035;
    for (const p of ["chop", "speed", "glintW", "glintStr"]) c[p] = lerp(c[p], g[p], k);
    for (const p of ["deep", "horizon", "glint"]) for (let i = 0; i < 3; i++) c[p][i] = lerp(c[p][i], g[p][i], k);
    water.flash = lerp(water.flash, water.flashTgt, 0.3); water.flashTgt *= 0.86;
    gl.uniform2f(u.uRes, water.canvas.width, water.canvas.height);
    gl.uniform1f(u.uTime, reduced ? 0 : tSec); gl.uniform1f(u.uChop, c.chop); gl.uniform1f(u.uSpeed, c.speed);
    gl.uniform3fv(u.uDeep, c.deep); gl.uniform3fv(u.uHorizon, c.horizon); gl.uniform3fv(u.uGlint, c.glint);
    gl.uniform1f(u.uMoonX, water.moonX); gl.uniform1f(u.uGlintW, c.glintW); gl.uniform1f(u.uGlintStr, c.glintStr); gl.uniform1f(u.uFlash, water.flash);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function waterFrame(now) {
    water.raf = 0;
    if (!visible || !water.ok) return;
    // 30 images/s suffisent à une houle ; cela divise par deux le coût du flou des cartes en verre au-dessus
    if (now - water.last >= 32) { water.last = now; try { waterRender((now - water.t0) / 1000); } catch (e) { water.ok = false; return; } }
    if (!reduced) water.raf = requestAnimationFrame(waterFrame);
  }
  function waterStart() { if (!water.ok || water.raf) return; if (reduced) { waterRender(0); waterRender(0); return; } water.raf = requestAnimationFrame(waterFrame); }

  // ---- ciel : étoiles, filantes ---------------------------------------------------------------------------------
  const STAR_VOID = { x0: 37, x1: 64, y0: 0, y1: 48 }; // la lune
  function buildStars(el) {
    if (!el) return;
    const tiers = [[110, 1.3, 2.5, 0.4, 2.3], [45, 2.1, 3.6, 0.55, 1.7]]; // moins qu'à l'origine : le recalcul de style des étoiles était le premier poste de dépense
    let out = "";
    for (const [count, mn, mx, base, tw] of tiers) {
      for (let i = 0; i < count; i++) {
        const left = Math.random() * 100, top = Math.random() * 58;
        if (left > STAR_VOID.x0 && left < STAR_VOID.x1 && top > STAR_VOID.y0 && top < STAR_VOID.y1) { i--; continue; }
        const size = (mn + Math.random() * (mx - mn)).toFixed(2), dur = (tw * (0.7 + Math.random() * 0.7)).toFixed(2), delay = -(Math.random() * dur).toFixed(2), b = (base + Math.random() * 0.2).toFixed(2);
        const warm = Math.random() < 0.07 ? "background:radial-gradient(circle,#fff,#ffcaa0 70%,transparent);" : "";
        out += `<i class="star" style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${size}px;height:${size}px;--tw:${dur}s;--base:${b};animation-delay:${delay}s;${warm}"></i>`;
      }
    }
    el.innerHTML = out;
  }
  function buildShooting(el) {
    if (!el) return;
    const cfg = [{ t: 9, l: 6, d: -1, s: 11 }, { t: 22, l: 30, d: -6, s: 15 }, { t: 5, l: 64, d: -11, s: 18 }];
    el.innerHTML = cfg.map((c) => `<i class="shoot" style="top:${c.t}%;left:${c.l}%;animation-delay:${c.d}s;--sd:${c.s}s"></i>`).join("");
  }

  // ---- éclairs (tempête seulement) ------------------------------------------------------------------------------
  let lightningTimer = null;
  function scheduleLightning() {
    clearTimeout(lightningTimer);
    lightningTimer = setTimeout(() => { if (state === "crit" && visible) { strike(); if (Math.random() < 0.3) setTimeout(strike, 600 + Math.random() * 500); } if (state === "crit") scheduleLightning(); }, 2800 + Math.random() * 4200);
  }
  function drawBolt(svg, xPct) {
    const vw = root.innerWidth, vh = root.innerHeight;
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
    let x = (xPct / 100) * vw, y = -8; const pts = [[x, y]]; const endY = vh * (0.38 + Math.random() * 0.14);
    while (y < endY) { y += 16 + Math.random() * 30; x += (Math.random() - 0.5) * 52; pts.push([x, y]); }
    const main = "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L");
    let branches = ""; const nb = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let b = 0; b < nb; b++) {
      const idx = 2 + Math.floor(Math.random() * Math.max(1, pts.length - 5)); let bx = pts[idx][0], by = pts[idx][1]; const dir = Math.random() < 0.5 ? -1 : 1;
      let bp = "M" + bx.toFixed(1) + " " + by.toFixed(1); const segs = 3 + Math.floor(Math.random() * 3);
      for (let s = 0; s < segs; s++) { bx += dir * (14 + Math.random() * 26); by += 12 + Math.random() * 22; bp += "L" + bx.toFixed(1) + " " + by.toFixed(1); }
      branches += `<path d="${bp}" stroke-width="1.1" opacity="0.7"></path>`;
    }
    svg.innerHTML = `<path d="${main}" stroke-width="2.4"></path>${branches}`;
  }
  function strike() {
    const flash = doc.getElementById("mr-flash"), bolt = doc.getElementById("mr-bolt"); if (!flash) return;
    const x = 20 + Math.random() * 60; flash.style.setProperty("--fx", x + "%");
    if (bolt) drawBolt(bolt, x + (Math.random() - 0.5) * 8);
    for (const [dt, o] of [[0, 0.95], [80, 0.15], [160, 0.7], [240, 0.25], [420, 0]]) setTimeout(() => { flash.style.opacity = o; if (bolt) bolt.style.opacity = o > 0.2 ? Math.min(1, o + 0.1) : 0; if (o > 0.3) water.flashTgt = Math.max(water.flashTgt, o); }, dt);
    setTimeout(() => { doc.body.classList.remove("mr-rumble"); void doc.body.offsetWidth; doc.body.classList.add("mr-rumble"); }, 300 + Math.random() * 900);
  }

  // ---- baleine (nuit calme et crépuscule) ------------------------------------------------------------------------
  const whale = { cv: null, ctx: null, W: 0, H: 0, event: null, particles: [], ripples: [], raf: 0, timer: null, last: 0 };
  function whaleResize() { const cv = whale.cv; if (!cv) return; const dpr = Math.min(root.devicePixelRatio || 1, 1.5); whale.W = cv.clientWidth; whale.H = cv.clientHeight; cv.width = Math.round(whale.W * dpr); cv.height = Math.round(whale.H * dpr); whale.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function bodyPath(c, lift) {
    const y = 0.3 * (1 - lift);
    c.beginPath(); c.moveTo(-0.52, 0.05 + y); c.quadraticCurveTo(-0.3, -0.3 + y, -0.02, -0.275 + y);
    c.quadraticCurveTo(0.03, -0.278 + y, 0.055, -0.355 + y); c.quadraticCurveTo(0.072, -0.36 + y, 0.085, -0.345 + y); c.quadraticCurveTo(0.1, -0.3 + y, 0.14, -0.265 + y);
    c.quadraticCurveTo(0.34, -0.215 + y, 0.52, 0.05 + y); c.closePath();
  }
  function flukePath(c, t) {
    const lift = Math.sin(Math.PI * Math.min(1, t)) * 0.5, y = 0.06 - lift;
    c.beginPath(); c.moveTo(-0.05, 0.42 + y); c.quadraticCurveTo(-0.02, y + 0.1, -0.16, y - 0.02); c.quadraticCurveTo(-0.05, y - 0.055, 0, y - 0.02); c.quadraticCurveTo(0.05, y - 0.055, 0.16, y - 0.02); c.quadraticCurveTo(0.02, y + 0.1, 0.05, 0.42 + y); c.closePath();
  }
  function spawnSplash(x, y, scale, count, vigor, warm) {
    for (let i = 0; i < count; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5, sp = (30 + Math.random() * 72) * vigor * scale; whale.particles.push({ x: x + (Math.random() - 0.5) * 30 * scale, y, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp, r: (0.9 + Math.random() * 1.9) * scale, life: 1, decay: 1.3 + Math.random() * 1.1, warm }); }
    whale.ripples.push({ x, y: y + 2 * scale, rx: 6 * scale, ry: 2 * scale, life: 1, grow: 65 * scale });
  }
  function surface() {
    if (whale.event || !whale.cv || !whale.W) return;
    const fx = 0.18 + Math.random() * 0.64, fy = 0.16 + Math.random() * 0.4;
    whale.event = { x0: fx * whale.W, y: fy * whale.H, dir: Math.random() < 0.5 ? -1 : 1, scale: (0.42 + fy * 0.95) * Math.min(whale.W, 900) * 0.16, t: 0, dur: 7.2, splashed: {} };
    if (!whale.raf) { whale.last = performance.now(); whale.raf = requestAnimationFrame(whaleFrame); }
  }
  function whaleFrame(now) {
    const ctx = whale.ctx, W = whale.W, H = whale.H; const dt = Math.min(0.05, (now - whale.last) / 1000); whale.last = now;
    ctx.clearRect(0, 0, W, H);
    const e = whale.event;
    if (e) {
      e.t += dt / e.dur; const t = e.t, persp = 0.55 + (e.y / H) * 0.8, L = e.scale * persp, x = e.x0 + e.dir * L * 1.55 * t;
      const warm = Math.max(0, 1 - Math.abs(x / W - 0.505) * 6);
      const bodyT = Math.min(1, t / 0.62), lift = Math.sin(Math.PI * bodyT);
      if (t < 0.62) {
        ctx.save(); ctx.translate(x, e.y); ctx.rotate(e.dir * (0.5 - bodyT) * 0.22); ctx.scale(L * e.dir, L);
        ctx.beginPath(); ctx.rect(-0.7, -0.8, 1.4, 0.82); ctx.clip(); bodyPath(ctx, lift);
        const g = ctx.createLinearGradient(0, -0.45, 0, 0.1); g.addColorStop(0, `rgba(${Math.round(26 + warm * 50)},${Math.round(30 + warm * 26)},${Math.round(44 + warm * 10)},0.96)`); g.addColorStop(1, "rgba(6,12,20,0.96)");
        ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = `rgba(${Math.round(160 + warm * 90)},${Math.round(180 + warm * 20)},${Math.round(210 - warm * 60)},${0.2 + warm * 0.35})`; ctx.lineWidth = 0.018; ctx.stroke(); ctx.restore();
        ctx.save(); ctx.translate(x, e.y + 3); ctx.scale(L * e.dir, -L * 0.38); ctx.globalAlpha = 0.07; bodyPath(ctx, lift); ctx.fillStyle = "#04101c"; ctx.fill(); ctx.restore();
      }
      if (t > 0.58 && t < 0.97) {
        const ft = (t - 0.58) / 0.34; ctx.save(); ctx.translate(x - e.dir * L * 0.42, e.y); ctx.rotate(e.dir * (ft - 0.5) * 0.5); ctx.scale(L * e.dir, L);
        ctx.beginPath(); ctx.rect(-0.7, -0.8, 1.4, 0.84); ctx.clip(); flukePath(ctx, ft); ctx.fillStyle = "rgba(8,14,24,0.97)"; ctx.fill(); ctx.restore();
      }
      if (t > 0.06 && !e.splashed.rise) { e.splashed.rise = true; spawnSplash(x, e.y, persp, 26, 0.8, warm); }
      if (t > 0.5 && !e.splashed.dive) { e.splashed.dive = true; spawnSplash(x + e.dir * L * 0.3, e.y, persp, 20, 0.7, warm); }
      if (t > 0.8 && !e.splashed.fluke) { e.splashed.fluke = true; spawnSplash(x - e.dir * L * 0.42, e.y, persp, 34, 1.25, warm); }
      if (t >= 1) whale.event = null;
    }
    whale.particles = whale.particles.filter((p) => p.life > 0);
    for (const p of whale.particles) { p.life -= p.decay * dt; p.vy += 240 * dt; p.x += p.vx * dt; p.y += p.vy * dt; const a = Math.max(0, p.life) * 0.8; ctx.fillStyle = p.warm > 0.4 ? `rgba(255,216,180,${a.toFixed(3)})` : `rgba(205,225,245,${a.toFixed(3)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.284); ctx.fill(); }
    whale.ripples = whale.ripples.filter((r) => r.life > 0);
    for (const r of whale.ripples) { r.life -= dt * 0.55; r.rx += r.grow * dt; r.ry += r.grow * 0.26 * dt; ctx.strokeStyle = `rgba(190,215,235,${(r.life * 0.3).toFixed(3)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, 6.284); ctx.stroke(); }
    if ((whale.event || whale.particles.length || whale.ripples.length) && visible) whale.raf = requestAnimationFrame(whaleFrame); else { whale.raf = 0; ctx.clearRect(0, 0, W, H); }
  }
  function whaleSchedule() {
    clearTimeout(whale.timer);
    whale.timer = setTimeout(() => { if (!reduced && visible && (state === "safe" || state === "warn")) surface(); whaleSchedule(); }, 16000 + Math.random() * 26000);
  }

  // ---- état ------------------------------------------------------------------------------------------------------
  function setState(s) {
    if (!MOODS[s]) s = "safe";
    state = s;
    doc.body.dataset.state = s;
    water.tgt = clone(MOODS[s].water);
    const lab = doc.getElementById("mood"); if (lab) { lab.textContent = MOODS[s].label; lab.dataset.state = s; }
    clearTimeout(lightningTimer);
    if (s === "crit" && !reduced) scheduleLightning();
    if (reduced) waterStart();
  }
  const setLevel = (level) => setState(LEVEL_TO_STATE[level] || "safe");

  function start() {
    if (started || !doc) return; started = true;
    const cv = doc.getElementById("sea");
    if (cv) waterInit(cv);
    buildStars(doc.getElementById("mr-stars")); buildShooting(doc.getElementById("mr-shooting"));
    const fauna = doc.getElementById("fauna");
    if (fauna) { whale.cv = fauna; whale.ctx = fauna.getContext("2d"); whaleResize(); whaleSchedule(); }
    root.addEventListener("resize", () => { waterResize(); whaleResize(); if (reduced) waterStart(); });
    doc.addEventListener("visibilitychange", () => { visible = !doc.hidden; if (visible) { water.last = 0; waterStart(); } });
    setState(doc.body.dataset.state || "safe");
    waterStart();
  }

  AOS.maree = { start, setState, setLevel, strike, surface, MOODS, LEVEL_TO_STATE, get state() { return state; }, get ok() { return water.ok; } };
})(typeof window !== "undefined" ? window : globalThis);
