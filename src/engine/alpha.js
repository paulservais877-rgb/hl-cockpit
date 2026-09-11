/* Personal Alpha OS — ARCHIVE engine: trade reconstruction from fills, performance statistics, funding & fee leakage,
   alpha vs BTC / ETH / mix / nothing (modified Dietz on account value with ledger flows), PnL attribution,
   regime-tagged trades, counterfactuals. Everything is HISTORICAL/CALCULATED; approximations are labelled ESTIMATED. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, stats, D, H, clamp, uncertainty } = AOS.util;

  /** Reconstruct round-trip trades from fills (position goes 0 → x → 0). */
  function reconstructTrades(fills) {
    const byCoin = {};
    const trades = [];
    for (const f of fills || []) {
      const signed = (f.side === "BUY" ? 1 : -1) * f.sz;
      const st = (byCoin[f.coin] = byCoin[f.coin] || { pos: 0, cur: null });
      if (!st.cur || st.pos === 0) st.cur = { coin: f.coin, side: signed > 0 ? "LONG" : "SHORT", openTs: f.t, fills: [], realized: 0, fees: 0, maxSize: 0, entryNotional: 0, entryQty: 0, exitNotional: 0, exitQty: 0 };
      const t = st.cur;
      const opening = Math.sign(signed) === (t.side === "LONG" ? 1 : -1);
      t.fills.push(f);
      t.realized += isNum(f.closedPnl) ? f.closedPnl : 0;
      t.fees += isNum(f.fee) ? f.fee : 0;
      if (opening) { t.entryNotional += f.sz * f.px; t.entryQty += f.sz; } else { t.exitNotional += f.sz * f.px; t.exitQty += f.sz; }
      st.pos += signed;
      t.maxSize = Math.max(t.maxSize, Math.abs(st.pos));
      if (Math.abs(st.pos) < 1e-9) { t.closeTs = f.t; t.durationMs = f.t - t.openTs; t.avgEntry = t.entryQty ? t.entryNotional / t.entryQty : NaN; t.avgExit = t.exitQty ? t.exitNotional / t.exitQty : NaN; t.net = t.realized - t.fees; t.status = "CLOSED"; trades.push(t); st.cur = null; st.pos = 0; }
      else if (Math.sign(st.pos) !== (t.side === "LONG" ? 1 : -1)) { // flipped: close current, open opposite with the remainder
        t.closeTs = f.t; t.durationMs = f.t - t.openTs; t.avgEntry = t.entryQty ? t.entryNotional / t.entryQty : NaN; t.avgExit = t.exitQty ? t.exitNotional / t.exitQty : NaN; t.net = t.realized - t.fees; t.status = "CLOSED"; trades.push(t);
        st.cur = { coin: f.coin, side: st.pos > 0 ? "LONG" : "SHORT", openTs: f.t, fills: [f], realized: 0, fees: 0, maxSize: Math.abs(st.pos), entryNotional: Math.abs(st.pos) * f.px, entryQty: Math.abs(st.pos), exitNotional: 0, exitQty: 0 };
      }
    }
    const open = Object.values(byCoin).filter((s) => s.cur && Math.abs(s.pos) > 1e-9).map((s) => ({ ...s.cur, status: "OPEN", avgEntry: s.cur.entryQty ? s.cur.entryNotional / s.cur.entryQty : NaN, durationMs: Date.now() - s.cur.openTs }));
    return { closed: trades, open };
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

  /** Modified Dietz return between two timestamps using account value history and ledger flows. */
  function dietz(accountValue, ledger, t0, t1) {
    const av = accountValue.filter((p) => p[0] >= t0 - D && p[0] <= t1 + D);
    if (av.length < 2) return { ret: NaN, prov: "UNKNOWN" };
    const v0 = av[0][1], v1 = av[av.length - 1][1];
    const T0 = av[0][0], T1 = av[av.length - 1][0];
    const flows = (ledger || []).filter((l) => l.t > T0 && l.t <= T1 && /deposit|withdraw|transfer/i.test(l.type)).map((l) => ({ t: l.t, amt: /withdraw/i.test(l.type) ? -Math.abs(l.usdc) : Math.abs(l.usdc) }));
    const F = stats.sum(flows.map((f) => f.amt));
    const W = stats.sum(flows.map((f) => f.amt * (T1 - f.t) / Math.max(T1 - T0, 1)));
    const denom = v0 + W;
    return { ret: denom > 0 ? (v1 - v0 - F) / denom : NaN, v0, v1, flows: F, t0: T0, t1: T1, prov: flows.length ? "CALCULATED" : "ESTIMATED" };
  }

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
    return { sharpe: s > 0 ? (m / s) * Math.sqrt(365) : NaN, sortino: ds > 0 ? (m / ds) * Math.sqrt(365) : NaN, n: rets.length };
  }

  /** Full ARCHIVE computation. */
  function compute(snapshot, history, features) {
    const fills = history?.fills || [];
    const { closed, open } = reconstructTrades(fills);
    // regime tag at trade open (BTC daily candles up to that time)
    const btc1d = history?.candles?.BTC?.["1d"] || [];
    const regimeCache = {};
    for (const t of closed) {
      const day = Math.floor(t.openTs / D);
      if (!regimeCache[day]) {
        const slice = btc1d.filter((k) => k.t <= t.openTs);
        regimeCache[day] = slice.length >= 60 ? AOS.features.classifyRegime(AOS.features.assetFeatures("BTC", { "1d": slice }, { markPx: slice[slice.length - 1].c }), NaN, {}).regime : "UNKNOWN";
      }
      t.regime = regimeCache[day];
    }
    const st = tradeStats(closed);
    const uf = history?.userFunding || [];
    const fundingPaid = -stats.sum(uf.filter((r) => r.usdc < 0).map((r) => r.usdc)), fundingReceived = stats.sum(uf.filter((r) => r.usdc > 0).map((r) => r.usdc));
    const fundingByCoin = Object.entries(AOS.util.groupBy(uf, (r) => r.coin)).map(([coin, arr]) => ({ coin, net: stats.sum(arr.map((r) => r.usdc)) })).sort((a, b) => a.net - b.net);
    const pf = history?.portfolio || {};
    const ledger = history?.ledger || [];
    const windows = {};
    for (const [key, days] of [["week", 7], ["month", 30], ["allTime", NaN]]) {
      const series = pf[key]?.accountValue || [];
      if (series.length < 2) { windows[key] = { ret: NaN, prov: "UNKNOWN" }; continue; }
      const t0 = series[0][0], t1 = series[series.length - 1][0];
      const dz = dietz(series, ledger, t0, t1);
      const rB = benchmarkReturn(history?.candles?.BTC?.["1d"], t0, t1), rE = benchmarkReturn(history?.candles?.ETH?.["1d"], t0, t1);
      const feesW = stats.sum(fills.filter((f) => f.t >= t0 && f.t <= t1).map((f) => f.fee || 0));
      const fundW = stats.sum(uf.filter((f) => f.t >= t0 && f.t <= t1).map((f) => f.usdc));
      const costPct = dz.v0 > 0 ? (feesW - fundW) / dz.v0 : NaN; // positive = drag
      const pnlSeries = pf[key]?.pnl || [];
      const pnlW = pnlSeries.length ? pnlSeries[pnlSeries.length - 1][1] - pnlSeries[0][1] : NaN;
      windows[key] = {
        days: isNum(days) ? days : Math.round((t1 - t0) / D), t0, t1, ret: dz.ret, prov: dz.prov, v0: dz.v0, v1: dz.v1, flows: dz.flows, pnl: pnlW,
        btc: rB, eth: rE, mix: isNum(rB) && isNum(rE) ? (rB + rE) / 2 : NaN,
        alphaBTC: isNum(dz.ret) && isNum(rB) ? dz.ret - rB : NaN, alphaETH: isNum(dz.ret) && isNum(rE) ? dz.ret - rE : NaN, alphaMix: isNum(dz.ret) && isNum(rB) && isNum(rE) ? dz.ret - (rB + rE) / 2 : NaN, alphaNothing: dz.ret,
        fees: feesW, fundingNet: fundW, costPct, alphaBTCBeforeCosts: isNum(dz.ret) && isNum(rB) && isNum(costPct) ? dz.ret + costPct - rB : NaN,
        mdd: maxDrawdown(series), ...sharpeSortino(series),
      };
    }
    // attribution over the month window (ESTIMATED): beta × benchmark + funding + fees + residual
    const m = windows.month;
    let attribution = null;
    if (m && isNum(m.pnl) && isNum(m.btc)) {
      const beta = features?.portfolioAnalysis?.betaBTC;
      const avgEq = isNum(m.v0) && isNum(m.v1) ? (m.v0 + m.v1) / 2 : m.v0;
      const betaPnl = isNum(beta) ? beta * m.btc * avgEq : NaN;
      const closedInWin = closed.filter((t) => t.closeTs >= m.t0);
      const longPnl = stats.sum(closedInWin.filter((t) => t.side === "LONG").map((t) => t.realized)), shortPnl = stats.sum(closedInWin.filter((t) => t.side === "SHORT").map((t) => t.realized));
      const residual = m.pnl - (isNum(betaPnl) ? betaPnl : 0) - m.fundingNet + m.fees;
      attribution = [
        { name: "Beta BTC (marché)", value: betaPnl, note: isNum(beta) ? `β ${beta.toFixed(2)} × BTC ${(m.btc * 100).toFixed(1)}%` : "β inconnu", prov: "ESTIMATED" },
        { name: "Sélection + timing (alpha idiosyncratique)", value: residual, note: "PnL − beta − funding + fees", prov: "ESTIMATED" },
        { name: "Funding net", value: m.fundingNet, note: "reçu − payé", prov: "HISTORICAL" },
        { name: "Frais", value: -m.fees, note: "fills", prov: "HISTORICAL" },
        { name: "Jambes courtes (hedge) réalisé", value: shortPnl, note: `${closedInWin.filter((t) => t.side === "SHORT").length} trades`, prov: "HISTORICAL" },
        { name: "Jambes longues réalisé", value: longPnl, note: `${closedInWin.filter((t) => t.side === "LONG").length} trades`, prov: "HISTORICAL" },
      ];
    }
    // counterfactuals for closed trades within 30d (needs 1h candles)
    const cf = [];
    for (const t of closed.slice(-40)) {
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
    for (const r of st.byRegime) if (r.n >= 5) patterns.push(`${r.key} : ${r.n} trades, win rate ${Math.round(r.winRate * 100)}%, net ${r.net >= 0 ? "+" : "−"}$${Math.abs(r.net).toFixed(0)}`);
    for (const s of st.bySide) if (s.n >= 5) patterns.push(`${s.key} : ${s.n} trades, win rate ${Math.round(s.winRate * 100)}%, net ${s.net >= 0 ? "+" : "−"}$${Math.abs(s.net).toFixed(0)}`);
    const sideRegime = AOS.util.groupBy(closed, (t) => t.side + " / " + (t.regime || "UNKNOWN"));
    for (const [k, arr] of Object.entries(sideRegime)) if (arr.length >= 5) { const net = stats.sum(arr.map((t) => t.net)); patterns.push(`${k} : ${arr.length} trades, ${net >= 0 ? "crée" : "détruit"} de l'alpha (${net >= 0 ? "+" : "−"}$${Math.abs(net).toFixed(0)})`); }
    const captured = cf.filter((c) => isNum(c.captured));
    if (captured.length >= 5) patterns.push(`Capture moyenne du MFE : ${Math.round(stats.mean(captured.map((c) => clamp(c.captured, -1, 1))) * 100)}% (${captured.length} trades)`);
    return { closed, open, stats: st, fundingPaid, fundingReceived, fundingNet: fundingReceived - fundingPaid, fundingByCoin, windows, attribution, counterfactuals: cf, patterns, leakage: { fees90d: stats.sum(fills.filter((f) => f.t > Date.now() - 90 * D).map((f) => f.fee || 0)), funding90d: stats.sum(uf.map((r) => r.usdc)) }, prov: fills.length ? "HISTORICAL" : "UNKNOWN", fillsCount: fills.length };
  }

  AOS.alpha = { reconstructTrades, tradeStats, dietz, benchmarkReturn, maxDrawdown, sharpeSortino, compute };
})(typeof window !== "undefined" ? window : globalThis);
