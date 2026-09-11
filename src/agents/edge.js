/* SEAT 03 — EDGE · Quant / Setup Hunter. Scans tracked assets for asymmetric setups and computes EV after costs.
   Probabilities are PRIORS (ESTIMATED) until the calibration engine has ≥ 30 resolved decisions for a setup type. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, stats, uncertainty } = AOS.util;

  const PRIORS = { trendPullback: 0.47, breakout: 0.42, failedBreakout: 0.46, meanReversion: 0.52, fundingSqueeze: 0.44 };
  const HORIZON = { trendPullback: 5, breakout: 4, failedBreakout: 3, meanReversion: 2, fundingSqueeze: 3 };
  const NAMES = { trendPullback: "Trend continuation (pullback)", breakout: "Breakout", failedBreakout: "Failed breakout / liquidity sweep", meanReversion: "Mean reversion", fundingSqueeze: "Funding squeeze" };

  function scan(coin, f, ctx) {
    const out = [];
    const { features, history, snapshot } = ctx;
    if (!f?.d1 || !f?.h4) return out;
    const d = f.d1, h = f.h4, p = f.price;
    const reg = features?.regime || {};
    const fh = history?.funding?.[coin] || [];
    const f7d = stats.mean(fh.slice(-168).map((r) => r.rate));
    const prevHigh20 = Math.max(...(d.closes.slice(-21, -1).length ? d.closes.slice(-21, -1) : [NaN]));
    const prevLow20 = Math.min(...(d.closes.slice(-21, -1).length ? d.closes.slice(-21, -1) : [NaN]));
    const push = (type, side, why) => out.push({ type, side, coin, why });
    // trend pullback
    if (d.trendScore >= 2 && isNum(h.ema20) && isNum(h.atr) && Math.abs(p - h.ema20) / h.atr < 1.0 && h.rsi >= 38 && h.rsi <= 58) push("trendPullback", "LONG", `Tendance 1d haussière (score ${d.trendScore}), repli sur EMA20 4h, RSI 4h ${h.rsi.toFixed(0)}`);
    if (d.trendScore <= -2 && isNum(h.ema20) && isNum(h.atr) && Math.abs(p - h.ema20) / h.atr < 1.0 && h.rsi >= 42 && h.rsi <= 62) push("trendPullback", "SHORT", `Tendance 1d baissière (score ${d.trendScore}), rebond sur EMA20 4h, RSI 4h ${h.rsi.toFixed(0)}`);
    // breakout with volume
    const volOk = isNum(d.volAvg20) && d.volAvg20 > 0 && d.volLast / d.volAvg20 > 1.3;
    if (isNum(prevHigh20) && p > prevHigh20 && volOk) push("breakout", "LONG", `Clôture > plus-haut 20j (${Math.round(prevHigh20)}) avec volume ${(d.volLast / d.volAvg20).toFixed(1)}× la moyenne`);
    if (isNum(prevLow20) && p < prevLow20 && volOk) push("breakout", "SHORT", `Clôture < plus-bas 20j (${Math.round(prevLow20)}) avec volume ${(d.volLast / d.volAvg20).toFixed(1)}× la moyenne`);
    // failed breakout (4h wick through the 20d level, close back inside)
    if (isNum(prevHigh20) && h.prevHigh > prevHigh20 && h.prevClose < prevHigh20 && p < prevHigh20) push("failedBreakout", "SHORT", `Mèche 4h au-dessus du plus-haut 20j (${Math.round(prevHigh20)}) puis clôture en dessous : sweep de liquidité`);
    if (isNum(prevLow20) && h.prevLow < prevLow20 && h.prevClose > prevLow20 && p > prevLow20) push("failedBreakout", "LONG", `Mèche 4h sous le plus-bas 20j (${Math.round(prevLow20)}) puis clôture au-dessus : sweep de liquidité`);
    // mean reversion (only in non-trending regimes)
    const mrRegime = ["Mean-Reversion Regime", "Compression", "Re-Accumulation", "Distribution"].includes(reg.regime);
    if (mrRegime && isNum(h.sd20) && h.rsi < 28 && p < h.mean20 - 2 * h.sd20) push("meanReversion", "LONG", `RSI 4h ${h.rsi.toFixed(0)} et prix < moyenne 20 − 2σ en régime ${reg.regime}`);
    if (mrRegime && isNum(h.sd20) && h.rsi > 72 && p > h.mean20 + 2 * h.sd20) push("meanReversion", "SHORT", `RSI 4h ${h.rsi.toFixed(0)} et prix > moyenne 20 + 2σ en régime ${reg.regime}`);
    // funding squeeze
    if (isNum(f7d) && f7d < -0.00001 && p > d.ema50) push("fundingSqueeze", "LONG", `Funding 7j négatif (${(f7d * 2400).toFixed(3)}%/j) alors que le prix tient l'EMA50 : shorts payants et piégés`);
    if (isNum(f7d) && f7d > 0.00003 && p < d.ema50) push("fundingSqueeze", "SHORT", `Funding 7j élevé (${(f7d * 2400).toFixed(3)}%/j) alors que le prix perd l'EMA50 : longs payants et piégés`);
    return out;
  }

  function evaluate(setup, ctx, flowVotes, calibration) {
    const { features, snapshot, settings } = ctx;
    const f = features.byCoin[setup.coin];
    const mark = f.price;
    const levels = AOS.simulate.suggestLevels({ coin: setup.coin, side: setup.side }, features, mark);
    const risk = levels.risk;
    if (!isNum(risk) || risk <= 0) return null;
    const rr = Math.abs(levels.target - mark) / risk;
    const reg = features.regime || {};
    const sideSign = setup.side === "LONG" ? 1 : -1;
    let p = PRIORS[setup.type];
    const adj = [];
    if (reg.bias === "BULL") { p += 0.04 * sideSign; adj.push(`régime ${reg.bias} ${sideSign > 0 ? "+" : "−"}4pts`); }
    if (reg.bias === "BEAR") { p -= 0.04 * sideSign; adj.push(`régime ${reg.bias} ${sideSign > 0 ? "−" : "+"}4pts`); }
    if (reg.regime === "Panic Deleveraging" && setup.side === "LONG" && setup.type !== "meanReversion") { p -= 0.05; adj.push("panic deleveraging −5pts"); }
    if (reg.regime === "Bull Exhaustion" && setup.type === "breakout" && setup.side === "LONG") { p -= 0.05; adj.push("bull exhaustion −5pts"); }
    const fv = flowVotes?.[setup.coin]?.dir;
    if (isNum(fv)) { const a = clamp(fv * sideSign * 0.05, -0.05, 0.05); p += a; adj.push(`flow ${a >= 0 ? "+" : "−"}${Math.abs(a * 100).toFixed(1)}pts`); }
    // calibration override when enough resolved decisions exist for this setup type
    const cal = calibration?.[setup.type];
    let calibrated = false;
    if (cal && cal.n >= 30 && isNum(cal.hitRate)) { p = 0.5 * p + 0.5 * cal.hitRate; calibrated = true; adj.push(`calibration (${cal.n} décisions) → ${(cal.hitRate * 100).toFixed(0)}%`); }
    p = clamp(p, 0.25, 0.7);
    const notional = 1; // per unit notional
    const cost = AOS.simulate.ROUND_TRIP_COST;
    const horizon = HORIZON[setup.type];
    const fh = snapshot?.meta?.assets?.[setup.coin]?.fundingHourly;
    const fundingCost = isNum(fh) ? sideSign * fh * 24 * horizon : 0; // fraction of notional, positive = cost
    const riskPct = risk / mark;
    const costR = (cost + fundingCost) / riskPct; // costs expressed in R
    const evR = p * rr - (1 - p) - costR;
    const evRBefore = p * rr - (1 - p);
    const mfeEst = rr * risk * p + risk * 0.4 * (1 - p), maeEst = risk * (0.55 + 0.3 * (1 - p));
    const confidence = clamp(0.5 * (evR / 1.5) + 0.5 * (p - 0.35) / 0.35, 0, 1);
    return {
      id: `${setup.coin}-${setup.side}-${setup.type}`, coin: setup.coin, side: setup.side, type: setup.type, name: NAMES[setup.type], why: setup.why,
      entry: mark, invalidation: levels.invalidation, invalidationWhy: levels.invalidationWhy, target: levels.target, target2: levels.target2, target3: levels.target3, targetWhy: levels.targetWhy,
      risk, riskPct, rr, pWin: p, pAdjustments: adj, calibrated, evR, evRBeforeCosts: evRBefore, expectedPayoffPct: evR * riskPct, costR, fundingCostPct: fundingCost, feePct: cost,
      horizonDays: horizon, mfeEst, maeEst, confidence, uncertainty: calibrated ? uncertainty(cal.n, 100, 30) : "HIGH",
      pRange: calibrated ? [clamp(p - 0.08, 0, 1), clamp(p + 0.08, 0, 1)] : [clamp(p - 0.15, 0, 1), clamp(p + 0.15, 0, 1)],
      prov: "ESTIMATED",
    };
  }

  function run(ctx, flowVotes, calibration) {
    const { features, snapshot } = ctx;
    const coins = new Set(["BTC", "ETH", "SOL", ...(snapshot?.positions || []).map((p) => p.coin), ...Object.keys(features?.byCoin || {}).filter((c) => features.byCoin[c]?.h4)]);
    const found = [];
    for (const c of coins) for (const s of scan(c, features.byCoin[c], ctx)) { const e = evaluate(s, ctx, flowVotes, calibration); if (e) found.push(e); }
    const minEv = 0.15;
    const accepted = found.filter((o) => o.evR >= minEv).sort((a, b) => b.evR - a.evR);
    const rejected = found.filter((o) => o.evR < minEv).map((o) => ({ ...o, rejectReason: `EV après coûts ${o.evR.toFixed(2)}R < ${minEv}R` }));
    const votes = {};
    for (const c of coins) {
      const mine = found.filter((o) => o.coin === c);
      if (!mine.length) { votes[c] = { dir: 0, confidence: 0.1, reasons: ["Aucun setup détecté"], prov: "CALCULATED" }; continue; }
      const best = mine.sort((a, b) => b.evR - a.evR)[0];
      const dir = clamp(best.evR / 1.5, 0, 1) * (best.side === "LONG" ? 1 : -1);
      votes[c] = { dir, confidence: clamp(best.confidence, 0.05, 0.9), reasons: [`${best.name} ${best.side} : EV ${best.evR.toFixed(2)}R, p≈${Math.round(best.pWin * 100)}%, RR ${best.rr.toFixed(1)}`], prov: "ESTIMATED" };
    }
    const top = accepted[0];
    return {
      agent: "EDGE", seat: "03", role: "Quant / Setup Hunter", timestamp: new Date().toISOString(),
      direction: top ? (top.side === "LONG" ? "bullish" : "bearish") : "neutral", confidence: top ? clamp(top.confidence, 0.05, 0.9) : 0.1,
      expected_return: top ? top.expectedPayoffPct : NaN, expected_loss: top ? -top.riskPct : NaN, time_horizon: top ? top.horizonDays + "d" : "—",
      signals: accepted.slice(0, 3).map((o) => `${o.coin} ${o.side} · ${o.name} · EV ${o.evR.toFixed(2)}R`),
      risks: rejected.slice(0, 2).map((o) => `Rejeté : ${o.coin} ${o.side} ${o.name} (${o.rejectReason})`),
      invalidation: top ? [`${top.coin} ${top.side}: invalidation ${AOS.util.fmt.px(top.invalidation)} (${top.invalidationWhy})`] : [],
      recommendation: top ? `${top.side} ${top.coin}` : "NO TRADE", position_size_modifier: top ? clamp(0.5 + top.confidence * 0.5, 0.5, 1) : 0,
      opportunities: accepted, rejected, votes, prov: "ESTIMATED", note: "Probabilités = priors ajustés (régime, flow) tant que < 30 décisions résolues par type de setup.",
    };
  }
  AOS.agents = AOS.agents || {};
  AOS.agents.EDGE = { run, scan, evaluate, PRIORS, NAMES, HORIZON };
})(typeof window !== "undefined" ? window : globalThis);
