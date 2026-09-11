/* Personal Alpha OS — Probability cone (Monte-Carlo, correlated lognormal, zero drift, funding drag, liquidation absorbing).
   A DISTRIBUTION, not a prediction: reported as P10/P25/P50/P75/P90 and P(liquidation) per horizon. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, stats } = AOS.util;

  function seeded(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /**
   * @param positions  live positions
   * @param account    live account
   * @param features   features (vols, correlations)
   * @param model      margin model from AOS.risk.marginModel
   * @param opts       {paths=1500, horizons=[1,7,30,90], seed, fundingPerDay}
   */
  function simulate(positions, account, features, model, opts = {}) {
    const equity0 = account?.equity;
    if (!isNum(equity0) || equity0 <= 0) return { ok: false, reason: "equity inconnue" };
    const pos = (positions || []).filter((p) => isNum(p.mark) && isNum(p.szi));
    const horizons = opts.horizons || [1, 7, 30, 90];
    const maxH = Math.max(...horizons);
    const N = opts.paths || 1500;
    const r = seeded(opts.seed || 1234567);
    const coins = pos.map((p) => p.coin);
    const vols = coins.map((c) => { const v = features?.byCoin?.[c]?.vol; return isNum(v) ? v : 0.8; });
    const cc = features?.corr?.coins || [];
    const idx = coins.map((c) => cc.indexOf(c));
    const n = coins.length;
    const corr = coins.map((_, i) => coins.map((_, j) => (i === j ? 1 : idx[i] >= 0 && idx[j] >= 0 && isNum(features.corr.normal[idx[i]][idx[j]]) ? features.corr.normal[idx[i]][idx[j]] : 0.6)));
    const L = n ? stats.cholesky(corr) : [];
    const dVol = vols.map((v) => v / Math.sqrt(365));
    const fundingPerDay = isNum(opts.fundingPerDay) ? opts.fundingPerDay : 0;
    const mmRates = pos.map((p) => (isNum(p.mmRate) ? p.mmRate : 0.05) * (p.marginMode === "isolated" ? 1 : model?.scale || 1));
    const results = Object.fromEntries(horizons.map((h) => [h, []]));
    const liq = Object.fromEntries(horizons.map((h) => [h, 0]));
    const z = new Array(n), e = new Array(n);
    for (let path = 0; path < N; path++) {
      const cum = new Array(n).fill(0);
      let equity = equity0, dead = false, deadValue = 0;
      for (let d = 1; d <= maxH; d++) {
        if (!dead) {
          for (let i = 0; i < n; i++) z[i] = gauss(r);
          for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k <= i; k++) s += L[i][k] * z[k]; e[i] = s; }
          let pnl = 0, mm = 0;
          for (let i = 0; i < n; i++) {
            cum[i] += dVol[i] * e[i] - 0.5 * dVol[i] * dVol[i];
            const px = pos[i].mark * Math.exp(cum[i]);
            pnl += pos[i].szi * (px - pos[i].mark);
            mm += pos[i].absSize * px * mmRates[i];
          }
          equity = equity0 + pnl + fundingPerDay * d;
          if (equity <= mm) { dead = true; deadValue = Math.max(0, mm * 0.5); equity = deadValue; }
        }
        if (results[d]) { results[d].push(equity); if (dead) liq[d]++; }
      }
    }
    const q = (arr) => ({ p10: stats.quantile(arr, 0.1), p25: stats.quantile(arr, 0.25), p50: stats.quantile(arr, 0.5), p75: stats.quantile(arr, 0.75), p90: stats.quantile(arr, 0.9), mean: stats.mean(arr) });
    const out = horizons.map((h) => ({ horizon: h, ...q(results[h]), pLiq: liq[h] / N, pLoss: results[h].filter((v) => v < equity0).length / N }));
    return { ok: true, equity0, horizons: out, paths: N, vols, coins, corrUsed: corr, prov: n && features?.corr?.n > 100 ? "CALCULATED" : "ESTIMATED", note: "Drift nul, vol réalisée 30j, corrélations 30j (1h), funding constant. Distribution, pas prévision." };
  }

  AOS.cone = { simulate, seeded };
})(typeof window !== "undefined" ? window : globalThis);
