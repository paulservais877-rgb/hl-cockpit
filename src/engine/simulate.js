/* Personal Alpha OS — Simulator & Scenario engine.
   Simulator input is deliberately minimal: ASSET · LONG/SHORT · QUANTITY (· entry). Everything else is derived.
   Scenario engine: absolute or % price overrides, plus a natural-language parser (fr/en). */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, stats, num } = AOS.util;

  const TAKER_FEE = 0.00035; // Hyperliquid base taker fee (ESTIMATED, tier dependent)
  const ROUND_TRIP_COST = TAKER_FEE * 2;

  /** Cross liquidation price of one position when only that asset moves. */
  function liqPriceFor(p, positions, account, model) {
    const equity = account?.equity;
    if (!isNum(equity) || !isNum(p.mark)) return NaN;
    const others = positions.filter((q) => q !== p && q.marginMode !== "isolated");
    const mmOthers = stats.sum(others.map((q) => q.absSize * q.mark * (isNum(q.mmRate) ? q.mmRate : 0.05) * model.scale));
    const r = (isNum(p.mmRate) ? p.mmRate : 0.05) * model.scale;
    if (p.szi > 0) return (mmOthers - equity + p.szi * p.mark) / (p.szi * (1 - r));
    return (equity - mmOthers + p.absSize * p.mark) / (p.absSize * (1 + r));
  }

  /** Build the hypothetical position list after adding a trade (netting with an existing position on the same coin). */
  function applyTrade(snapshot, features, trade, settings = {}) {
    const asset = snapshot?.meta?.assets?.[trade.coin] || {};
    const mark = isNum(trade.entry) ? trade.entry : isNum(asset.markPx) ? asset.markPx : num(snapshot?.mids?.[trade.coin]);
    if (!isNum(mark) || !isNum(trade.qty) || trade.qty <= 0) return null;
    const signed = (trade.side === "SHORT" ? -1 : 1) * trade.qty;
    const positions = (snapshot.positions || []).map((p) => ({ ...p, prov: { ...p.prov } }));
    let target = positions.find((p) => p.coin === trade.coin);
    const account = { ...snapshot.account };
    const existingLev = target?.leverage;
    const lev = isNum(trade.leverage) ? trade.leverage : isNum(existingLev) ? existingLev : Math.min(settings.defaultLeverage || 5, asset.maxLeverage || 5);
    if (target) {
      const newSzi = target.szi + signed;
      if (Math.abs(newSzi) < 1e-12) { positions.splice(positions.indexOf(target), 1); target = null; }
      else {
        const sameDir = Math.sign(newSzi) === Math.sign(target.szi) && Math.abs(newSzi) > Math.abs(target.szi);
        const entry = sameDir ? (target.entry * target.absSize + mark * trade.qty) / (target.absSize + trade.qty) : Math.sign(newSzi) === Math.sign(target.szi) ? target.entry : mark;
        Object.assign(target, { szi: newSzi, absSize: Math.abs(newSzi), side: newSzi > 0 ? "LONG" : "SHORT", entry, mark: isNum(asset.markPx) ? asset.markPx : mark, isHypothetical: true });
        target.notional = target.absSize * target.mark; target.upnl = target.szi * (target.mark - target.entry); target.mmEstimate = target.notional * (target.mmRate || 0.05);
        target.marginUsed = target.notional / (target.leverage || lev);
        target.fundingPerHour = isNum(target.fundingHourly) ? (target.side === "LONG" ? -1 : 1) * target.notional * target.fundingHourly : NaN; target.fundingPerDay = target.fundingPerHour * 24;
      }
    } else {
      const mmRate = AOS.normalize.mmRateFor(asset.maxLeverage);
      const notional = trade.qty * mark;
      const fundingHourly = asset.fundingHourly;
      const fundingPerHour = isNum(fundingHourly) ? (signed > 0 ? -1 : 1) * notional * fundingHourly : NaN;
      target = { coin: trade.coin, side: signed > 0 ? "LONG" : "SHORT", szi: signed, absSize: trade.qty, entry: mark, mark: isNum(asset.markPx) ? asset.markPx : mark, liq: NaN, liqDist: NaN, notional, upnl: 0, leverage: lev, marginMode: "cross", marginUsed: notional / lev, maxLeverage: asset.maxLeverage, mmRate: isNum(mmRate) ? mmRate : 0.05, mmEstimate: notional * (isNum(mmRate) ? mmRate : 0.05), fundingHourly, fundingPerHour, fundingPerDay: fundingPerHour * 24, cumFunding: {}, isHypothetical: true, prov: { mark: "LIVE", liq: "CALCULATED", notional: "CALCULATED", upnl: "CALCULATED", funding: isNum(fundingHourly) ? "LIVE" : "UNKNOWN" } };
      positions.push(target);
    }
    // account after: equity unchanged (fees ignored at this layer, shown separately), margin used recomputed
    account.marginUsed = stats.sum(positions.map((p) => (isNum(p.marginUsed) ? p.marginUsed : p.notional / (p.leverage || 5))));
    account.totalNtl = stats.sum(positions.map((p) => p.notional));
    const model = AOS.risk.marginModel(snapshot.positions || [], snapshot.account);
    account.mm = stats.sum(positions.filter((p) => p.marginMode !== "isolated").map((p) => p.notional * (p.mmRate || 0.05) * model.scale));
    account.buffer = account.equity - account.mm; account.bufferRatio = account.equity > 0 ? account.buffer / account.equity : NaN;
    account.marginRatio = account.equity > 0 ? account.mm / account.equity : NaN; account.marginUtilisation = account.equity > 0 ? account.marginUsed / account.equity : NaN;
    account.availableMargin = account.equity - account.marginUsed; account.effectiveLeverage = account.equity > 0 ? account.totalNtl / account.equity : NaN;
    // recompute liquidation prices (CALCULATED) for all cross positions
    for (const p of positions) {
      if (p.marginMode === "isolated" && !p.isHypothetical) continue;
      const lp = liqPriceFor(p, positions, account, model);
      p.liq = lp; p.liqDist = isNum(lp) && lp > 0 && p.mark > 0 ? (p.side === "LONG" ? (p.mark - lp) / p.mark : (lp - p.mark) / p.mark) : isNum(lp) && lp <= 0 && p.side === "LONG" ? 1 : NaN;
      p.prov.liq = "CALCULATED";
    }
    positions.sort((a, b) => b.notional - a.notional);
    return { positions, account, target, mark, model, marginOk: account.availableMargin >= 0 };
  }

  /** Suggested invalidation (structure/ATR based) and target. Returns prices + WHY. */
  function suggestLevels(trade, features, mark) {
    const f = features?.byCoin?.[trade.coin];
    const long = trade.side !== "SHORT";
    const atr4 = f?.h4?.atr, atr1d = f?.d1?.atr;
    const swingLow = f?.h4?.low12, swingHigh = f?.h4?.high12;
    let inv = NaN, why = "";
    if (isNum(atr4) && isNum(swingLow) && isNum(swingHigh)) {
      inv = long ? swingLow - 0.3 * atr4 : swingHigh + 0.3 * atr4;
      why = `Structure : ${long ? "plus-bas" : "plus-haut"} des 12 dernières bougies 4h ± 0.3 ATR(4h)`;
      const risk = Math.abs(mark - inv);
      if (isNum(atr1d) && risk > 2.5 * atr1d) { inv = long ? mark - 1.5 * atr1d : mark + 1.5 * atr1d; why = "Structure trop loin (> 2.5 ATR 1j) → 1.5 ATR(1j) depuis l'entrée"; }
      if (risk < 0.4 * (atr4 || 0)) { inv = long ? mark - 1 * atr4 : mark + 1 * atr4; why = "Structure trop proche (< 0.4 ATR 4h) → 1 ATR(4h) depuis l'entrée"; }
    } else if (isNum(atr1d)) { inv = long ? mark - 1.5 * atr1d : mark + 1.5 * atr1d; why = "1.5 ATR(1j) depuis l'entrée (pas de structure 4h disponible)"; }
    else { inv = long ? mark * 0.93 : mark * 1.07; why = "Pas d'historique : −7% par défaut (ESTIMATED)"; }
    const risk = Math.abs(mark - inv);
    let target = long ? mark + 2 * risk : mark - 2 * risk, tWhy = "2R (ratio 2:1)";
    const h20 = f?.d1?.high20, l20 = f?.d1?.low20;
    if (long && isNum(h20) && h20 > mark + 1.5 * risk && h20 < mark + 4 * risk) { target = h20; tWhy = "Plus-haut 20j (résistance structurelle)"; }
    if (!long && isNum(l20) && l20 < mark - 1.5 * risk && l20 > mark - 4 * risk) { target = l20; tWhy = "Plus-bas 20j (support structurel)"; }
    const t2 = long ? mark + 3 * risk : mark - 3 * risk, t3 = long ? mark + 4.5 * risk : mark - 4.5 * risk;
    return { invalidation: inv, invalidationWhy: why, target, targetWhy: tWhy, target2: t2, target3: t3, risk, riskPct: risk / mark, prov: isNum(atr4) || isNum(atr1d) ? "CALCULATED" : "ESTIMATED" };
  }

  /** Marginal trade impact: portfolio before vs after, in the 7 dimensions of the Risk Gate. */
  function impact(snapshot, features, analysisBefore, trade, levels, settings = {}) {
    const after = applyTrade(snapshot, features, trade, settings);
    if (!after) return null;
    const pfB = analysisBefore.portfolio, rkB = analysisBefore.risk;
    const pfA = AOS.portfolio.analyze(after.positions, after.account, features);
    const rkA = AOS.risk.evaluate({ ...snapshot, positions: after.positions, account: after.account }, features, pfA, settings);
    const qty = trade.qty, mark = after.mark;
    const long = trade.side !== "SHORT";
    const lossIfInvalidated = isNum(levels?.invalidation) ? -Math.abs(mark - levels.invalidation) * qty : NaN;
    const gainAtTarget = isNum(levels?.target) ? Math.abs(levels.target - mark) * qty : NaN;
    const notional = qty * mark;
    const fees = notional * ROUND_TRIP_COST;
    const horizonDays = trade.horizonDays || 4;
    const fh = snapshot?.meta?.assets?.[trade.coin]?.fundingHourly;
    const fundingCost = isNum(fh) ? (long ? 1 : -1) * fh * 24 * horizonDays * notional : NaN; // positive = cost
    const rr = isNum(lossIfInvalidated) && lossIfInvalidated < 0 && isNum(gainAtTarget) ? gainAtTarget / -lossIfInvalidated : NaN;
    const p = isNum(trade.pWin) ? trade.pWin : 0.45;
    const ev = isNum(rr) ? p * gainAtTarget - (1 - p) * -lossIfInvalidated - fees - (isNum(fundingCost) ? fundingCost : 0) : NaN;
    const worstB = rkB?.worstLiq?.liqDist, worstA = rkA?.worstLiq?.liqDist;
    const scenarios = [-0.10, -0.05, 0.05, 0.10].map((s) => {
      const shocks = AOS.risk.propagate(s, after.positions, features, "beta");
      const r = AOS.risk.shock(after.positions, after.account, shocks, after.model);
      const rb = AOS.risk.shock(snapshot.positions, snapshot.account, AOS.risk.propagate(s, snapshot.positions, features, "beta"), rkB.model);
      return { label: `BTC ${s > 0 ? "+" : ""}${Math.round(s * 100)}%`, after: r.dPnl, before: rb.dPnl, level: r.level };
    });
    const target = after.target;
    return {
      after, portfolioAfter: pfA, riskAfter: rkA, mark, notional, fees, fundingCost, horizonDays,
      lossIfInvalidated, gainAtTarget, rr, ev, pWin: p,
      newLiq: target?.liq, newLiqDist: target?.liqDist, newLevel: rkA.level, oldLevel: rkB.level,
      newMarginUtil: after.account.marginUtilisation, oldMarginUtil: snapshot.account.marginUtilisation, marginOk: after.marginOk,
      deltas: {
        expectedReturn: ev, cvar: (pfA.cvar95_1d || 0) - (pfB.cvar95_1d || 0), liqRisk: isNum(worstA) && isNum(worstB) ? worstA - worstB : isNum(worstA) ? worstA - 1 : NaN,
        funding: (rkA.fundingPerDay || 0) - (rkB.fundingPerDay || 0), correlation: (pfA.volNormal > 0 ? pfA.volStress / pfA.volNormal : 1) - (pfB.volNormal > 0 ? pfB.volStress / pfB.volNormal : 1),
        netExposure: (pfA.net || 0) - (pfB.net || 0), grossExposure: (pfA.gross || 0) - (pfB.gross || 0),
        stressLoss: (rkA.combined?.dPnl || 0) - (rkB.combined?.dPnl || 0), betaBTC: (pfA.betaBTC || 0) - (pfB.betaBTC || 0), concentration: (pfA.maxShare || 0) - (pfB.maxShare || 0),
      },
      scenarios,
    };
  }

  // ---- scenario engine ---------------------------------------------------------------
  function applyScenario(snapshot, overrides, features, settings = {}) {
    const positions = snapshot?.positions || [];
    const shocks = {};
    for (const p of positions) {
      const o = overrides[p.coin];
      if (!o) continue;
      if (isNum(o.pct)) shocks[p.coin] = o.pct;
      else if (isNum(o.price) && isNum(p.mark) && p.mark > 0) shocks[p.coin] = o.price / p.mark - 1;
    }
    const model = AOS.risk.marginModel(positions, snapshot.account);
    const r = AOS.risk.shock(positions, snapshot.account, shocks, model);
    const rows = positions.map((p, i) => {
      const s = shocks[p.coin] || 0;
      const px1 = p.mark * (1 + s);
      const pnl = p.szi * (px1 - p.mark);
      const liqDist = isNum(p.liq) && p.liq > 0 ? (p.side === "LONG" ? (px1 - p.liq) / px1 : (p.liq - px1) / px1) : NaN;
      return { coin: p.coin, side: p.side, px0: p.mark, px1, move: s, pnlDelta: pnl, upnl1: (isNum(p.upnl) ? p.upnl : 0) + pnl, liqDist1: liqDist, liquidatedAlone: isNum(liqDist) && liqDist <= 0 };
    });
    return { shocks, rows, equity0: snapshot.account?.equity, equity1: r.equity1, dPnl: r.dPnl, mm1: r.mm1, bufferRatio: r.bufferRatio, level: r.level, liquidated: r.liquidated, marginUtil1: isNum(r.equity1) && r.equity1 > 0 ? snapshot.account.marginUsed / r.equity1 : NaN };
  }

  /** Natural-language scenario parser (fr/en). "BTC baisse de 12 %, ETH monte de 5% et SOL = 150" */
  function parseScenario(text, knownCoins = []) {
    const out = {};
    if (!text) return out;
    const coins = new Set([...knownCoins, "BTC", "ETH", "SOL"]);
    const norm = text.replace(/−/g, "-").replace(/,/g, " , ");
    const clauses = norm.split(/[,;]|\bet\b|\band\b|\bpuis\b/i).map((s) => s.trim()).filter(Boolean);
    for (const cl of clauses) {
      const cm = cl.match(/\b([A-Za-z]{2,10})\b/g);
      const coin = (cm || []).map((c) => c.toUpperCase()).find((c) => coins.has(c));
      if (!coin) continue;
      const rest = cl.replace(new RegExp("\\b" + coin + "\\b", "i"), " ");
      const neg = /\b(baisse|chute|perd|tombe|recule|d[ée]croche|drop|fall|down|dump|crash|lose|-)\b/i.test(rest) || /(^|\s)-\s*\d/.test(rest);
      const pos = /\b(monte|hausse|gagne|prend|grimpe|rebondit|pump|rise|up|rally|gain|\+)\b/i.test(rest) || /(^|\s)\+\s*\d/.test(rest);
      const pctM = rest.match(/([+-]?\s*\d+(?:[.]\d+)?)\s*%/);
      const absM = rest.match(/(?:=|à|a|to|@|vaut|atteint|touche|revient à|sur)\s*\$?\s*(\d+(?:[.]\d+)?)\s*(k|K)?/) || rest.match(/^\s*=?\s*\$?\s*(\d{2,}(?:[.]\d+)?)\s*(k|K)?\s*$/);
      if (pctM) {
        let v = Number(pctM[1].replace(/\s/g, "")) / 100;
        if (neg && v > 0) v = -v; if (pos && v < 0) v = -v;
        out[coin] = { pct: v };
      } else if (absM) {
        let v = Number(absM[1]); if (absM[2]) v *= 1000;
        out[coin] = { price: v };
      } else if (/\b(reste|stable|flat|unchanged|inchang)/i.test(rest)) out[coin] = { pct: 0 };
    }
    return out;
  }

  AOS.simulate = { TAKER_FEE, ROUND_TRIP_COST, liqPriceFor, applyTrade, suggestLevels, impact, applyScenario, parseScenario };
})(typeof window !== "undefined" ? window : globalThis);
