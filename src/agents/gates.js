/* Personal Alpha OS — RISK GATE. Seven mandatory gates before any trade proposal, plus the position sizing engine
   (fractional Kelly, never full Kelly, capped by the dynamic risk budget and the liquidation gate). */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, fmt, stats } = AOS.util;

  /** Position sizing. Returns qty and the reasoning (Kelly comparison, budget, modifiers). */
  function size(opp, ctx, { disagreement = 0, modifiers = [] } = {}) {
    const { snapshot, risk, settings } = ctx;
    const equity = snapshot?.account?.equity;
    const fw = settings?.firewall || {};
    const tradingCapital = isNum(fw.tradingCapital) && fw.tradingCapital > 0 ? Math.min(fw.tradingCapital, equity || fw.tradingCapital) : equity;
    if (!isNum(tradingCapital) || tradingCapital <= 0 || !isNum(opp.risk) || opp.risk <= 0) return null;
    const budget = risk?.budget || { riskPerTrade: 0.01 };
    const kellyFull = opp.pWin - (1 - opp.pWin) / opp.rr; // fraction of capital to risk per unit of R
    const kelly = { full: kellyFull, k10: 0.1 * kellyFull, k25: 0.25 * kellyFull, k50: 0.5 * kellyFull };
    const modAvg = modifiers.length ? stats.mean(modifiers) : 1;
    const diMult = 1 - clamp(disagreement, 0, 1) * 0.6;
    const budgetRisk = budget.riskPerTrade * tradingCapital * modAvg * diMult;
    const kellyRisk = Math.max(0, kelly.k25) * tradingCapital;
    const chosenRisk = Math.max(0, Math.min(budgetRisk, kellyRisk > 0 ? kellyRisk : budgetRisk));
    const qty = chosenRisk / opp.risk;
    const notional = qty * opp.entry;
    return {
      tradingCapital, riskUsd: chosenRisk, qty, notional, kelly, kellyRiskUsd: { k10: Math.max(0, kelly.k10) * tradingCapital, k25: kellyRisk, k50: Math.max(0, kelly.k50) * tradingCapital },
      budgetRiskUsd: budgetRisk, riskPerTrade: budget.riskPerTrade, modifiers: modAvg, disagreementMult: diMult,
      chosen: kellyRisk > 0 && kellyRisk < budgetRisk ? "0.25 Kelly" : "Risk budget", why: `Risque ${fmt.usd(chosenRisk)} = min(budget ${fmt.usd(budgetRisk)}, 0.25·Kelly ${fmt.usd(kellyRisk)}) · désaccord ×${diMult.toFixed(2)} · agents ×${modAvg.toFixed(2)}`,
      prov: "CALCULATED",
    };
  }

  /** Evaluate the seven gates for an opportunity at a given size. */
  function evaluate(opp, ctx, sizing, review) {
    const { snapshot, features, portfolio, risk, settings } = ctx;
    const R = settings?.risk || {};
    const gates = [];
    const g = (name, pass, detail, hard = true) => gates.push({ name, pass: !!pass, detail, hard });
    const equity = snapshot?.account?.equity;
    // 1. EDGE
    g("EDGE", opp.evR >= 0.15, `EV après coûts ${opp.evR.toFixed(2)}R (p ${Math.round(opp.pWin * 100)}% · RR ${opp.rr.toFixed(1)} · coûts ${opp.costR.toFixed(2)}R)`);
    let impact = null;
    if (sizing && sizing.qty > 0) {
      impact = AOS.simulate.impact(snapshot, features, { portfolio, risk }, { coin: opp.coin, side: opp.side, qty: sizing.qty, pWin: opp.pWin, horizonDays: opp.horizonDays }, { invalidation: opp.invalidation, target: opp.target }, settings);
    }
    // 2. PORTFOLIO (includes "is the risk budget large enough for a useful trade?")
    const minUseful = Math.max(0.0025 * (equity || 0), 5);
    if (impact && sizing && sizing.riskUsd < minUseful) {
      g("PORTFOLIO", false, `Budget de risque ${fmt.usd(sizing.riskUsd)} < ${fmt.usd(minUseful)} (0,25 % de l'equity) : le niveau de risque actuel ne laisse pas de place à un nouveau trade utile`);
    } else if (impact) {
      const dStress = impact.deltas.stressLoss, dConc = impact.portfolioAfter.maxShare;
      const stressOk = !isNum(dStress) || dStress >= -0.02 * (equity || 1) || (impact.riskAfter.combined && !impact.riskAfter.combined.liquidated && impact.deltas.netExposure * (opp.side === "LONG" ? 1 : -1) < 0);
      const concOk = !isNum(dConc) || dConc <= (R.maxConcentration || 0.6) || dConc <= (portfolio?.maxShare || 0) + 1e-9;
      g("PORTFOLIO", stressOk && concOk, `Δ perte stress ${fmt.usdSigned(dStress)} · concentration après ${fmt.pct(dConc, 0)} · Δ net ${fmt.usdSigned(impact.deltas.netExposure)}`);
    } else g("PORTFOLIO", false, "Impact non calculable (taille nulle)");
    // 3. LIQUIDITY
    const a = snapshot?.meta?.assets?.[opp.coin] || {};
    const ntl = sizing?.notional;
    const liqOk = !isNum(ntl) || ((!isNum(a.dayNtlVlm) || ntl <= 0.005 * a.dayNtlVlm) && (!isNum(a.openInterestUsd) || ntl <= 0.02 * a.openInterestUsd));
    g("LIQUIDITY", liqOk, `Notional ${fmt.usd(ntl)} vs volume 24h ${fmt.usd(a.dayNtlVlm)} · OI ${fmt.usd(a.openInterestUsd)}${isNum(a.dayNtlVlm) ? " (" + (ntl / a.dayNtlVlm * 100).toFixed(3) + "% du volume)" : ""}`);
    // 4. FUNDING
    const expGain = opp.pWin * opp.rr; // in R
    const fundingR = isNum(opp.fundingCostPct) ? opp.fundingCostPct / opp.riskPct : 0;
    g("FUNDING", fundingR <= 0.3 * expGain, `Funding sur ${opp.horizonDays}j ≈ ${fundingR.toFixed(2)}R vs gain attendu ${expGain.toFixed(2)}R`);
    // 5. CORRELATION
    const cc = features?.corr?.coins || []; const i = cc.indexOf(opp.coin);
    const corrToBook = i >= 0 ? (portfolio?.byAsset || []).reduce((s, p) => { const j = cc.indexOf(p.coin); const rho = j >= 0 ? features.corr.normal[i][j] : NaN; return s + (isNum(rho) ? rho * (p.weight || 0) : 0); }, 0) : 0;
    const sideSign = opp.side === "LONG" ? 1 : -1;
    const corrAdds = corrToBook * sideSign;
    g("CORRELATION", corrAdds <= 0.75 || (impact && impact.deltas.correlation <= 0.02), `Corrélation pondérée au livre dans le sens du trade ${corrAdds.toFixed(2)} (seuil 0.75)`);
    // 6. LIQUIDATION
    if (impact) {
      const worst = impact.riskAfter.worstLiq?.liqDist, br = impact.after.account.bufferRatio;
      const ok = (!isNum(worst) || worst >= (R.minLiqDistance || 0.15)) && (!isNum(br) || br >= (R.minBufferRatio || 0.25)) && impact.marginOk;
      g("LIQUIDATION", ok, `Pire distance liq après ${fmt.pct(worst, 0)} (min ${fmt.pct(R.minLiqDistance || 0.15, 0)}) · buffer après ${fmt.pct(br, 0)} (min ${fmt.pct(R.minBufferRatio || 0.25, 0)}) · marge dispo ${impact.marginOk ? "OK" : "INSUFFISANTE"}`);
    } else g("LIQUIDATION", false, "Non calculable");
    // 7. SENTINEL VETO — at STRESSED only risk-reducing trades pass (worse stress loss or higher gross = refused)
    const reduceOnly = risk?.level === "STRESSED" && impact && (impact.deltas.stressLoss < 0 || impact.deltas.grossExposure > 0) && !(impact.deltas.stressLoss >= 0 && impact.deltas.grossExposure <= 0);
    const vetoed = !!risk?.veto || review?.redTeam?.verdict === "REJECT" || !!reduceOnly;
    g("SENTINEL", !vetoed, risk?.veto ? risk.vetoReason : reduceOnly ? "Niveau TENDU : réduction seulement. Ce trade augmente l'exposition brute ou la perte au choc." : review?.redTeam?.verdict === "REJECT" ? `Équipe rouge : ${review.redTeam.findings[0]?.text}` : review?.redTeam?.verdict === "CAUTION" ? `Équipe rouge : prudence (${review.redTeam.findings.filter((f) => f.severity > 0).length} objections)` : "Aucune objection bloquante");
    const pass = gates.every((x) => x.pass);
    const failed = gates.filter((x) => !x.pass).map((x) => x.name);
    return { gates, pass, failed, impact, status: vetoed ? "VETO" : pass ? "APPROVED" : "REJECTED" };
  }

  AOS.gates = { size, evaluate };
})(typeof window !== "undefined" ? window : globalThis);
