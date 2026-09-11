/* SEAT 02 — FLOW · Microstructure & Positioning Agent.
   Uses LIVE asset contexts (funding, OI, premium, volume), HISTORICAL funding, and l2 book for held assets.
   Cohort / whale / liquidation-cluster data is NOT available from the public info API → reported UNKNOWN, never invented. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, stats } = AOS.util;

  function run(ctx) {
    const { features, snapshot, history } = ctx;
    const assets = snapshot?.meta?.assets || {};
    const coins = new Set(["BTC", "ETH", "SOL", ...(snapshot?.positions || []).map((p) => p.coin)]);
    const votes = {}, heat = [], oiStress = [];
    for (const c of coins) {
      const a = assets[c];
      const fh = history?.funding?.[c] || [];
      const f = features?.byCoin?.[c];
      if (!a) { votes[c] = { dir: 0, confidence: 0, reasons: ["Contexte d'actif indisponible"], prov: "UNKNOWN" }; continue; }
      const fNow = a.fundingHourly;
      const f24 = stats.mean(fh.slice(-24).map((r) => r.rate)), f7d = stats.mean(fh.slice(-168).map((r) => r.rate)), f30d = stats.mean(fh.map((r) => r.rate));
      const fz = fh.length > 48 ? stats.zscore(fNow, fh.map((r) => r.rate)) : NaN;
      const oiUsd = a.openInterestUsd, vol24 = a.dayNtlVlm;
      const oiTurn = isNum(oiUsd) && isNum(vol24) && vol24 > 0 ? oiUsd / vol24 : NaN; // OI / daily volume (crowdedness proxy)
      const prem = a.premium;
      const l2 = history?.l2?.[c];
      const trendUp = f?.d1 ? f.price > f.d1.ema50 : null;
      // positioning score: contrarian when funding is extreme, confirming when mild and aligned with trend
      let dir = 0; const reasons = [];
      if (isNum(fz)) {
        if (fz > 2) { dir -= 0.5; reasons.push(`Funding extrême positif (z=${fz.toFixed(1)}) → longs surpeuplés`); }
        else if (fz < -2) { dir += 0.5; reasons.push(`Funding extrême négatif (z=${fz.toFixed(1)}) → shorts surpeuplés, squeeze possible`); }
        else if (isNum(f7d)) { const mild = clamp(f7d / 0.00002, -1, 1); dir += (trendUp === true ? 0.2 : trendUp === false ? -0.2 : 0) * (1 - Math.abs(mild)); reasons.push(`Funding 7j ${(f7d * 100 * 24).toFixed(3)}%/j, non extrême`); }
      } else if (isNum(fNow)) reasons.push(`Funding ${(fNow * 100).toFixed(4)}%/h (historique insuffisant pour un z-score)`);
      if (isNum(prem)) { if (Math.abs(prem) > 0.001) { dir -= clamp(prem / 0.003, -0.3, 0.3); reasons.push(`Basis mark/oracle ${(prem * 100).toFixed(2)}% ${prem > 0 ? "(perp cher → pression acheteuse tendue)" : "(perp décoté → pression vendeuse)"}`); } }
      if (isNum(oiTurn)) { if (oiTurn > 1.2) reasons.push(`OI/volume ${oiTurn.toFixed(2)} : positionnement lourd, cascades plus probables`); oiStress.push({ coin: c, oiUsd, vol24, ratio: oiTurn, change24h: a.change24h, fundingHourly: fNow }); }
      if (l2 && isNum(l2.imbalance)) { dir += clamp(l2.imbalance, -0.3, 0.3) * 0.5; reasons.push(`Carnet (10 niveaux) ${l2.imbalance > 0 ? "biais acheteur" : "biais vendeur"} ${(l2.imbalance * 100).toFixed(0)}%`); }
      // squeeze probability heuristic: crowd against the trend
      let squeeze = 0;
      if (isNum(fz) && trendUp !== null) { if (fz < -1 && trendUp) squeeze = clamp(0.3 + -fz * 0.15, 0, 0.8); if (fz > 1 && !trendUp) squeeze = clamp(0.3 + fz * 0.15, 0, 0.8); }
      votes[c] = { dir: clamp(dir, -1, 1), confidence: clamp(Math.abs(dir) * (isNum(fz) ? 0.9 : 0.5), 0.05, 0.85), reasons, prov: isNum(fz) ? "CALCULATED" : "ESTIMATED" };
      heat.push({ coin: c, now: fNow, h24: f24, d7: f7d, d30: f30d, z: fz, squeezeProb: squeeze, squeezeSide: squeeze ? (trendUp ? "LONG squeeze (shorts piégés)" : "SHORT squeeze (longs piégés)") : null, oiUsd, oiTurn, premium: prem, l2: l2 || null, prov: fh.length ? "HISTORICAL" : "LIVE" });
    }
    const leverageStress = (() => {
      const rows = oiStress.filter((r) => isNum(r.ratio));
      if (!rows.length) return { value: NaN, label: "UNKNOWN" };
      const v = clamp(stats.mean(rows.map((r) => r.ratio)) / 2, 0, 1);
      return { value: Math.round(v * 100), label: v > 0.7 ? "HIGH" : v > 0.4 ? "MODERATE" : "LOW", prov: "CALCULATED" };
    })();
    const mdir = (votes.BTC?.dir || 0) * 0.6 + (votes.ETH?.dir || 0) * 0.4;
    return {
      agent: "FLOW", seat: "02", role: "Microstructure & Positioning", timestamp: new Date().toISOString(),
      direction: mdir > 0.15 ? "bullish" : mdir < -0.15 ? "bearish" : "neutral", confidence: clamp(Math.abs(mdir), 0.05, 0.85),
      expected_return: NaN, expected_loss: NaN, time_horizon: "2d",
      signals: [...(votes.BTC?.reasons || []), ...(votes.ETH?.reasons || []).slice(0, 1)],
      risks: leverageStress.label === "HIGH" ? ["Positionnement lourd : cascades de liquidations plus probables"] : [],
      invalidation: ["Normalisation du funding vers sa moyenne 30j", "Retournement du carnet sur les actifs détenus"],
      recommendation: mdir > 0.15 ? "LONG TILT" : mdir < -0.15 ? "SHORT TILT" : "NEUTRAL", position_size_modifier: leverageStress.label === "HIGH" ? 0.7 : 1,
      votes, heatmap: heat, oiStress, leverageStress,
      unknown: ["Cohortes de traders Hyperliquid (nécessite un indexeur des comptes)", "Clusters de liquidation marché (source externe requise)", "Flux stablecoins / Coinbase premium (source externe requise)", "Taker buy/sell ratio (non exposé par l'endpoint info)"],
      prov: "CALCULATED",
    };
  }
  AOS.agents = AOS.agents || {};
  AOS.agents.FLOW = { run };
})(typeof window !== "undefined" ? window : globalThis);
