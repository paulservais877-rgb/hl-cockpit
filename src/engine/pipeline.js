/* Personal Alpha OS — Analysis pipeline.
   Market Data → Feature Engine → Portfolio → SENTINEL risk → Six Agents → Risk Gate → Orchestrator → Cone → ARCHIVE → Alerts.
   Pure function of (snapshot, history, settings, previous analysis); persistence of calls/decisions is opt-in. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum } = AOS.util;

  function run(snapshot, history, settings, prev = null, { persist = true } = {}) {
    const t0 = Date.now();
    const timings = {};
    const lap = (k) => { timings[k] = Date.now() - t0; };
    // Hyperliquid returns liquidationPx = null when the asset alone cannot liquidate the cross account (price would be ≤ 0).
    // Fill in the model value (CALCULATED) or flag "no liquidation from this asset alone".
    const model0 = AOS.risk.marginModel(snapshot.positions || [], snapshot.account || {});
    for (const p of snapshot.positions || []) {
      if (isNum(p.liq) || !isNum(p.mark) || p.marginMode === "isolated") continue;
      const lp = AOS.simulate.liqPriceFor(p, snapshot.positions, snapshot.account, model0);
      if (!isNum(lp)) continue;
      if (lp > 0 && (p.side === "LONG" ? lp < p.mark : lp > p.mark)) { p.liq = lp; p.liqDist = p.side === "LONG" ? (p.mark - lp) / p.mark : (lp - p.mark) / p.mark; p.noLiqAlone = false; }
      else { p.liq = NaN; p.liqDist = 1; p.noLiqAlone = true; }
      p.prov.liq = "CALCULATED";
    }
    const features = AOS.features.compute(snapshot, history, { stressCorr: settings?.risk?.normalCorrStress ?? 0.95 });
    // portfolio drawdown 30d from account value history (for the risk budget)
    const av = history?.portfolio?.month?.accountValue;
    if (av?.length > 2) { const peak = Math.max(...av.map((p) => p[1])); features.portfolioDrawdown30d = peak > 0 ? (snapshot.account?.equity ?? av[av.length - 1][1]) / peak - 1 : NaN; }
    lap("features");
    const portfolio = AOS.portfolio.analyze(snapshot.positions, snapshot.account, features);
    features.portfolioAnalysis = portfolio;
    lap("portfolio");
    const risk = AOS.risk.evaluate(snapshot, features, portfolio, settings);
    lap("risk");
    const alpha = AOS.alpha.compute(snapshot, history, features);
    lap("alpha");
    const ctx = { snapshot, history, features, portfolio, risk, alpha, settings };
    const reputation0 = AOS.reputation.summary(history, null, null, persist);
    const agents = {};
    agents.ORACLE = AOS.agents.ORACLE.run(ctx);
    agents.FLOW = AOS.agents.FLOW.run(ctx);
    agents.EDGE = AOS.agents.EDGE.run(ctx, agents.FLOW.votes, reputation0.calibration.byType);
    agents.ALLOCATOR = AOS.agents.ALLOCATOR.run(ctx);
    // preliminary conviction for red-team aggressiveness
    const weights = settings?.weights || {};
    const preConv = {};
    for (const o of agents.EDGE.opportunities) { const c = AOS.orchestrator.conviction({ ...agents, SENTINEL: null }, weights, reputation0.multipliers, o.coin); preConv[o.id] = Math.round(50 + 50 * c.score * (o.side === "LONG" ? 1 : -1)); }
    agents.SENTINEL = AOS.agents.SENTINEL.run(ctx, agents.EDGE.opportunities, preConv);
    agents.ARCHIVE = AOS.agents.ARCHIVE.run(ctx, reputation0);
    lap("agents");
    const reputation = AOS.reputation.summary(history, agents, snapshot, persist);
    const orchestration = AOS.orchestrator.run(ctx, agents, reputation);
    // disagreement feeds the dynamic risk budget
    risk.budget = AOS.risk.riskBudget(settings?.risk || {}, { drawdown30d: features.portfolioDrawdown30d, volRatio: features.regime?.volRatio, avgCorr: features.corr?.avgCorr, level: risk.level, disagreement: orchestration.marketDisagreement });
    lap("orchestrator");
    const cone = AOS.cone.simulate(snapshot.positions, snapshot.account, features, risk.model, { paths: settings?.conePaths || 1500, fundingPerDay: risk.fundingPerDay, seed: 20240917 });
    lap("cone");
    const analysis = { ts: Date.now(), snapshot, features, portfolio, risk, alpha, agents, reputation, orchestration, cone, timings, prov: { snapshot: snapshot?.partial?.length ? "DEGRADED" : "LIVE", history: history?.errors?.length ? "PARTIAL" : "HISTORICAL" } };
    analysis.alerts = AOS.alerts.diff(prev, analysis);
    // decision cards: log automatically generated cards (action AUTO) for calibration, throttled by id/day
    if (persist) {
      const ds = AOS.store.list("decisions");
      const day = Math.floor(Date.now() / 864e5);
      let added = false;
      for (const c of orchestration.cards) { if (!ds.some((d) => d.cardId === c.id && Math.floor(d.ts / 864e5) === day)) { ds.push({ ...AOS.reputation.recordDecision(c, c.status === "VETO" ? "VETO" : c.status === "REJECTED" ? "GATE" : "AUTO", false) }); added = true; } }
      if (added) AOS.store.saveList("decisions", ds.slice(-1000));
    }
    return analysis;
  }

  AOS.pipeline = { run };
})(typeof window !== "undefined" ? window : globalThis);
