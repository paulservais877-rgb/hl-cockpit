/* Personal Alpha OS — Reputation, calibration & edge-decay engine.
   Agents' directional calls are logged (throttled), resolved against 1h closes at their horizon, scored (accuracy, Brier),
   and turned into reputation multipliers with shrinkage (n<20 → close to 1). Decision cards are resolved
   (target hit before invalidation?) to calibrate probabilities per setup type and to measure edge decay.
   All of this lives in the browser (localStorage) — it is the trader's own quantitative memory. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, stats, H, D, uid, nowMs } = AOS.util;
  const store = AOS.store;

  const CALL_THROTTLE_MS = 4 * H;
  const HORIZON_H = { ORACLE: 168, FLOW: 48, EDGE: 96 };

  function closeAt(c1h, ts) {
    if (!c1h?.length) return NaN;
    let best = null;
    for (const k of c1h) { if (k.t <= ts) best = k; else break; }
    return best && ts - best.t < 3 * H ? best.c : NaN;
  }

  /** Log new directional calls from agent votes (one per agent/coin per 4h). */
  function recordCalls(agents, snapshot, persist = true) {
    const calls = store.list("calls");
    const now = nowMs();
    const added = [];
    for (const name of ["ORACLE", "FLOW", "EDGE"]) {
      const ag = agents[name];
      if (!ag?.votes) continue;
      for (const [coin, v] of Object.entries(ag.votes)) {
        if (!isNum(v.dir) || Math.abs(v.dir) < 0.2) continue;
        const px = snapshot?.meta?.assets?.[coin]?.markPx ?? AOS.util.num(snapshot?.mids?.[coin]);
        if (!isNum(px)) continue;
        const recent = calls.find((c) => c.agent === name && c.coin === coin && now - c.ts < CALL_THROTTLE_MS);
        if (recent) continue;
        const p = clamp(0.5 + 0.5 * Math.abs(v.dir) * (isNum(v.confidence) ? v.confidence : 0.5), 0.5, 0.9);
        const call = { id: uid(), agent: name, coin, dir: Math.sign(v.dir), p, horizonH: HORIZON_H[name], px0: px, ts: now, resolved: false };
        calls.push(call); added.push(call);
      }
    }
    if (persist && added.length) store.saveList("calls", calls.slice(-2000));
    return added;
  }

  /** Resolve matured calls using 1h candles. */
  function resolveCalls(history, persist = true) {
    const calls = store.list("calls");
    const now = nowMs();
    let changed = 0;
    for (const c of calls) {
      if (c.resolved) continue;
      const due = c.ts + c.horizonH * H;
      if (now < due) continue;
      const px1 = closeAt(history?.candles?.[c.coin]?.["1h"], due);
      if (!isNum(px1)) { if (now - due > 30 * D) { c.resolved = true; c.outcome = null; changed++; } continue; }
      const ret = px1 / c.px0 - 1;
      c.ret = ret; c.outcome = ret * c.dir > 0 ? 1 : 0; c.brier = (c.p - c.outcome) ** 2; c.resolved = true; c.px1 = px1; changed++;
    }
    if (persist && changed) store.saveList("calls", calls);
    return calls;
  }

  function agentStats(calls) {
    const out = {};
    for (const name of ["ORACLE", "FLOW", "EDGE", "ALLOCATOR", "ARCHIVE", "SENTINEL"]) {
      const mine = calls.filter((c) => c.agent === name && c.resolved && c.outcome !== null);
      const n = mine.length;
      const acc = n ? stats.mean(mine.map((c) => c.outcome)) : NaN;
      const brier = n ? stats.mean(mine.map((c) => c.brier)) : NaN;
      const recent = mine.slice(-20);
      const accRecent = recent.length ? stats.mean(recent.map((c) => c.outcome)) : NaN;
      const raw = n ? clamp((1 + (acc - 0.5) * 2) * (1 + (0.25 - brier)), 0.5, 1.5) : 1;
      const mult = 1 + (raw - 1) * Math.min(1, n / 20);
      const falsePos = mine.filter((c) => c.outcome === 0 && c.p >= 0.7).length;
      out[name] = { n, accuracy: acc, brier, accuracyRecent: accRecent, multiplier: mult, falsePositives: falsePos, pending: calls.filter((c) => c.agent === name && !c.resolved).length };
    }
    return out;
  }

  // ---- decisions (cards) ----------------------------------------------------------------
  function recordDecision(card, action, persist = true) {
    const d = { id: uid(), cardId: card.id, coin: card.coin, side: card.side, type: card.type, action, ts: nowMs(), entry: card.entry, invalidation: card.invalidation, target: card.target, risk: card.risk, rr: card.rr, pWin: card.pWin, horizonDays: card.horizonDays, conviction: card.conviction, status: card.status, riskUsd: card.sizing?.riskUsd, resolved: false };
    if (persist) store.push("decisions", d);
    return d;
  }

  function resolveDecisions(history, persist = true) {
    const ds = store.list("decisions");
    const now = nowMs();
    let changed = 0;
    for (const d of ds) {
      if (d.resolved) continue;
      const c1h = history?.candles?.[d.coin]?.["1h"];
      if (!c1h?.length) continue;
      const end = d.ts + d.horizonDays * D;
      const bars = c1h.filter((k) => k.t >= d.ts && k.t <= Math.min(end, now));
      if (!bars.length) continue;
      const long = d.side === "LONG";
      let outcome = null, exitPx = NaN, exitTs = NaN;
      for (const k of bars) {
        const hitInv = long ? k.l <= d.invalidation : k.h >= d.invalidation;
        const hitTgt = long ? k.h >= d.target : k.l <= d.target;
        if (hitInv && hitTgt) { outcome = "LOSS"; exitPx = d.invalidation; exitTs = k.t; break; } // conservative: ambiguous bar counts as loss
        if (hitInv) { outcome = "LOSS"; exitPx = d.invalidation; exitTs = k.t; break; }
        if (hitTgt) { outcome = "WIN"; exitPx = d.target; exitTs = k.t; break; }
      }
      if (!outcome) {
        if (now < end) continue; // still running
        const last = bars[bars.length - 1];
        exitPx = last.c; exitTs = last.t;
        outcome = (long ? last.c - d.entry : d.entry - last.c) > 0 ? "EXPIRED_WIN" : "EXPIRED_LOSS";
      }
      d.resolved = true; d.outcome = outcome; d.exitPx = exitPx; d.exitTs = exitTs;
      d.realizedR = ((long ? exitPx - d.entry : d.entry - exitPx) / d.risk) - AOS.simulate.ROUND_TRIP_COST / (d.risk / d.entry);
      d.hit = outcome === "WIN" || outcome === "EXPIRED_WIN" ? 1 : 0;
      changed++;
    }
    if (persist && changed) store.saveList("decisions", ds);
    return ds;
  }

  function calibration(decisions) {
    const res = decisions.filter((d) => d.resolved);
    const byType = {};
    for (const [type, arr] of Object.entries(AOS.util.groupBy(res, (d) => d.type))) byType[type] = { n: arr.length, hitRate: stats.mean(arr.map((d) => d.hit)), predicted: stats.mean(arr.map((d) => d.pWin)), meanR: stats.mean(arr.map((d) => d.realizedR)) };
    const bins = [[0.25, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.75]].map(([lo, hi]) => { const arr = res.filter((d) => d.pWin >= lo && d.pWin < hi); return { lo, hi, n: arr.length, predicted: stats.mean(arr.map((d) => d.pWin)), realized: stats.mean(arr.map((d) => d.hit)) }; });
    const brier = res.length ? stats.mean(res.map((d) => (d.pWin - d.hit) ** 2)) : NaN;
    return { n: res.length, byType, bins, brier, uncertainty: AOS.util.uncertainty(res.length, 100, 30) };
  }

  function edgeDecay(decisions) {
    const res = decisions.filter((d) => d.resolved).sort((a, b) => a.ts - b.ts);
    const out = {};
    for (const [type, arr] of Object.entries(AOS.util.groupBy(res, (d) => d.type))) {
      const r30 = stats.mean(arr.slice(-30).map((d) => d.realizedR)), r90 = stats.mean(arr.slice(-90).map((d) => d.realizedR));
      const m6 = stats.mean(arr.filter((d) => d.ts > nowMs() - 182 * D).map((d) => d.realizedR)), m12 = stats.mean(arr.filter((d) => d.ts > nowMs() - 365 * D).map((d) => d.realizedR));
      const weight = arr.length >= 20 && isNum(r30) ? clamp(1 + r30, 0.3, 1.2) : 1;
      out[type] = { n: arr.length, rolling30: r30, rolling90: r90, m6, m12, weight, decaying: arr.length >= 30 && isNum(r30) && isNum(r90) && r30 < r90 - 0.2 };
    }
    return out;
  }

  function avoided(decisions) {
    const ign = decisions.filter((d) => d.resolved && (d.action === "IGNORE" || d.action === "VETO" || d.action === "GATE"));
    const lossesAvoided = -stats.sum(ign.filter((d) => d.realizedR < 0).map((d) => d.realizedR * (d.riskUsd || 0)));
    const gainsMissed = stats.sum(ign.filter((d) => d.realizedR > 0).map((d) => d.realizedR * (d.riskUsd || 0)));
    const bySentinel = ign.filter((d) => d.action === "VETO");
    return { n: ign.length, lossesAvoided, gainsMissed, net: lossesAvoided - gainsMissed, sentinelN: bySentinel.length, sentinelAvoided: -stats.sum(bySentinel.filter((d) => d.realizedR < 0).map((d) => d.realizedR * (d.riskUsd || 0))) };
  }

  function summary(history, agents, snapshot, persist = true) {
    if (agents && snapshot) recordCalls(agents, snapshot, persist);
    const calls = resolveCalls(history, persist);
    const decisions = resolveDecisions(history, persist);
    const ag = agentStats(calls);
    const cal = calibration(decisions);
    const dec = edgeDecay(decisions);
    const av = avoided(decisions);
    return { agents: ag, calls: calls.length, decisions: decisions.length, calibration: cal, edgeDecay: dec, avoided: av, multipliers: Object.fromEntries(Object.entries(ag).map(([k, v]) => [k, v.multiplier])), decisionsList: decisions.slice(-50).reverse() };
  }

  AOS.reputation = { recordCalls, resolveCalls, agentStats, recordDecision, resolveDecisions, calibration, edgeDecay, avoided, summary, HORIZON_H };
})(typeof window !== "undefined" ? window : globalThis);
