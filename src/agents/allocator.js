/* SEAT 04 — ALLOCATOR · Portfolio & Capital Allocation Agent. Judges trades by their effect on the whole book. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp } = AOS.util;

  function run(ctx) {
    const { features, snapshot, portfolio, settings } = ctx;
    const pf = portfolio || {};
    const votes = {};
    const maxConc = settings?.risk?.maxConcentration || 0.6;
    const coins = new Set(["BTC", "ETH", "SOL", ...(snapshot?.positions || []).map((p) => p.coin)]);
    const cc = features?.corr?.coins || [];
    for (const c of coins) {
      const held = pf.byAsset?.find((a) => a.coin === c);
      const reasons = [];
      let dir = 0, conf = 0.3;
      // concentration: lean against adding to an already dominant leg
      if (held && isNum(held.share) && held.share > maxConc) { dir -= 0.6 * (held.side === "LONG" ? 1 : -1); reasons.push(`${c} = ${(held.share * 100).toFixed(0)}% de l'exposition brute (> ${maxConc * 100}%) → réduire, pas renforcer`); conf = 0.7; }
      // net direction: adding in the direction of the dominant book risk is penalised when stress vol is high
      const i = cc.indexOf(c);
      const corrToBook = i >= 0 ? (pf.byAsset || []).reduce((s, a) => { const j = cc.indexOf(a.coin); const rho = j >= 0 ? features.corr.normal[i][j] : NaN; return s + (isNum(rho) ? rho * (a.weight || 0) : 0); }, 0) : NaN;
      if (isNum(corrToBook) && Math.abs(corrToBook) > 0.5) { dir -= clamp(corrToBook, -1, 1) * 0.4; reasons.push(`Corrélation pondérée au livre ${corrToBook.toFixed(2)} : un ${corrToBook > 0 ? "long" : "short"} ${c} ajoute du risque déjà présent`); }
      if (isNum(pf.grossLev) && pf.grossLev > 4) { conf = Math.max(conf, 0.6); reasons.push(`Levier brut ${pf.grossLev.toFixed(1)}× : privilégier des trades qui réduisent le net`); }
      if (!reasons.length) reasons.push("Pas de contrainte de portefeuille spécifique sur cet actif");
      votes[c] = { dir: clamp(dir, -1, 1), confidence: conf, reasons, prov: pf.prov || "ESTIMATED" };
    }
    const hedgeText = (pf.falseHedges || []).map((h) => h.text);
    const div = isNum(pf.diversificationRatio) ? pf.diversificationRatio : NaN;
    return {
      agent: "ALLOCATOR", seat: "04", role: "Portfolio & Allocation", timestamp: new Date().toISOString(),
      direction: pf.directional === "NET LONG" ? "bullish" : pf.directional === "NET SHORT" ? "bearish" : "neutral", confidence: 0.5,
      expected_return: NaN, expected_loss: isNum(pf.cvar95_1d_stress) && isNum(snapshot?.account?.equity) ? -pf.cvar95_1d_stress / snapshot.account.equity : NaN, time_horizon: "portfolio",
      signals: [
        `Exposition nette ${AOS.util.fmt.usdSigned(pf.net)} · brute ${AOS.util.fmt.usd(pf.gross)} · levier brut ${AOS.util.fmt.x(pf.grossLev)}`,
        `β BTC ${isNum(pf.betaBTC) ? pf.betaBTC.toFixed(2) : "—"} · β ETH ${isNum(pf.betaETH) ? pf.betaETH.toFixed(2) : "—"} · delta ≈ ${isNum(pf.deltaBTC) ? pf.deltaBTC.toFixed(3) + " BTC" : "—"}`,
        `Diversification réelle ${isNum(div) ? div.toFixed(2) : "—"} (paris indépendants ≈ ${isNum(pf.effectiveBets) ? pf.effectiveBets.toFixed(1) : "—"} sur ${pf.count || 0}) · apparente ${isNum(pf.apparentDiversification) ? (pf.apparentDiversification * 100).toFixed(0) + "%" : "—"}`,
        `Vol portefeuille ${AOS.util.fmt.pct(pf.volNormal)} normal · ${AOS.util.fmt.pct(pf.volStress)} stress · ${AOS.util.fmt.pct(pf.volCorr1)} corr→1`,
      ],
      risks: hedgeText.length ? hedgeText : ["Aucun faux hedge détecté"],
      invalidation: ["Changement de corrélation 7j vs 30j > 0.3", "Concentration > seuil après un mouvement de prix"],
      recommendation: isNum(pf.maxShare) && pf.maxShare > maxConc ? "REBALANCE" : "HOLD STRUCTURE",
      position_size_modifier: isNum(div) ? clamp(1 - (1 - 1 / Math.max(div, 1)) * 0.5, 0.6, 1) : 0.8,
      votes, strategies: pf.strategies || [], falseHedges: pf.falseHedges || [], prov: pf.prov || "ESTIMATED",
    };
  }
  AOS.agents = AOS.agents || {};
  AOS.agents.ALLOCATOR = { run };
})(typeof window !== "undefined" ? window : globalThis);
