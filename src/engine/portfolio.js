/* Personal Alpha OS — Portfolio engine (SEAT 04 support): exposures, betas, concentration, correlation-aware risk,
   false-hedge detection, diversification (apparent vs real). All CALCULATED. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, stats, clamp } = AOS.util;

  function covariance(coins, corrM, vols) {
    // annualised covariance matrix
    const n = coins.length;
    const C = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const rho = i === j ? 1 : isNum(corrM?.[i]?.[j]) ? corrM[i][j] : 0.6; // unknown correlation defaults to 0.6 (crypto prior)
      const vi = isNum(vols[i]) ? vols[i] : 0.8, vj = isNum(vols[j]) ? vols[j] : 0.8;
      C[i][j] = rho * vi * vj;
    }
    return C;
  }
  const portVol = (w, C) => { let s = 0; for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) s += w[i] * w[j] * C[i][j]; return Math.sqrt(Math.max(s, 0)); };

  /**
   * @param positions   normalized positions (optionally hypothetical)
   * @param account     normalized account
   * @param features    output of AOS.features.compute
   */
  function analyze(positions, account, features, opts = {}) {
    const equity = account?.equity;
    const pos = (positions || []).filter((p) => isNum(p.notional) && p.notional > 0);
    const gross = stats.sum(pos.map((p) => p.notional));
    const net = stats.sum(pos.map((p) => (p.side === "LONG" ? 1 : -1) * p.notional));
    const longNtl = stats.sum(pos.filter((p) => p.side === "LONG").map((p) => p.notional));
    const shortNtl = stats.sum(pos.filter((p) => p.side === "SHORT").map((p) => p.notional));
    const byAsset = pos.map((p) => ({ coin: p.coin, side: p.side, notional: p.notional, share: gross > 0 ? p.notional / gross : NaN, weight: isNum(equity) && equity > 0 ? ((p.side === "LONG" ? 1 : -1) * p.notional) / equity : NaN }));
    const shares = byAsset.map((a) => a.share).filter(isNum);
    const hhi = stats.sum(shares.map((s) => s * s));
    const maxShare = stats.max(shares);
    // betas & vols
    const coins = pos.map((p) => p.coin);
    const bBTC = coins.map((c) => features?.corr?.betaBTC?.[c] ?? (c === "BTC" ? 1 : NaN));
    const bETH = coins.map((c) => features?.corr?.betaETH?.[c] ?? (c === "ETH" ? 1 : NaN));
    const w = pos.map((p) => (isNum(equity) && equity > 0 ? ((p.side === "LONG" ? 1 : -1) * p.notional) / equity : 0));
    const betaBTC = stats.sum(w.map((x, i) => x * (isNum(bBTC[i]) ? bBTC[i] : 1)));
    const betaETH = stats.sum(w.map((x, i) => x * (isNum(bETH[i]) ? bETH[i] : 1)));
    const deltaBTC = isNum(features?.byCoin?.BTC?.price) && features.byCoin.BTC.price > 0 ? (betaBTC * (equity || 0)) / features.byCoin.BTC.price : NaN; // BTC-equivalent delta in BTC units
    // correlation-aware volatility (normal & stress)
    const cc = features?.corr?.coins || [];
    const idx = coins.map((c) => cc.indexOf(c));
    const sub = (M) => coins.map((_, i) => coins.map((_, j) => (idx[i] >= 0 && idx[j] >= 0 ? M[idx[i]][idx[j]] : NaN)));
    const vols = coins.map((c) => features?.byCoin?.[c]?.vol);
    const Cn = covariance(coins, sub(features?.corr?.normal || []), vols);
    const Cs = covariance(coins, sub(features?.corr?.stress || []), vols);
    // stress = the worse of "everything correlates" (hurts directional books) and "hedges decorrelate" (hurts long/short books)
    const C0 = covariance(coins, coins.map((_, i) => coins.map((_, j) => (i === j ? 1 : 0))), vols);
    const volNormal = portVol(w, Cn), volStress = Math.max(portVol(w, Cs), portVol(w, C0));
    const C1 = covariance(coins, coins.map(() => coins.map(() => 1)), vols);
    const volCorr1 = portVol(w, C1);
    const weightedAvgVol = stats.sum(w.map((x, i) => Math.abs(x) * (isNum(vols[i]) ? vols[i] : 0.8)));
    const diversificationRatio = volNormal > 0 ? weightedAvgVol / volNormal : NaN; // 1 = no diversification benefit
    const apparentDiversification = pos.length > 1 ? 1 - hhi : 0;
    // false hedges: opposite sides with high correlation
    const falseHedges = [];
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      if (pos[i].side === pos[j].side) continue;
      const rho = idx[i] >= 0 && idx[j] >= 0 ? features.corr.normal[idx[i]][idx[j]] : NaN;
      if (isNum(rho) && rho > 0.6) {
        const a = pos[i], b = pos[j];
        const long = a.side === "LONG" ? a : b, short = a.side === "LONG" ? b : a;
        const netUsd = long.notional - short.notional;
        falseHedges.push({ long: long.coin, short: short.coin, corr: rho, netUsd, text: `Long ${long.coin} / Short ${short.coin} : corrélation ${rho.toFixed(2)}. Ce n'est pas deux risques indépendants mais un pari relatif ${long.coin} vs ${short.coin} + une exposition nette de ${netUsd >= 0 ? "+" : "−"}$${Math.abs(netUsd).toFixed(0)}. En stress (corr → 1), le hedge protège ${Math.round(clamp(short.notional / Math.max(long.notional, 1), 0, 1) * 100)}% de la jambe longue au mieux.` });
      }
    }
    // strategy tagging (heuristic, informational)
    const strategies = [];
    const has = (c, s) => pos.find((p) => p.coin === c && p.side === s);
    if (has("BTC", "LONG")) strategies.push("Core long BTC");
    if (has("SOL", "LONG")) strategies.push("Long SOL (beta élevé)");
    if (has("ETH", "SHORT") && (has("BTC", "LONG") || has("SOL", "LONG"))) strategies.push("Pair / hedge : short ETH vs longs");
    if (pos.filter((p) => p.side === "LONG").length >= 3) strategies.push("Sleeve longs multi-actifs");
    if (pos.some((p) => !["BTC", "ETH", "SOL"].includes(p.coin))) strategies.push("Sleeve tactique alts");

    const grossLev = isNum(equity) && equity > 0 ? gross / equity : NaN;
    const netLev = isNum(equity) && equity > 0 ? net / equity : NaN;
    // correlation adjusted "effective independent bets"
    const effBets = pos.length && isNum(diversificationRatio) ? clamp(diversificationRatio ** 2, 1, pos.length) : pos.length;
    return {
      count: pos.length, gross, net, longNtl, shortNtl, byAsset, hhi, maxShare, grossLev, netLev, betaBTC, betaETH, deltaBTC, w, coins, vols,
      volNormal, volStress, volCorr1, weightedAvgVol, diversificationRatio, apparentDiversification, effectiveBets: effBets, falseHedges, strategies,
      directional: net > 0 ? "NET LONG" : net < 0 ? "NET SHORT" : "FLAT",
      dailyVol: volNormal / Math.sqrt(365), dailyVolStress: volStress / Math.sqrt(365),
      var95_1d: isNum(equity) ? 1.645 * (volNormal / Math.sqrt(365)) * equity : NaN,
      cvar95_1d: isNum(equity) ? 2.063 * (volNormal / Math.sqrt(365)) * equity : NaN,
      cvar95_1d_stress: isNum(equity) ? 2.063 * (volStress / Math.sqrt(365)) * equity : NaN,
      prov: features?.corr?.n > 100 ? "CALCULATED" : "ESTIMATED",
    };
  }

  AOS.portfolio = { analyze, covariance, portVol };
})(typeof window !== "undefined" ? window : globalThis);
