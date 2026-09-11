/* Personal Alpha OS — Alert / Watcher engine. Compares two analyses and emits only decision-changing alerts.
   Every alert answers: WHAT CHANGED · WHY IT MATTERS · ACTION / NO ACTION. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, fmt } = AOS.util;
  const LEVELS = ["NORMAL", "WATCH", "STRESSED", "DANGER", "CRITICAL"];

  function diff(prev, next) {
    const out = [];
    const add = (type, severity, what, why, action) => out.push({ id: type + ":" + what, type, severity, what, why, action, ts: Date.now() });
    if (!next) return out;
    const p = prev || {};
    // regime change
    if (p.features?.regime?.regime && next.features?.regime?.regime && p.features.regime.regime !== next.features.regime.regime && next.features.regime.confidence >= 40)
      add("REGIME", 2, `Régime ${p.features.regime.regime} → ${next.features.regime.regime} (${next.features.regime.confidence}%)`, "Les setups valides et le sizing dépendent du régime.", `Relire les verdicts de positions : ${next.orchestration?.verdicts?.filter((v) => v.verdict !== "KEEP").map((v) => v.verdict + " " + v.coin).join(", ") || "aucun changement"}`);
    // risk level transition
    const l0 = p.risk?.level, l1 = next.risk?.level;
    if (l0 && l1 && l0 !== l1) add("RISK", LEVELS.indexOf(l1) > LEVELS.indexOf(l0) ? 3 : 1, `Risque portefeuille ${l0} → ${l1}`, next.risk.reasons[0], LEVELS.indexOf(l1) >= 2 ? `Réduire ${next.risk.reduceFirst?.[0]?.coin || "la position dominante"}` : "Aucune action");
    // liquidation distance thresholds
    for (const pos of next.snapshot?.positions || []) {
      const before = p.snapshot?.positions?.find((q) => q.coin === pos.coin);
      for (const th of [0.25, 0.15, 0.1, 0.05]) if (isNum(pos.liqDist) && pos.liqDist < th && (!before || !isNum(before.liqDist) || before.liqDist >= th)) add("LIQ", th <= 0.1 ? 3 : 2, `${pos.coin} ${pos.side} sous ${th * 100}% de sa liquidation (${fmt.pct(pos.liqDist)})`, `Liquidation à ${fmt.px(pos.liq)} ; mark ${fmt.px(pos.mark)}.`, th <= 0.1 ? "Réduire ou ajouter de la marge maintenant" : "Préparer un plan de réduction");
      // invalidation / stop crossed
      if (isNum(pos.stopLoss)) { const crossed = pos.side === "LONG" ? pos.mark <= pos.stopLoss : pos.mark >= pos.stopLoss; const was = before && isNum(before.stopLoss) ? (before.side === "LONG" ? before.mark <= before.stopLoss : before.mark >= before.stopLoss) : false; if (crossed && !was) add("INVALIDATION", 3, `${pos.coin} a traversé son stop (${fmt.px(pos.stopLoss)})`, "La thèse est invalidée selon ton propre ordre.", "Vérifier que le stop s'est exécuté ; sinon sortir manuellement"); }
    }
    // new / closed positions
    const pc = new Set((p.snapshot?.positions || []).map((x) => x.coin)), nc = new Set((next.snapshot?.positions || []).map((x) => x.coin));
    for (const c of nc) if (p.snapshot && !pc.has(c)) add("POSITION", 1, `Nouvelle position détectée : ${c}`, "Hyperliquid est la source de vérité ; l'analyse inclut maintenant cet actif.", "Aucune action");
    for (const c of pc) if (!nc.has(c)) add("POSITION", 1, `Position fermée : ${c}`, "Détection automatique via le wallet.", "Journaliser la raison de sortie dans ARCHIVE");
    // funding anomaly
    for (const a of next.features?.anomalies || []) if (a.type === "FUNDING" && Math.abs(a.z) >= 2.5 && !(p.features?.anomalies || []).some((b) => b.coin === a.coin && b.type === "FUNDING")) add("FUNDING", 2, a.text, "Un funding extrême signale un positionnement surpeuplé : risque de squeeze ou d'érosion.", nc.has(a.coin) ? `Vérifier le coût du funding sur ${a.coin}` : "Aucune action");
    // high conviction setup passing the gate
    for (const c of next.orchestration?.approved || []) if (c.conviction >= 70 && !(p.orchestration?.approved || []).some((d) => d.id === c.id)) add("SETUP", 2, `Setup approuvé : ${c.side} ${c.coin} (${c.conviction}/100, EV ${c.evR.toFixed(2)}R)`, c.why, `Simuler puis décider (risque ${fmt.usd(c.sizing?.riskUsd)})`);
    // major price level: 20d high/low broken on held assets
    for (const pos of next.snapshot?.positions || []) { const f = next.features?.byCoin?.[pos.coin]?.d1, f0 = p.features?.byCoin?.[pos.coin]?.d1; if (f && f0) { if (pos.mark > f.high20 && (p.snapshot?.positions?.find((q) => q.coin === pos.coin)?.mark ?? Infinity) <= f0.high20) add("LEVEL", 1, `${pos.coin} au-dessus de son plus-haut 20j`, "Niveau structurel majeur.", pos.side === "LONG" ? "Envisager de remonter le stop" : "Réévaluer le short"); if (pos.mark < f.low20 && (p.snapshot?.positions?.find((q) => q.coin === pos.coin)?.mark ?? -Infinity) >= f0.low20) add("LEVEL", 1, `${pos.coin} sous son plus-bas 20j`, "Niveau structurel majeur.", pos.side === "SHORT" ? "Envisager de remonter le stop" : "Réévaluer le long"); } }
    return out.sort((a, b) => b.severity - a.severity);
  }

  /** Watcher window helper: is now inside [start,end] hours (local)? */
  function inWindow(cfg, d = new Date()) {
    const h = d.getHours() + d.getMinutes() / 60;
    return h >= (cfg?.startHour ?? 7.5) && h <= (cfg?.endHour ?? 20.5);
  }

  AOS.alerts = { diff, inWindow };
})(typeof window !== "undefined" ? window : globalThis);
