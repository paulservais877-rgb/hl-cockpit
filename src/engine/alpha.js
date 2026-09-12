/* Personal Alpha OS — ARCHIVE engine: trade reconstruction from fills, performance statistics, funding & fee leakage,
   alpha vs BTC / ETH / mix / nothing (modified Dietz on account value with signed ledger flows), PnL attribution,
   regime-tagged trades, counterfactuals. Everything is HISTORICAL/CALCULATED; approximations are labelled ESTIMATED.
   Validated on live data: fills are capped (2000 per page) and may start mid-position (startPosition ≠ 0);
   the `portfolio` endpoint exposes perps-only series (perpDay/perpWeek/perpMonth/perpAllTime) next to whole-account series. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, stats, D, H, clamp, uncertainty } = AOS.util;

  /** Reconstruct round-trip trades from fills (position goes 0 → x → 0). Trades that started before the fill window are flagged `truncated`. */
  function reconstructTrades(fills) {
    const byCoin = {};
    const trades = [];
    const newTrade = (f, side, extra = {}) => ({ coin: f.coin, side, openTs: f.t, fills: [], realized: 0, fees: 0, maxSize: 0, entryNotional: 0, entryQty: 0, exitNotional: 0, exitQty: 0, truncated: false, ...extra });
    for (const f of fills || []) {
      const signed = (f.side === "BUY" ? 1 : -1) * f.sz;
      let st = byCoin[f.coin];
      if (!st) {
        // first fill seen for this coin: the position before it is given by startPosition
        const sp = isNum(f.startPosition) ? f.startPosition : 0;
        st = byCoin[f.coin] = { pos: sp, cur: null };
        if (Math.abs(sp) > 1e-9) { st.cur = newTrade(f, sp > 0 ? "LONG" : "SHORT", { truncated: true, maxSize: Math.abs(sp) }); st.cur.openTs = NaN; }
      }
      if (!st.cur || Math.abs(st.pos) < 1e-9) st.cur = newTrade(f, signed > 0 ? "LONG" : "SHORT");
      const t = st.cur;
      const opening = Math.sign(signed) === (t.side === "LONG" ? 1 : -1);
      t.fills.push(f);
      t.realized += isNum(f.closedPnl) ? f.closedPnl : 0;
      t.fees += isNum(f.fee) ? f.fee : 0;
      if (opening) { t.entryNotional += f.sz * f.px; t.entryQty += f.sz; } else { t.exitNotional += f.sz * f.px; t.exitQty += f.sz; }
      st.pos += signed;
      t.maxSize = Math.max(t.maxSize, Math.abs(st.pos));
      const close = () => { t.closeTs = f.t; t.durationMs = isNum(t.openTs) ? f.t - t.openTs : NaN; t.avgEntry = t.entryQty ? t.entryNotional / t.entryQty : NaN; t.avgExit = t.exitQty ? t.exitNotional / t.exitQty : NaN; t.net = t.realized - t.fees; t.status = "CLOSED"; trades.push(t); };
      if (Math.abs(st.pos) < 1e-9) { close(); st.cur = null; st.pos = 0; }
      else if (Math.sign(st.pos) !== (t.side === "LONG" ? 1 : -1)) { // flipped: close current, open opposite with the remainder
        close();
        st.cur = newTrade(f, st.pos > 0 ? "LONG" : "SHORT", { maxSize: Math.abs(st.pos), entryNotional: Math.abs(st.pos) * f.px, entryQty: Math.abs(st.pos) });
        st.cur.fills.push(f);
      }
    }
    const open = Object.values(byCoin).filter((s) => s.cur && Math.abs(s.pos) > 1e-9).map((s) => ({ ...s.cur, status: "OPEN", avgEntry: s.cur.entryQty ? s.cur.entryNotional / s.cur.entryQty : NaN, durationMs: isNum(s.cur.openTs) ? Date.now() - s.cur.openTs : NaN }));
    return { closed: trades, open, complete: trades.filter((t) => !t.truncated), truncatedCount: trades.filter((t) => t.truncated).length };
  }

  function tradeStats(closed) {
    const n = closed.length;
    const wins = closed.filter((t) => t.net > 0), losses = closed.filter((t) => t.net <= 0);
    const avgWin = stats.mean(wins.map((t) => t.net)), avgLoss = stats.mean(losses.map((t) => t.net));
    const grossWin = stats.sum(wins.map((t) => t.net)), grossLoss = -stats.sum(losses.map((t) => t.net));
    const by = (key) => Object.entries(AOS.util.groupBy(closed, key)).map(([k, arr]) => ({ key: k, n: arr.length, net: stats.sum(arr.map((t) => t.net)), winRate: arr.filter((t) => t.net > 0).length / arr.length, fees: stats.sum(arr.map((t) => t.fees)) })).sort((a, b) => b.net - a.net);
    return {
      n, winRate: n ? wins.length / n : NaN, avgWin, avgLoss, profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : NaN,
      expectancy: n ? stats.sum(closed.map((t) => t.net)) / n : NaN, net: stats.sum(closed.map((t) => t.net)), fees: stats.sum(closed.map((t) => t.fees)),
      avgHoldMs: stats.mean(closed.map((t) => t.durationMs)), byAsset: by((t) => t.coin), bySide: by((t) => t.side), byRegime: by((t) => t.regime || "UNKNOWN"),
      uncertainty: uncertainty(n, 60, 20),
    };
  }

  /** Modified Dietz return between two timestamps using an account-value series and signed flows [{t, amt}]. */
  function dietz(accountValue, flows, t0, t1) {
    const av = accountValue.filter((p) => p[0] >= t0 - D && p[0] <= t1 + D);
    if (av.length < 2) return { ret: NaN, prov: "UNKNOWN" };
    const v0 = av[0][1], v1 = av[av.length - 1][1];
    const T0 = av[0][0], T1 = av[av.length - 1][0];
    const fl = (flows || []).filter((f) => f.t > T0 && f.t <= T1 && isNum(f.amt) && f.amt !== 0);
    const F = stats.sum(fl.map((f) => f.amt));
    const W = stats.sum(fl.map((f) => f.amt * (T1 - f.t) / Math.max(T1 - T0, 1)));
    const denom = v0 + W;
    // a series that starts near 0 (account funded after the first point) has no meaningful % return: report NaN, the $ PnL is shown instead
    const degenerate = !(v0 > 0) || v0 < 0.05 * Math.abs(F);
    return { ret: denom > 0 && !degenerate ? (v1 - v0 - F) / denom : NaN, v0, v1, flows: F, flowCount: fl.length, t0: T0, t1: T1, degenerate, prov: degenerate ? "UNKNOWN" : fl.length ? "CALCULATED" : "ESTIMATED" };
  }
  // backward compatible wrapper (ledger rows → flows)
  const dietzLedger = (accountValue, ledger, t0, t1, kind = "perps") => dietz(accountValue, (ledger || []).map((l) => ({ t: l.t, amt: kind === "perps" ? l.flowPerps : l.flowTotal })), t0, t1);

  function benchmarkReturn(candles1d, t0, t1) {
    if (!candles1d?.length) return NaN;
    const at = (t) => { let best = null; for (const k of candles1d) { if (k.t <= t) best = k; else break; } return best ? best.c : candles1d[0].c; };
    const a = at(t0), b = at(t1);
    return a > 0 ? b / a - 1 : NaN;
  }

  function maxDrawdown(series) {
    let peak = -Infinity, mdd = 0, cur = 0;
    for (const [, v] of series) { peak = Math.max(peak, v); cur = peak > 0 ? v / peak - 1 : 0; mdd = Math.min(mdd, cur); }
    return { mdd, current: cur };
  }

  function sharpeSortino(accountValue) {
    const rets = [];
    for (let i = 1; i < accountValue.length; i++) { const a = accountValue[i - 1][1], b = accountValue[i][1]; if (a > 0) rets.push(b / a - 1); }
    if (rets.length < 5) return { sharpe: NaN, sortino: NaN, n: rets.length };
    const m = stats.mean(rets), s = stats.stdev(rets);
    const downs = rets.filter((x) => x < 0);
    const ds = downs.length ? Math.sqrt(stats.sum(downs.map((x) => x * x)) / rets.length) : NaN;
    // points are irregular (≈ 1/day for month, more for week); annualise by observed spacing
    const spanDays = (accountValue[accountValue.length - 1][0] - accountValue[0][0]) / D;
    const perYear = spanDays > 0 ? (rets.length / spanDays) * 365 : 365;
    return { sharpe: s > 0 ? (m / s) * Math.sqrt(perYear) : NaN, sortino: ds > 0 ? (m / ds) * Math.sqrt(perYear) : NaN, n: rets.length };
  }

  /** Full ARCHIVE computation. */
  function compute(snapshot, history, features) {
    const fills = history?.fills || [];
    const rec = reconstructTrades(fills);
    const { closed, open } = rec;
    const complete = rec.complete;
    // regime tag at trade open (BTC daily candles up to that time)
    const btc1d = history?.candles?.BTC?.["1d"] || [];
    const regimeCache = {};
    for (const t of closed) {
      if (!isNum(t.openTs)) { t.regime = "UNKNOWN"; continue; }
      const day = Math.floor(t.openTs / D);
      if (!regimeCache[day]) {
        const slice = btc1d.filter((k) => k.t <= t.openTs);
        regimeCache[day] = slice.length >= 60 ? AOS.features.classifyRegime(AOS.features.assetFeatures("BTC", { "1d": slice }, { markPx: slice[slice.length - 1].c }), NaN, {}).regime : "UNKNOWN";
      }
      t.regime = regimeCache[day];
    }
    const st = tradeStats(complete);
    const uf = history?.userFunding || [];
    const fundingPaid = -stats.sum(uf.filter((r) => r.usdc < 0).map((r) => r.usdc)), fundingReceived = stats.sum(uf.filter((r) => r.usdc > 0).map((r) => r.usdc));
    const fundingByCoin = Object.entries(AOS.util.groupBy(uf, (r) => r.coin)).map(([coin, arr]) => ({ coin, net: stats.sum(arr.map((r) => r.usdc)) })).sort((a, b) => a.net - b.net);
    const pf = history?.portfolio || {};
    const ledger = history?.ledger || [];
    const windows = {};
    const windowFor = (key, days, kind) => {
      const series = pf[key]?.accountValue || [];
      if (series.length < 2) return { key, kind, ret: NaN, prov: "UNKNOWN" };
      const t0 = series[0][0], t1 = series[series.length - 1][0];
      const dz = dietzLedger(series, ledger, t0, t1, kind);
      if (dz.degenerate) return { key, kind, ret: NaN, prov: "UNKNOWN", days: Math.round((t1 - t0) / D), t0, t1, v0: dz.v0, v1: dz.v1, flows: dz.flows, pnl: pf[key]?.pnl?.length ? pf[key].pnl[pf[key].pnl.length - 1][1] : NaN, note: "compte parti de 0 sur cette fenêtre : rendement % non calculable, voir le PnL en dollars", mdd: maxDrawdown(series) };
      const rB = benchmarkReturn(history?.candles?.BTC?.["1d"], t0, t1), rE = benchmarkReturn(history?.candles?.ETH?.["1d"], t0, t1);
      const feesW = stats.sum(fills.filter((f) => f.t >= t0 && f.t <= t1).map((f) => f.fee || 0));
      const fundW = stats.sum(uf.filter((f) => f.t >= t0 && f.t <= t1).map((f) => f.usdc));
      const costPct = dz.v0 > 0 ? (feesW - fundW) / dz.v0 : NaN; // positive = drag
      const pnlSeries = pf[key]?.pnl || [];
      const pnlW = pnlSeries.length ? pnlSeries[pnlSeries.length - 1][1] - pnlSeries[0][1] : NaN;
      return {
        key, kind, days: isNum(days) ? days : Math.round((t1 - t0) / D), t0, t1, ret: dz.ret, prov: dz.prov, v0: dz.v0, v1: dz.v1, flows: dz.flows, pnl: pnlW,
        btc: rB, eth: rE, mix: isNum(rB) && isNum(rE) ? (rB + rE) / 2 : NaN,
        alphaBTC: isNum(dz.ret) && isNum(rB) ? dz.ret - rB : NaN, alphaETH: isNum(dz.ret) && isNum(rE) ? dz.ret - rE : NaN, alphaMix: isNum(dz.ret) && isNum(rB) && isNum(rE) ? dz.ret - (rB + rE) / 2 : NaN, alphaNothing: dz.ret,
        fees: feesW, fundingNet: fundW, costPct, alphaBTCBeforeCosts: isNum(dz.ret) && isNum(rB) && isNum(costPct) ? dz.ret + costPct - rB : NaN,
        mdd: maxDrawdown(series), ...sharpeSortino(series), feesCoverage: fills.length && fills[0].t > t0 ? "PARTIAL" : "FULL",
      };
    };
    // trading windows use the perps-only series when the API provides them (it does on live data)
    const hasPerp = !!pf.perpMonth;
    windows.week = windowFor(hasPerp ? "perpWeek" : "week", 7, "perps");
    windows.month = windowFor(hasPerp ? "perpMonth" : "month", 30, "perps");
    windows.allTime = windowFor(hasPerp ? "perpAllTime" : "allTime", NaN, "perps");
    windows.totalMonth = windowFor("month", 30, "total");
    windows.totalAllTime = windowFor("allTime", NaN, "total");
    const perpsAllTimePnl = pf.perpAllTime?.pnl?.length ? pf.perpAllTime.pnl[pf.perpAllTime.pnl.length - 1][1] : NaN;
    const totalNow = pf.day?.accountValue?.length ? pf.day.accountValue[pf.day.accountValue.length - 1][1] : NaN;
    const perpsNow = pf.perpDay?.accountValue?.length ? pf.perpDay.accountValue[pf.perpDay.accountValue.length - 1][1] : NaN;
    const capital = { totalHL: totalNow, perps: isNum(perpsNow) ? perpsNow : snapshot?.account?.equity, other: isNum(totalNow) && isNum(perpsNow) ? totalNow - perpsNow : NaN, spot: history?.spot || null, deposits: stats.sum(ledger.filter((l) => /^deposit$/i.test(l.type)).map((l) => l.usdc)), withdrawals: stats.sum(ledger.filter((l) => /withdraw|^send$/i.test(l.type)).map((l) => l.usdc)), prov: isNum(totalNow) ? "HISTORICAL" : "UNKNOWN" };
    // attribution over the month window (ESTIMATED): beta × benchmark + funding + fees + residual
    const m = windows.month;
    let attribution = null;
    if (m && isNum(m.pnl) && isNum(m.btc)) {
      const beta = features?.portfolioAnalysis?.betaBTC;
      const avgEq = isNum(m.v0) && isNum(m.v1) ? (m.v0 + m.v1) / 2 : m.v0;
      const betaPnl = isNum(beta) ? beta * m.btc * avgEq : NaN;
      const closedInWin = complete.filter((t) => t.closeTs >= m.t0);
      const longPnl = stats.sum(closedInWin.filter((t) => t.side === "LONG").map((t) => t.realized)), shortPnl = stats.sum(closedInWin.filter((t) => t.side === "SHORT").map((t) => t.realized));
      const residual = m.pnl - (isNum(betaPnl) ? betaPnl : 0) - m.fundingNet + m.fees;
      attribution = [
        { name: "Beta BTC (marché)", value: betaPnl, note: isNum(beta) ? `β ${beta.toFixed(2)} × BTC ${(m.btc * 100).toFixed(1)}% (beta actuel, pas moyen)` : "β inconnu", prov: "ESTIMATED" },
        { name: "Sélection + timing (alpha idiosyncratique)", value: residual, note: "PnL − beta − funding + fees", prov: "ESTIMATED" },
        { name: "Funding net", value: m.fundingNet, note: "reçu − payé", prov: "HISTORICAL" },
        { name: "Frais", value: -m.fees, note: m.feesCoverage === "PARTIAL" ? "fills partiels sur la fenêtre" : "fills", prov: "HISTORICAL" },
        { name: "Jambes courtes (hedge) réalisé", value: shortPnl, note: `${closedInWin.filter((t) => t.side === "SHORT").length} trades`, prov: "HISTORICAL" },
        { name: "Jambes longues réalisé", value: longPnl, note: `${closedInWin.filter((t) => t.side === "LONG").length} trades`, prov: "HISTORICAL" },
      ];
    }
    // counterfactuals for closed trades within the 1h candle window
    const cf = [];
    for (const t of complete.slice(-40)) {
      const c1h = history?.candles?.[t.coin]?.["1h"];
      const btc1h = history?.candles?.BTC?.["1h"];
      if (!c1h?.length || t.openTs < c1h[0].t) { cf.push({ coin: t.coin, side: t.side, openTs: t.openTs, closeTs: t.closeTs, actual: t.net, hold: NaN, mfe: NaN, mae: NaN, btc: NaN, prov: "UNKNOWN" }); continue; }
      const inTrade = c1h.filter((k) => k.t >= t.openTs && k.t <= t.closeTs);
      const dir = t.side === "LONG" ? 1 : -1;
      const q = t.maxSize;
      const mfe = inTrade.length ? Math.max(...inTrade.map((k) => dir * ((dir > 0 ? k.h : k.l) - t.avgEntry) * q)) : NaN;
      const mae = inTrade.length ? Math.min(...inTrade.map((k) => dir * ((dir > 0 ? k.l : k.h) - t.avgEntry) * q)) : NaN;
      const now = c1h[c1h.length - 1].c;
      const hold = dir * (now - t.avgEntry) * q - t.fees;
      const b0 = btc1h?.find((k) => k.t >= t.openTs)?.c, b1 = btc1h?.slice().reverse().find((k) => k.t <= t.closeTs)?.c;
      const btc = isNum(b0) && isNum(b1) && b0 > 0 ? (b1 / b0 - 1) * t.avgEntry * q : NaN;
      cf.push({ coin: t.coin, side: t.side, openTs: t.openTs, closeTs: t.closeTs, actual: t.net, hold, mfe, mae, btc, regime: t.regime, captured: isNum(mfe) && mfe > 0 ? t.realized / mfe : NaN, prov: "CALCULATED" });
    }
    // pattern statements (only when n≥5 in a bucket)
    const patterns = [];
    for (const r of st.byRegime) if (r.n >= 5 && r.key !== "UNKNOWN") patterns.push(`${r.key} : ${r.n} trades, win rate ${Math.round(r.winRate * 100)}%, net ${r.net >= 0 ? "+" : "−"}$${Math.abs(r.net).toFixed(0)}`);
    for (const s of st.bySide) if (s.n >= 5) patterns.push(`${s.key} : ${s.n} trades, win rate ${Math.round(s.winRate * 100)}%, net ${s.net >= 0 ? "+" : "−"}$${Math.abs(s.net).toFixed(0)}`);
    const sideRegime = AOS.util.groupBy(complete, (t) => t.side + " / " + (t.regime || "UNKNOWN"));
    for (const [k, arr] of Object.entries(sideRegime)) if (arr.length >= 5 && !/UNKNOWN/.test(k)) { const net = stats.sum(arr.map((t) => t.net)); patterns.push(`${k} : ${arr.length} trades, ${net >= 0 ? "crée" : "détruit"} de l'alpha (${net >= 0 ? "+" : "−"}$${Math.abs(net).toFixed(0)})`); }
    const captured = cf.filter((c) => isNum(c.captured));
    if (captured.length >= 5) patterns.push(`Capture moyenne du MFE : ${Math.round(stats.mean(captured.map((c) => clamp(c.captured, -1, 1))) * 100)}% (${captured.length} trades)`);
    const fillsSpanDays = fills.length ? (fills[fills.length - 1].t - fills[0].t) / D : 0;
    const activity = { fills: fills.length, spanDays: fillsSpanDays, fillsPerDay: fillsSpanDays > 0 ? fills.length / fillsSpanDays : NaN, tradesPerWeek: fillsSpanDays > 0 ? (closed.length / fillsSpanDays) * 7 : NaN, truncatedWindow: !!fills.truncated };
    return { closed, open, complete, truncatedCount: rec.truncatedCount, stats: st, fundingPaid, fundingReceived, fundingNet: fundingReceived - fundingPaid, fundingByCoin, windows, capital, perpsAllTimePnl, attribution, counterfactuals: cf, patterns, activity, leakage: { fees90d: stats.sum(fills.map((f) => f.fee || 0)), feesWindowDays: fillsSpanDays, funding90d: stats.sum(uf.map((r) => r.usdc)) }, prov: fills.length ? "HISTORICAL" : "UNKNOWN", fillsCount: fills.length };
  }

  /**
   * Courbe d'equity rebasée (héritée de Cryptex) : valeur du compte hors dépôts/retraits, en % depuis le début de la fenêtre,
   * BTC rebasé sur la même fenêtre (clôture journalière ≤ t), plus-haut historique (HWM) et repli courant.
   * L'écart d'alignement entre le premier point du compte et la bougie BTC utilisée est déclaré, jamais masqué.
   */
  function equityCurve(history, key = "perpMonth", kind = "perps") {
    const pf = history?.portfolio || {};
    const series = pf[key]?.accountValue || [];
    if (series.length < 2) return { ok: false, reason: "série de valeur indisponible", key, prov: "UNKNOWN" };
    const ledger = history?.ledger || [];
    const t0 = series[0][0], v0 = series[0][1];
    if (!(v0 > 0)) return { ok: false, reason: "compte parti de 0 sur cette fenêtre : courbe en % non calculable", key, prov: "UNKNOWN" };
    const flows = ledger.filter((l) => l.t > t0).map((l) => ({ t: l.t, amt: kind === "perps" ? l.flowPerps : l.flowTotal })).filter((f) => isNum(f.amt) && f.amt !== 0).sort((a, b) => a.t - b.t);
    const btc = history?.candles?.BTC?.["1d"] || [];
    const closeAt = (t) => { let best = null; for (const k of btc) { if (k.t <= t) best = k; else break; } return best; };
    const b0 = closeAt(t0) || btc[0] || null;
    let fi = 0, cum = 0, peak = -Infinity;
    const points = series.map(([t, v]) => {
      while (fi < flows.length && flows[fi].t <= t) { cum += flows[fi].amt; fi++; }
      const adj = v - cum; // valeur nette des flux : une hausse due à un dépôt n'est pas une performance
      peak = Math.max(peak, adj);
      const bk = b0 ? closeAt(t) : null;
      return { t, v, adj, you: adj / v0 - 1, hwm: peak / v0 - 1, dd: peak > 0 ? adj / peak - 1 : 0, btc: bk && b0 && b0.c > 0 ? bk.c / b0.c - 1 : NaN };
    });
    const last = points[points.length - 1];
    return { ok: true, key, kind, t0, t1: last.t, v0, v1: last.v, points, you: last.you, btc: last.btc, hwm: last.hwm, dd: last.dd, flows: cum, btcGapHours: b0 ? Math.round(Math.abs(t0 - b0.t) / H) : NaN, prov: b0 ? "HISTORICAL" : "PARTIAL" };
  }

  AOS.alpha = { reconstructTrades, tradeStats, dietz, dietzLedger, benchmarkReturn, maxDrawdown, sharpeSortino, equityCurve, compute };
})(typeof window !== "undefined" ? window : globalThis);
