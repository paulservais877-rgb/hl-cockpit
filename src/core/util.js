/* Personal Alpha OS — core utilities (no DOM access; shared by browser and node tests) */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});

  // ---- provenance tags (anti-hallucination) -------------------------------
  const PROV = Object.freeze({
    LIVE: "LIVE",
    CALCULATED: "CALCULATED",
    HISTORICAL: "HISTORICAL",
    ESTIMATED: "ESTIMATED",
    UNKNOWN: "UNKNOWN",
  });

  // ---- numbers ---------------------------------------------------------------
  const num = (v) => {
    if (v === null || v === undefined) return NaN;
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : NaN;
  };
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  const round = (x, d = 2) => (isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : NaN);

  // ---- formatting ---------------------------------------------------------
  const fmt = {
    usd(x, d = 0) {
      if (!isNum(x)) return "—";
      const a = Math.abs(x);
      const opts = { maximumFractionDigits: a < 100 ? Math.max(d, 2) : d, minimumFractionDigits: 0 };
      return (x < 0 ? "−" : "") + "$" + a.toLocaleString("en-US", opts);
    },
    usdSigned(x, d = 0) {
      if (!isNum(x)) return "—";
      return (x > 0 ? "+" : x < 0 ? "−" : "") + "$" + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: Math.abs(x) < 100 ? Math.max(d, 2) : d });
    },
    px(x) {
      if (!isNum(x)) return "—";
      const a = Math.abs(x);
      const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 7;
      return x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
    },
    pct(x, d = 1, signed = false) {
      if (!isNum(x)) return "—";
      const v = x * 100;
      const s = signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : v < 0 ? "−" : "";
      return s + Math.abs(v).toFixed(d) + "%";
    },
    bp(x, d = 2) {
      if (!isNum(x)) return "—";
      const v = x * 1e4;
      return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + " bp";
    },
    qty(x) {
      if (!isNum(x)) return "—";
      const a = Math.abs(x);
      const d = a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 4 : 6;
      return x.toLocaleString("en-US", { maximumFractionDigits: d });
    },
    x(x, d = 1) {
      return isNum(x) ? x.toFixed(d) + "×" : "—";
    },
    int(x) {
      return isNum(x) ? Math.round(x).toLocaleString("en-US") : "—";
    },
    age(ms) {
      if (!isNum(ms) || ms < 0) return "—";
      const s = Math.floor(ms / 1000);
      if (s < 60) return s + "s";
      const m = Math.floor(s / 60);
      if (m < 60) return m + "m" + String(s % 60).padStart(2, "0") + "s";
      const h = Math.floor(m / 60);
      if (h < 48) return h + "h" + String(m % 60).padStart(2, "0");
      return Math.floor(h / 24) + "j";
    },
    time(ts) {
      if (!isNum(ts)) return "—";
      const d = new Date(ts);
      return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    },
    date(ts) {
      if (!isNum(ts)) return "—";
      return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    },
    datetime(ts) {
      if (!isNum(ts)) return "—";
      const d = new Date(ts);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    },
    dur(ms) {
      if (!isNum(ms)) return "—";
      const h = ms / 3.6e6;
      if (h < 1) return Math.round(ms / 6e4) + "min";
      if (h < 48) return h.toFixed(1) + "h";
      return (h / 24).toFixed(1) + "j";
    },
  };

  // ---- statistics ------------------------------------------------------------
  const stats = {
    mean(a) {
      const v = a.filter(isNum);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
    },
    stdev(a) {
      const v = a.filter(isNum);
      if (v.length < 2) return NaN;
      const m = stats.mean(v);
      return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
    },
    sum(a) {
      return a.filter(isNum).reduce((s, x) => s + x, 0);
    },
    max(a) {
      const v = a.filter(isNum);
      return v.length ? Math.max(...v) : NaN;
    },
    min(a) {
      const v = a.filter(isNum);
      return v.length ? Math.min(...v) : NaN;
    },
    quantile(a, q) {
      const v = a.filter(isNum).sort((x, y) => x - y);
      if (!v.length) return NaN;
      const pos = (v.length - 1) * q;
      const lo = Math.floor(pos), hi = Math.ceil(pos);
      return v[lo] + (v[hi] - v[lo]) * (pos - lo);
    },
    corr(a, b) {
      const n = Math.min(a.length, b.length);
      if (n < 5) return NaN;
      const xa = a.slice(-n), xb = b.slice(-n);
      const ma = stats.mean(xa), mb = stats.mean(xb);
      let sab = 0, saa = 0, sbb = 0;
      for (let i = 0; i < n; i++) {
        if (!isNum(xa[i]) || !isNum(xb[i])) continue;
        const da = xa[i] - ma, db = xb[i] - mb;
        sab += da * db; saa += da * da; sbb += db * db;
      }
      return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN;
    },
    beta(a, b) {
      // beta of a with respect to b
      const n = Math.min(a.length, b.length);
      if (n < 5) return NaN;
      const xa = a.slice(-n), xb = b.slice(-n);
      const ma = stats.mean(xa), mb = stats.mean(xb);
      let sab = 0, sbb = 0;
      for (let i = 0; i < n; i++) {
        if (!isNum(xa[i]) || !isNum(xb[i])) continue;
        sab += (xa[i] - ma) * (xb[i] - mb);
        sbb += (xb[i] - mb) ** 2;
      }
      return sbb > 0 ? sab / sbb : NaN;
    },
    zscore(x, a) {
      const m = stats.mean(a), s = stats.stdev(a);
      return isNum(s) && s > 0 ? (x - m) / s : NaN;
    },
    // Cholesky decomposition of a symmetric positive semi-definite matrix (with jitter)
    cholesky(M) {
      const n = M.length;
      const L = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
          let s = M[i][j];
          for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
          if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-9));
          else L[i][j] = s / L[j][j];
        }
      }
      return L;
    },
    // Box-Muller standard normal
    randn() {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // Standard normal CDF (Abramowitz-Stegun)
    normCdf(x) {
      const t = 1 / (1 + 0.2316419 * Math.abs(x));
      const d = 0.3989423 * Math.exp(-x * x / 2);
      const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
      return x > 0 ? 1 - p : p;
    },
  };

  // ---- misc ------------------------------------------------------------------
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const nowMs = () => Date.now();
  const H = 3600e3, D = 24 * H;
  const deepFreeze = (o) => { Object.freeze(o); Object.values(o).forEach((v) => v && typeof v === "object" && !Object.isFrozen(v) && deepFreeze(v)); return o; };
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const groupBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); (m[k] = m[k] || []).push(x); return m; }, {});
  const sortBy = (arr, fn, desc = false) => arr.slice().sort((a, b) => (desc ? -1 : 1) * (fn(a) < fn(b) ? -1 : fn(a) > fn(b) ? 1 : 0));

  // Uncertainty label from a sample size / dispersion (NO FALSE PRECISION)
  const uncertainty = (n, minGood = 60, minMed = 20) => (n >= minGood ? "LOW" : n >= minMed ? "MEDIUM" : "HIGH");

  AOS.util = { PROV, num, isNum, clamp, sign, round, fmt, stats, uid, nowMs, H, D, deepFreeze, escapeHtml, groupBy, sortBy, uncertainty };
})(typeof window !== "undefined" ? window : globalThis);
