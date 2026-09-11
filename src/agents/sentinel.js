/* SEAT 05 — SENTINEL · Chief Risk Officer. ABSOLUTE VETO. No vote. Red-team + pre-mortem for every opportunity. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, fmt } = AOS.util;

  /** Red-team an opportunity: try to prove the trade is bad. Aggressiveness scales with conviction. */
  function redTeam(opp, ctx, conviction) {
    const { features, snapshot, history, risk, portfolio } = ctx;
    const f = features?.byCoin?.[opp.coin];
    const reg = features?.regime || {};
    const a = snapshot?.meta?.assets?.[opp.coin] || {};
    const fh = history?.funding?.[opp.coin] || [];
    const findings = [];
    const sideSign = opp.side === "LONG" ? 1 : -1;
    const sev = (s) => (conviction > 75 ? s + 1 : s); // stronger conviction → harsher scrutiny
    // wrong regime
    if ((reg.bias === "BEAR" && opp.side === "LONG") || (reg.bias === "BULL" && opp.side === "SHORT")) findings.push({ test: "wrong regime", severity: sev(2), text: `Trade ${opp.side} contre le biais de régime ${reg.regime} (${reg.confidence}%)` });
    else if (isNum(reg.changeProbability) && reg.changeProbability > 50) findings.push({ test: "wrong regime", severity: sev(1), text: `Régime instable : probabilité de changement ${reg.changeProbability}%` });
    // crowded positioning
    const fz = fh.length > 48 ? AOS.util.stats.zscore(a.fundingHourly, fh.map((r) => r.rate)) : NaN;
    if (isNum(fz) && fz * sideSign > 1.5) findings.push({ test: "crowded positioning", severity: sev(2), text: `Funding z=${fz.toFixed(1)} dans le sens du trade : la foule est déjà positionnée comme toi` });
    // liquidity trap
    if (isNum(a.dayNtlVlm) && isNum(f?.d1?.volAvg20) && f.d1.volAvg20 > 0 && f.d1.volLast / f.d1.volAvg20 < 0.6) findings.push({ test: "liquidity trap", severity: sev(1), text: `Volume 24h à ${(f.d1.volLast / f.d1.volAvg20 * 100).toFixed(0)}% de la moyenne 20j : cassures moins fiables` });
    // hidden correlation
    const cc = features?.corr?.coins || []; const i = cc.indexOf(opp.coin);
    if (i >= 0) { const same = (portfolio?.byAsset || []).filter((p) => { const j = cc.indexOf(p.coin); const rho = j >= 0 ? features.corr.normal[i][j] : NaN; return isNum(rho) && rho > 0.7 && (p.side === opp.side); }); if (same.length) findings.push({ test: "hidden correlation", severity: sev(2), text: `Corrélé > 0.7 avec ${same.map((p) => p.coin).join(", ")} déjà ${opp.side} : ce n'est pas un nouveau pari, c'est le même en plus gros` }); }
    // funding erosion
    if (isNum(opp.fundingCostPct) && opp.fundingCostPct > 0.003) findings.push({ test: "funding erosion", severity: sev(1), text: `Funding sur l'horizon ≈ ${(opp.fundingCostPct * 100).toFixed(2)}% du notional (${(opp.costR).toFixed(2)}R de coûts)` });
    // false breakout
    if (opp.type === "breakout" && isNum(f?.d1?.rsi) && f.d1.rsi > 75) findings.push({ test: "false breakout", severity: sev(2), text: `Breakout avec RSI 1d ${f.d1.rsi.toFixed(0)} : profil classique de faux breakout / exhaustion` });
    // macro event — unknown from data
    findings.push({ test: "macro event", severity: 0, text: "Calendrier macro non intégré (UNKNOWN) : vérifier FOMC / CPI / options expiry avant une taille importante" });
    // liquidation cascade
    const worst = risk?.worstLiq;
    if (worst && isNum(worst.liqDist) && worst.liqDist < 0.2) findings.push({ test: "liquidation cascade", severity: sev(2), text: `Ta position ${worst.coin} est à ${(worst.liqDist * 100).toFixed(0)}% de liquidation : un nouveau trade réduit encore la marge disponible` });
    if (isNum(features?.regime?.volRatio) && features.regime.volRatio > 1.4) findings.push({ test: "liquidation cascade", severity: sev(1), text: `Vol 7j/30j ${features.regime.volRatio.toFixed(2)} : les mèches vont chercher les stops` });
    const score = findings.reduce((s, x) => s + x.severity, 0);
    return { findings: findings.sort((x, y) => y.severity - x.severity), score, verdict: score >= 6 ? "REJECT" : score >= 3 ? "CAUTION" : "PASS" };
  }

  /** Pre-mortem: "suppose this trade lost badly — what most likely caused it?" Top 3 plausible causes. */
  function preMortem(opp, ctx, red) {
    const causes = red.findings.filter((f) => f.severity > 0).slice(0, 3).map((f) => f.text);
    while (causes.length < 3) causes.push(["Stop trop serré pour la volatilité réalisée (mèche puis reprise sans toi)", "Entrée en fin de mouvement (chasing) : le setup était déjà consommé", "Événement exogène pendant la détention (macro, hack, réglementation)"][causes.length]);
    return causes;
  }

  function run(ctx, opportunities, convictionByOpp = {}) {
    const { risk, snapshot } = ctx;
    const reviews = (opportunities || []).map((o) => { const r = redTeam(o, ctx, convictionByOpp[o.id] || 50); return { id: o.id, coin: o.coin, side: o.side, redTeam: r, preMortem: preMortem(o, ctx, r) }; });
    const level = risk?.level || "UNKNOWN";
    return {
      agent: "SENTINEL", seat: "05", role: "Chief Risk Officer (VETO)", timestamp: new Date().toISOString(),
      direction: "n/a", confidence: 1, expected_return: NaN, expected_loss: isNum(risk?.estimatedLossCombined) && isNum(snapshot?.account?.equity) ? risk.estimatedLossCombined / snapshot.account.equity : NaN, time_horizon: "now",
      signals: risk?.reasons || [], risks: [
        `Survie au choc simultané : ${risk?.survivalCombined === null ? "—" : risk?.survivalCombined ? "OUI" : "NON (liquidation)"} · marge après choc ${fmt.pct(risk?.marginAfterShock)}`,
        `Perte estimée choc simultané ${fmt.usdSigned(risk?.estimatedLossCombined)} · capital requis pour survivre ${fmt.usd(risk?.capitalToSurvive)}`,
        `Position à réduire en premier : ${risk?.reduceFirst?.[0]?.coin || "—"}`,
      ],
      invalidation: ["Retour à NORMAL : buffer ≥ 25%, distance liq ≥ 25%, choc −20% survivable"],
      recommendation: risk?.veto ? "VETO — NO RISK INCREASE" : level === "STRESSED" ? "REDUCE ONLY" : level === "WATCH" ? "SMALL SIZE ONLY" : "CLEARED",
      position_size_modifier: { NORMAL: 1, WATCH: 0.7, STRESSED: 0.4, DANGER: 0, CRITICAL: 0 }[level] ?? 0.5,
      veto: !!risk?.veto, vetoReason: risk?.vetoReason, level, reviews, prov: "CALCULATED",
    };
  }
  AOS.agents = AOS.agents || {};
  AOS.agents.SENTINEL = { run, redTeam, preMortem };
})(typeof window !== "undefined" ? window : globalThis);
