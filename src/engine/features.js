/* Personal Alpha OS — Feature engine: indicators, volatility, correlations, betas, regime, temperature, anomalies.
   Everything here is CALCULATED from HISTORICAL candles and LIVE asset contexts. The regime classifier is
   rule-based (transparent, no ML) and reports its confidence and invalidation conditions. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, stats, H, D, uncertainty } = AOS.util;

  // ---- indicators ----------------------------------------------------------------------
  function ema(values, period) {
    const k = 2 / (period + 1);
    const out = new Array(values.length).fill(NaN);
    let e = NaN, n = 0, sum = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!isNum(v)) { out[i] = e; continue; }
      if (n < period) { sum += v; n++; e = sum / n; out[i] = n === period ? e : NaN; continue; }
      e = v * k + e * (1 - k); out[i] = e;
    }
    return out;
  }
  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(NaN);
    let ag = 0, al = 0;
    for (let i = 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      const g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= period) { ag += g / period; al += l / period; if (i === period) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); continue; }
      ag = (ag * (period - 1) + g) / period; al = (al * (period - 1) + l) / period;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }
  function atr(candles, period = 14) {
    const out = new Array(candles.length).fill(NaN);
    let a = NaN;
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i], pc = candles[i - 1].c;
      const tr = Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
      if (i < period) { a = isNum(a) ? a + tr : tr; if (i === period - 1) { a = a / period; out[i] = a; } continue; }
      a = (a * (period - 1) + tr) / period; out[i] = a;
    }
    return out;
  }
  function macd(closes, fast = 12, slow = 26, sig = 9) {
    const ef = ema(closes, fast), es = ema(closes, slow);
    const line = closes.map((_, i) => (isNum(ef[i]) && isNum(es[i]) ? ef[i] - es[i] : NaN));
    const signal = ema(line.map((x) => (isNum(x) ? x : NaN)), sig);
    return { line, signal, hist: line.map((x, i) => (isNum(x) && isNum(signal[i]) ? x - signal[i] : NaN)) };
  }
  function obv(candles) {
    let o = 0; const out = [];
    for (let i = 0; i < candles.length; i++) { if (i) o += Math.sign(candles[i].c - candles[i - 1].c) * (candles[i].v || 0); out.push(o); }
    return out;
  }
  const logReturns = (closes) => closes.slice(1).map((c, i) => (closes[i] > 0 && c > 0 ? Math.log(c / closes[i]) : NaN));
  const last = (a, n = 1) => a[a.length - n];

  function aggregate(candles1h, hours) {
    const out = [];
    for (let i = 0; i < candles1h.length; i += hours) {
      const chunk = candles1h.slice(i, i + hours);
      if (!chunk.length) continue;
      out.push({ t: chunk[0].t, o: chunk[0].o, h: Math.max(...chunk.map((k) => k.h)), l: Math.min(...chunk.map((k) => k.l)), c: chunk[chunk.length - 1].c, v: chunk.reduce((s, k) => s + (k.v || 0), 0) });
    }
    return out;
  }

  /** Per-asset feature block from 1h and 1d candles (either may be missing). */
  function assetFeatures(coin, candles, ctx) {
    const h1 = candles?.["1h"] || [], d1 = candles?.["1d"] || [];
    const h4 = h1.length ? aggregate(h1, 4) : [];
    const f = { coin, hasH1: h1.length >= 48, hasD1: d1.length >= 60, prov: h1.length || d1.length ? "HISTORICAL" : "UNKNOWN" };
    const price = isNum(ctx?.markPx) ? ctx.markPx : last(d1)?.c ?? last(h1)?.c ?? NaN;
    f.price = price;
    if (d1.length >= 30) {
      const c = d1.map((k) => k.c);
      const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
      const r = rsi(c, 14), a = atr(d1, 14), m = macd(c);
      const lr = logReturns(c);
      f.d1 = {
        ema20: last(e20), ema50: last(e50), ema200: last(e200), rsi: last(r), atr: last(a), atrPct: isNum(last(a)) && price > 0 ? last(a) / price : NaN,
        macdHist: last(m.hist), macdHistPrev: last(m.hist, 4),
        ret1d: c.length > 1 ? c.at(-1) / c.at(-2) - 1 : NaN,
        ret3d: c.length > 3 ? c.at(-1) / c.at(-4) - 1 : NaN,
        ret7d: c.length > 7 ? c.at(-1) / c.at(-8) - 1 : NaN,
        ret20d: c.length > 20 ? c.at(-1) / c.at(-21) - 1 : NaN,
        ret30d: c.length > 30 ? c.at(-1) / c.at(-31) - 1 : NaN,
        ret90d: c.length > 90 ? c.at(-1) / c.at(-91) - 1 : NaN,
        vol7: stats.stdev(lr.slice(-7)) * Math.sqrt(365), vol30: stats.stdev(lr.slice(-30)) * Math.sqrt(365), vol90: stats.stdev(lr.slice(-90)) * Math.sqrt(365),
        high20: Math.max(...d1.slice(-20).map((k) => k.h)), low20: Math.min(...d1.slice(-20).map((k) => k.l)),
        high30: Math.max(...d1.slice(-30).map((k) => k.h)), low30: Math.min(...d1.slice(-30).map((k) => k.l)),
        high90: Math.max(...d1.slice(-90).map((k) => k.h)),
        volAvg20: stats.mean(d1.slice(-21, -1).map((k) => k.v)), volLast: last(d1).v,
        atrPctSeries: a.map((x, i) => (isNum(x) && d1[i].c > 0 ? x / d1[i].c : NaN)),
        logReturns: lr, closes: c, e20, e50, e200,
        obvSlope: (() => { const o = obv(d1.slice(-30)); return o.length > 10 ? Math.sign(o.at(-1) - o.at(-10)) : 0; })(),
      };
      f.d1.ddFromHigh30 = isNum(f.d1.high30) && f.d1.high30 > 0 ? price / f.d1.high30 - 1 : NaN;
      f.d1.ddFromHigh90 = isNum(f.d1.high90) && f.d1.high90 > 0 ? price / f.d1.high90 - 1 : NaN;
      f.d1.trendScore = (isNum(f.d1.ema50) && price > f.d1.ema50 ? 1 : -1) + (isNum(f.d1.ema200) && price > f.d1.ema200 ? 1 : -1) + (isNum(f.d1.ema50) && isNum(f.d1.ema200) && f.d1.ema50 > f.d1.ema200 ? 1 : -1);
      f.d1.atrRank = (() => { const s = f.d1.atrPctSeries.slice(-60).filter(isNum); const cur = f.d1.atrPct; return s.length > 10 && isNum(cur) ? s.filter((x) => x < cur).length / s.length : NaN; })();
    }
    if (h4.length >= 30) {
      const c = h4.map((k) => k.c);
      const e20 = ema(c, 20), e50 = ema(c, 50);
      const r = rsi(c, 14), a = atr(h4, 14);
      const lr = logReturns(c);
      f.h4 = {
        ema20: last(e20), ema50: last(e50), rsi: last(r), atr: last(a), atrPct: isNum(last(a)) && price > 0 ? last(a) / price : NaN,
        sd20: stats.stdev(c.slice(-20)), mean20: stats.mean(c.slice(-20)),
        low6: Math.min(...h4.slice(-6).map((k) => k.l)), high6: Math.max(...h4.slice(-6).map((k) => k.h)),
        low12: Math.min(...h4.slice(-12).map((k) => k.l)), high12: Math.max(...h4.slice(-12).map((k) => k.h)),
        volAvg: stats.mean(h4.slice(-31, -1).map((k) => k.v)), volLast: last(h4).v,
        ret4h: c.length > 1 ? c.at(-1) / c.at(-2) - 1 : NaN, ret24h: c.length > 6 ? c.at(-1) / c.at(-7) - 1 : NaN,
        vol: stats.stdev(lr.slice(-42)) * Math.sqrt(365 * 6), closes: c, candles: h4,
        prevClose: c.at(-2), prevHigh: h4.at(-2)?.h, prevLow: h4.at(-2)?.l,
      };
    }
    if (h1.length >= 48) {
      const c = h1.map((k) => k.c);
      const lr = logReturns(c);
      f.h1 = { logReturns: lr, closes: c, times: h1.map((k) => k.t), vol24: stats.stdev(lr.slice(-24)) * Math.sqrt(365 * 24), vol7d: stats.stdev(lr.slice(-168)) * Math.sqrt(365 * 24), vol30d: stats.stdev(lr) * Math.sqrt(365 * 24), volumes: h1.map((k) => k.v) };
    }
    // best available annualised vol (used by risk & cone)
    f.vol = f.h1?.vol30d ?? f.d1?.vol30 ?? NaN;
    f.volShort = f.h1?.vol7d ?? f.d1?.vol7 ?? NaN;
    f.volProv = isNum(f.vol) ? "CALCULATED" : "UNKNOWN";
    f.ctx = ctx || null;
    return f;
  }

  /** Correlation & beta matrix from 1h log returns (30d) with a stress version (corr → stressCorr). */
  function correlations(featuresByCoin, coins, stressCorr = 0.95) {
    const n = coins.length;
    const M = Array.from({ length: n }, () => new Array(n).fill(NaN));
    const S = Array.from({ length: n }, () => new Array(n).fill(NaN));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) { M[i][j] = 1; S[i][j] = 1; continue; }
      const a = featuresByCoin[coins[i]]?.h1?.logReturns, b = featuresByCoin[coins[j]]?.h1?.logReturns;
      const c = a && b ? stats.corr(a, b) : NaN;
      M[i][j] = c; S[i][j] = isNum(c) ? Math.max(c, stressCorr) : stressCorr;
    }
    const betaTo = (ref) => Object.fromEntries(coins.map((c) => { const a = featuresByCoin[c]?.h1?.logReturns, b = featuresByCoin[ref]?.h1?.logReturns; return [c, a && b ? (c === ref ? 1 : stats.beta(a, b)) : NaN]; }));
    const off = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (isNum(M[i][j])) off.push(M[i][j]);
    return { coins, normal: M, stress: S, betaBTC: betaTo("BTC"), betaETH: betaTo("ETH"), avgCorr: stats.mean(off), n: featuresByCoin.BTC?.h1?.logReturns?.length || 0 };
  }

  // ---- regime classifier (rule based) --------------------------------------------------
  const REGIMES = ["Bull Expansion", "Bull Exhaustion", "Distribution", "Panic Deleveraging", "Compression", "Re-Accumulation", "Bear Expansion", "Short Squeeze", "Mean-Reversion Regime"];
  function classifyRegime(btc, breadth, flow) {
    const d = btc?.d1;
    if (!d) return { regime: "UNKNOWN", confidence: 0, scores: {}, bias: "NEUTRAL", prov: "UNKNOWN", invalidation: ["Historique BTC (1d) indisponible."], drivers: [] };
    const p = btc.price;
    const up50 = p > d.ema50, up200 = p > d.ema200, e50gt200 = d.ema50 > d.ema200;
    const volRatio = isNum(d.vol7) && isNum(d.vol30) && d.vol30 > 0 ? d.vol7 / d.vol30 : 1;
    const fundingHourly = flow?.fundingHourlyBTC;
    const s = {};
    // each score in [0,1]: fraction of conditions satisfied, weighted
    const cond = (arr) => arr.reduce((a, [w, ok]) => a + (ok ? w : 0), 0) / arr.reduce((a, [w]) => a + w, 0);
    s["Panic Deleveraging"] = cond([[3, d.ret7d < -0.10], [2, volRatio > 1.4], [1, d.rsi < 35], [1, isNum(fundingHourly) && fundingHourly < 0], [1, d.ret3d < -0.05]]);
    s["Bear Expansion"] = cond([[2, !up50], [2, !up200], [1, !e50gt200], [2, d.ret20d < -0.06], [1, d.macdHist < 0]]);
    s["Short Squeeze"] = cond([[3, d.ret3d > 0.06], [2, !up50 || !e50gt200], [1, isNum(fundingHourly) && fundingHourly <= 0], [1, volRatio > 1.2]]);
    s["Bull Expansion"] = cond([[2, up50], [2, up200], [1, e50gt200], [2, d.ret20d > 0.06], [1, d.macdHist > 0], [1, d.rsi > 55 && d.rsi < 75]]);
    s["Bull Exhaustion"] = cond([[2, up200 && e50gt200], [2, d.rsi > 72], [1, isNum(fundingHourly) && fundingHourly > 0.00002], [2, d.ret20d > 0.12], [1, d.ret3d < 0], [1, d.ddFromHigh30 > -0.03]]);
    s["Distribution"] = cond([[2, Math.abs(d.ret20d) < 0.05], [2, d.ddFromHigh30 > -0.06], [1, e50gt200], [1, d.macdHist < d.macdHistPrev], [1, d.obvSlope <= 0], [1, d.rsi >= 45 && d.rsi <= 62]]);
    s["Compression"] = cond([[3, d.atrRank < 0.2], [2, Math.abs(d.ret20d) < 0.05], [1, volRatio < 0.9], [1, Math.abs(d.ret7d) < 0.03]]);
    s["Re-Accumulation"] = cond([[2, up200], [1, up50 || Math.abs(p / d.ema50 - 1) < 0.03], [2, d.ret20d > -0.04 && d.ret20d < 0.06], [2, d.ddFromHigh90 < -0.05 && d.ddFromHigh90 > -0.2], [1, volRatio < 1.1], [1, d.rsi >= 42 && d.rsi <= 60]]);
    s["Mean-Reversion Regime"] = cond([[2, Math.abs(d.ema20 - d.ema50) / (d.atr || 1) < 1.2], [2, Math.abs(d.ret20d) < 0.06], [1, volRatio > 0.8 && volRatio < 1.3], [1, d.rsi > 38 && d.rsi < 62]]);
    const ranked = Object.entries(s).sort((a, b) => b[1] - a[1]);
    const [best, score] = ranked[0];
    const gap = score - ranked[1][1];
    const confidence = clamp(Math.round(100 * (0.45 * score + 0.55 * clamp(gap * 3, 0, 1))), 5, 92);
    const bias = ["Bull Expansion", "Re-Accumulation", "Short Squeeze"].includes(best) ? "BULL" : ["Bear Expansion", "Panic Deleveraging", "Distribution", "Bull Exhaustion"].includes(best) ? "BEAR" : "NEUTRAL";
    const invalidation = {
      "Bull Expansion": [`Clôture 1d sous EMA50 (${Math.round(d.ema50)})`, "Retour du momentum 20j sous 0", "Funding extrême + rejet sur plus-haut"],
      "Bull Exhaustion": [`Nouveau plus-haut 1d avec RSI < 70 et volume en hausse`, "Funding revenu neutre avec prix stable"],
      "Distribution": [`Cassure du plus-haut 30j (${Math.round(d.high30)}) avec volume`, `Cassure du plus-bas 20j (${Math.round(d.low20)}) → Bear Expansion`],
      "Panic Deleveraging": ["Stabilisation 3j avec funding qui se normalise", "Reprise au-dessus de l'EMA20 1d"],
      "Compression": ["Expansion ATR > rang 50% avec cassure de range", "Direction de la cassure = nouveau régime"],
      "Re-Accumulation": [`Perte de l'EMA200 1d (${Math.round(d.ema200)})`, `Cassure sous plus-bas 30j (${Math.round(d.low30)})`, "Drawdown 90j > 20%"],
      "Bear Expansion": [`Reconquête EMA50 1d (${Math.round(d.ema50)}) avec momentum 20j > 0`, "Squeeze avec OI en baisse"],
      "Short Squeeze": ["Retour sous le point de départ du squeeze", "Funding qui redevient fortement positif sans suite haussière"],
      "Mean-Reversion Regime": ["Expansion de tendance : |EMA20−EMA50| > 1.5 ATR", "Momentum 20j > ±6%"],
    }[best] || [];
    const drivers = [
      `BTC ${up50 ? "au-dessus" : "sous"} EMA50 · ${up200 ? "au-dessus" : "sous"} EMA200`,
      `Momentum 20j ${(d.ret20d * 100).toFixed(1)}% · 7j ${(d.ret7d * 100).toFixed(1)}%`,
      `Vol 7j/30j ${volRatio.toFixed(2)} · ATR rang ${isNum(d.atrRank) ? Math.round(d.atrRank * 100) + "%" : "—"}`,
      `RSI 1d ${isNum(d.rsi) ? d.rsi.toFixed(0) : "—"} · breadth ${isNum(breadth) ? Math.round(breadth * 100) + "%" : "—"}`,
    ];
    return { regime: best, confidence, scores: s, ranked: ranked.slice(0, 3), bias, volRatio, expectedVol: volRatio > 1.3 ? "HIGH" : volRatio < 0.85 ? "LOW" : "MODERATE", changeProbability: clamp(Math.round(100 * (1 - gap * 2.5)), 5, 80), invalidation, drivers, prov: "CALCULATED", uncertainty: uncertainty(btc.d1.closes.length, 150, 60) };
  }

  /** Market temperature 0–100 (PANIC → EUPHORIA). Composite of momentum, vol, funding, breadth, RSI. */
  function temperature(btc, eth, breadth, flow) {
    const d = btc?.d1;
    if (!d) return { value: NaN, label: "UNKNOWN", components: [], prov: "UNKNOWN" };
    const comp = [];
    const add = (name, value, weight) => { if (isNum(value)) comp.push({ name, value: clamp(value, 0, 1), weight }); };
    add("Momentum BTC 20j", 0.5 + d.ret20d / 0.4, 0.25);
    add("Momentum BTC 7j", 0.5 + d.ret7d / 0.2, 0.15);
    add("RSI 1d", d.rsi / 100, 0.15);
    add("Breadth (actifs > EMA50)", breadth, 0.15);
    add("Funding (BTC/ETH moyen)", isNum(flow?.fundingHourlyAvg) ? 0.5 + flow.fundingHourlyAvg / 0.00008 : NaN, 0.15);
    add("Vol 7j/30j (inverse)", isNum(d.vol7) && d.vol30 > 0 ? 1 - clamp((d.vol7 / d.vol30 - 0.6) / 1.4, 0, 1) : NaN, 0.15);
    const wsum = comp.reduce((s, c) => s + c.weight, 0);
    const v = wsum > 0 ? Math.round(100 * comp.reduce((s, c) => s + c.value * c.weight, 0) / wsum) : NaN;
    const label = !isNum(v) ? "UNKNOWN" : v < 20 ? "PANIC" : v < 40 ? "FEAR" : v < 60 ? "NEUTRAL" : v < 80 ? "RISK-ON" : "EUPHORIA";
    return { value: v, label, components: comp, prov: "CALCULATED" };
  }

  /** Anomalies: z-scores vs the asset's own 30d history. Only |z| ≥ 2 are reported. */
  function anomalies(featuresByCoin, fundingHist, snapshot) {
    const out = [];
    for (const coin of Object.keys(featuresByCoin)) {
      const f = featuresByCoin[coin];
      const ctx = snapshot?.meta?.assets?.[coin];
      const fh = fundingHist?.[coin];
      if (fh && fh.length > 48 && isNum(ctx?.fundingHourly)) {
        const z = stats.zscore(ctx.fundingHourly, fh.map((r) => r.rate));
        if (isNum(z) && Math.abs(z) >= 2) out.push({ coin, type: "FUNDING", z, text: `Funding ${coin} ${z > 0 ? "anormalement haut" : "anormalement bas"} (z=${z.toFixed(1)}, ${(ctx.fundingHourly * 100).toFixed(4)}%/h)` });
      }
      if (f.h1 && f.h1.volumes.length > 100) {
        const v24 = stats.sum(f.h1.volumes.slice(-24)), hist = []; for (let i = 24; i + 24 <= f.h1.volumes.length - 24; i += 24) hist.push(stats.sum(f.h1.volumes.slice(i, i + 24)));
        const z = stats.zscore(v24, hist);
        if (isNum(z) && Math.abs(z) >= 2) out.push({ coin, type: "VOLUME", z, text: `Volume 24h ${coin} ${z > 0 ? "anormalement élevé" : "anormalement faible"} (z=${z.toFixed(1)})` });
      }
      if (f.h1 && isNum(f.h1.vol24) && isNum(f.h1.vol30d) && f.h1.vol30d > 0) {
        const r = f.h1.vol24 / f.h1.vol30d;
        if (r > 2) out.push({ coin, type: "VOLATILITY", z: r, text: `Volatilité 24h ${coin} = ${r.toFixed(1)}× la vol 30j` });
      }
      if (isNum(ctx?.premium) && Math.abs(ctx.premium) > 0.002) out.push({ coin, type: "BASIS", z: ctx.premium / 0.001, text: `Basis ${coin} ${(ctx.premium * 100).toFixed(2)}% (mark vs oracle)` });
    }
    return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 8);
  }

  /** Narrative rotation: relative 7d/30d performance vs BTC by sector (needs 1d candles). */
  const SECTORS = { BTC: ["BTC"], ETH: ["ETH"], SOL: ["SOL"], "L1 alt": ["ADA", "AVAX", "SUI", "NEAR", "XMR"], "Exchange": ["BNB", "HYPE"], AI: ["TAO", "RENDER", "FET"], DeFi: ["LINK", "PENDLE", "AAVE", "UNI"], RWA: ["ONDO"], Meme: ["DOGE", "PEPE", "WIF"] };
  function narrativeRotation(featuresByCoin) {
    const btc7 = featuresByCoin.BTC?.d1?.ret7d, btc30 = featuresByCoin.BTC?.d1?.ret30d;
    const rows = [];
    for (const [sector, coins] of Object.entries(SECTORS)) {
      const avail = coins.filter((c) => featuresByCoin[c]?.d1);
      if (!avail.length) continue;
      const r7 = stats.mean(avail.map((c) => featuresByCoin[c].d1.ret7d)), r30 = stats.mean(avail.map((c) => featuresByCoin[c].d1.ret30d));
      const volConf = stats.mean(avail.map((c) => (isNum(featuresByCoin[c].d1.volAvg20) && featuresByCoin[c].d1.volAvg20 > 0 ? featuresByCoin[c].d1.volLast / featuresByCoin[c].d1.volAvg20 : NaN)));
      rows.push({ sector, coins: avail, ret7d: r7, ret30d: r30, rel7d: isNum(btc7) ? r7 - btc7 : NaN, rel30d: isNum(btc30) ? r30 - btc30 : NaN, volumeConfirm: isNum(volConf) ? volConf > 1.1 : null });
    }
    return rows.sort((a, b) => (b.rel7d || 0) - (a.rel7d || 0));
  }

  /** Master call: compute all features for a snapshot + history. */
  function compute(snapshot, history, opts = {}) {
    const assets = snapshot?.meta?.assets || {};
    const coins = new Set(["BTC", "ETH", "SOL", ...(snapshot?.positions || []).map((p) => p.coin), ...Object.keys(history?.candles || {})]);
    const byCoin = {};
    for (const c of coins) byCoin[c] = assetFeatures(c, history?.candles?.[c], assets[c]);
    const tracked = Object.values(byCoin).filter((f) => f.d1);
    const breadth = tracked.length >= 3 ? tracked.filter((f) => f.price > f.d1.ema50).length / tracked.length : NaN;
    const fB = assets.BTC?.fundingHourly, fE = assets.ETH?.fundingHourly;
    const flow = { fundingHourlyBTC: fB, fundingHourlyAvg: stats.mean([fB, fE]) };
    const regime = classifyRegime(byCoin.BTC, breadth, flow);
    const temp = temperature(byCoin.BTC, byCoin.ETH, breadth, flow);
    const held = (snapshot?.positions || []).map((p) => p.coin);
    const corrCoins = [...new Set(["BTC", "ETH", ...held])].filter((c) => byCoin[c]?.h1);
    const corr = correlations(byCoin, corrCoins, opts.stressCorr ?? 0.95);
    return { byCoin, breadth, regime, temperature: temp, corr, anomalies: anomalies(byCoin, history?.funding, snapshot), narratives: narrativeRotation(byCoin), computedTs: Date.now() };
  }

  AOS.features = { ema, rsi, atr, macd, obv, logReturns, aggregate, assetFeatures, correlations, classifyRegime, temperature, anomalies, narrativeRotation, compute, REGIMES, SECTORS };
})(typeof window !== "undefined" ? window : globalThis);
