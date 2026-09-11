/* Personal Alpha OS — ORCHESTRATOR. No vote. Consolidates the six agents into: conviction scores (reputation-weighted),
   disagreement index, decision cards (after the Risk Gate), opportunity-cost verdicts for held positions,
   and ONE top recommendation. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, stats, fmt } = AOS.util;

  const VOTERS = ["ORACLE", "EDGE", "FLOW", "ALLOCATOR", "ARCHIVE"];

  function conviction(agents, weights, multipliers, coin) {
    let num = 0, den = 0, absden = 0;
    const parts = [];
    for (const name of VOTERS) {
      const v = agents[name]?.votes?.[coin];
      if (!v || !isNum(v.dir)) continue;
      const w = (weights[name] || 0) * (multipliers?.[name] || 1);
      const contrib = v.dir * clamp(isNum(v.confidence) ? v.confidence : 0.5, 0, 1);
      num += w * contrib; den += w; absden += w * Math.abs(contrib);
      parts.push({ agent: name, dir: v.dir, confidence: v.confidence, weight: w, contribution: w * contrib, reasons: v.reasons || [] });
    }
    const s = den > 0 ? num / den : 0; // [-1,1]
    const disagreement = absden > 0 ? 1 - Math.abs(num) / absden : 0;
    return { coin, score: s, long: Math.round(50 + 50 * s), short: Math.round(50 - 50 * s), disagreement, parts };
  }

  function verdictFor(p, conv, ctx) {
    const { risk, portfolio } = ctx;
    const sideSign = p.side === "LONG" ? 1 : -1;
    const aligned = conv.score * sideSign; // >0 agents agree with the position
    const grav = risk?.gravity?.find((g) => g.coin === p.coin);
    const isTopRisk = risk?.reduceFirst?.[0]?.coin === p.coin;
    const level = risk?.level;
    const why = [];
    let verdict = "KEEP";
    if ((level === "DANGER" || level === "CRITICAL") && isTopRisk) { verdict = "REDUCE"; why.push(`Niveau ${level} et c'est la position dont la réduction améliore le plus la survie`); }
    else if (aligned < -0.35) { verdict = isNum(p.upnl) && p.upnl > 0 ? "EXIT" : "EXIT"; why.push(`Conviction des agents contre la position (${Math.round(aligned * 100)})`); }
    else if (aligned < -0.15) { verdict = level === "STRESSED" || isTopRisk ? "REDUCE" : "HEDGE"; why.push(`Agents légèrement contre (${Math.round(aligned * 100)}) ; ${verdict === "HEDGE" ? "un hedge préserve la thèse tout en coupant le beta" : "réduire coupe le risque dominant"}`); }
    else if (Math.abs(aligned) <= 0.15) { verdict = "NO EDGE"; why.push("Si tu n'avais pas cette position, les agents ne l'ouvriraient pas aujourd'hui (conviction neutre)"); }
    else if (aligned > 0.45 && !risk?.veto && level === "NORMAL" && !(grav && grav.share > 0.5)) { verdict = "INCREASE"; why.push(`Conviction alignée forte (${Math.round(aligned * 100)}), risque NORMAL, position non dominante`); }
    else { verdict = "KEEP"; why.push(`Conviction alignée (${Math.round(aligned * 100)}) ; pas de raison de renforcer (${grav && grav.share > 0.5 ? "position dominante du risque" : level !== "NORMAL" ? "niveau " + level : "conviction modérée"})`); }
    if (isNum(p.fundingPerDay) && p.fundingPerDay < 0 && isNum(p.notional) && -p.fundingPerDay * 30 > 0.01 * p.notional) why.push(`Funding coûte ${fmt.usd(-p.fundingPerDay * 30)}/mois (${fmt.pct(-p.fundingPerDay * 30 / p.notional, 2)} du notional)`);
    if (grav) why.push(`Gravité ${Math.round(grav.share * 100)}% du risque portefeuille`);
    return { coin: p.coin, side: p.side, verdict, why, aligned, convictionLong: conv.long, disagreement: conv.disagreement };
  }

  function run(ctx, agents, reputation) {
    const { snapshot, features, risk, settings } = ctx;
    const weights = settings?.weights || { ORACLE: 0.2, EDGE: 0.2, FLOW: 0.35, ALLOCATOR: 0.15, ARCHIVE: 0.1 };
    const mult = reputation?.multipliers || {};
    const coins = new Set(["BTC", "ETH", "SOL", ...(snapshot?.positions || []).map((p) => p.coin), ...(agents.EDGE?.opportunities || []).map((o) => o.coin)]);
    const convictions = {};
    for (const c of coins) convictions[c] = conviction(agents, weights, mult, c);
    const marketDI = convictions.BTC?.disagreement ?? 0;
    const effWeights = Object.fromEntries(VOTERS.map((n) => [n, (weights[n] || 0) * (mult[n] || 1)]));
    const wsum = stats.sum(Object.values(effWeights)) || 1;
    for (const k of Object.keys(effWeights)) effWeights[k] /= wsum;
    // decision cards from EDGE opportunities
    const modifiers = VOTERS.map((n) => agents[n]?.position_size_modifier).filter(isNum).concat([agents.SENTINEL?.position_size_modifier].filter(isNum));
    const cards = [];
    const decay = reputation?.edgeDecay || {};
    for (const o of agents.EDGE?.opportunities || []) {
      const conv = convictions[o.coin];
      const sideSign = o.side === "LONG" ? 1 : -1;
      const convScore = Math.round(50 + 50 * conv.score * sideSign);
      const decayW = decay[o.type]?.weight ?? 1;
      const oppW = { ...o, evR: o.evR * decayW, decayWeight: decayW };
      const review = agents.SENTINEL?.reviews?.find((r) => r.id === o.id);
      const sizing = AOS.gates.size(oppW, ctx, { disagreement: conv.disagreement, modifiers });
      const gate = AOS.gates.evaluate(oppW, ctx, sizing, review);
      cards.push({ ...oppW, conviction: convScore, disagreement: conv.disagreement, convictionParts: conv.parts, sizing, gate, status: gate.status, review, regime: features?.regime?.regime, flowDir: agents.FLOW?.votes?.[o.coin]?.dir, portfolioImpact: gate.impact ? (gate.impact.deltas.stressLoss >= 0 ? "Positive" : gate.impact.deltas.stressLoss > -0.01 * (snapshot.account?.equity || 1) ? "Neutral" : "Negative") : "—", fundingLabel: !isNum(o.fundingCostPct) ? "—" : Math.abs(o.fundingCostPct) < 0.0005 ? "Neutral" : o.fundingCostPct > 0 ? "Cost" : "Tailwind" });
    }
    cards.sort((a, b) => (b.status === "APPROVED") - (a.status === "APPROVED") || b.conviction * b.evR - a.conviction * a.evR);
    // opportunity-cost verdicts for held positions
    const verdicts = (snapshot?.positions || []).map((p) => verdictFor(p, convictions[p.coin], ctx));
    // top recommendation
    let action;
    const approved = cards.filter((c) => c.status === "APPROVED");
    const reduceV = verdicts.filter((v) => v.verdict === "REDUCE" || v.verdict === "EXIT");
    if (risk?.level === "CRITICAL" || risk?.level === "DANGER") {
      const r = risk.reduceFirst?.[0];
      action = { kind: "RISK", title: `Réduire ${r?.coin || "la position dominante"} maintenant`, text: `Niveau ${risk.level}. ${risk.reasons[0]}`, why: risk.reasons, coin: r?.coin };
    } else if (reduceV.length) {
      const v = reduceV[0];
      action = { kind: "REBALANCE", title: `${v.verdict} ${v.coin} ${v.side}`, text: v.why[0], why: v.why, coin: v.coin };
    } else if (approved.length) {
      const c = approved[0];
      action = { kind: "TRADE", title: `${c.side} ${c.coin} · conviction ${c.conviction}/100`, text: `${c.name} · EV ${c.evR.toFixed(2)}R · RR ${c.rr.toFixed(1)} · risque ${fmt.usd(c.sizing?.riskUsd)}`, why: [c.why, ...c.convictionParts.slice(0, 3).map((p) => `${p.agent}: ${p.reasons[0]}`)], coin: c.coin, cardId: c.id };
    } else {
      const rejected = cards.length;
      action = { kind: "NO_TRADE", title: "NO TRADE — PERFECT DECISION", text: rejected ? `${rejected} setup${rejected > 1 ? "s" : ""} détecté${rejected > 1 ? "s" : ""}, aucun ne passe le Risk Gate (${[...new Set(cards.flatMap((c) => c.gate.failed))].join(", ")})` : "Aucun setup avec un edge suffisant après coûts. Ne rien faire est la meilleure décision.", why: cards.slice(0, 3).map((c) => `${c.coin} ${c.side} ${c.name} rejeté : ${c.gate.failed.join(", ")}`) };
    }
    return { convictions, marketDisagreement: marketDI, effectiveWeights: effWeights, cards, approved, verdicts, action, prov: "CALCULATED" };
  }

  AOS.orchestrator = { run, conviction, verdictFor, VOTERS };
})(typeof window !== "undefined" ? window : globalThis);
