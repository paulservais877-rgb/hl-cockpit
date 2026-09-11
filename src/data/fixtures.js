/* Personal Alpha OS — DEMO fixtures (synthetic, clearly marked). Shapes mimic Hyperliquid info responses.
   Used by `?demo=1` and by the node test-suite. Never used when a real wallet is synced. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});

  const universe = [
    { name: "BTC", szDecimals: 5, maxLeverage: 40 },
    { name: "ETH", szDecimals: 4, maxLeverage: 25 },
    { name: "SOL", szDecimals: 2, maxLeverage: 20 },
    { name: "BNB", szDecimals: 3, maxLeverage: 10 },
    { name: "TAO", szDecimals: 2, maxLeverage: 5 },
    { name: "LINK", szDecimals: 1, maxLeverage: 10 },
    { name: "ONDO", szDecimals: 0, maxLeverage: 5 },
    { name: "PENDLE", szDecimals: 1, maxLeverage: 5 },
    { name: "HYPE", szDecimals: 2, maxLeverage: 5 },
  ];
  const px = { BTC: 91250, ETH: 3120, SOL: 148.4, BNB: 612, TAO: 415, LINK: 17.2, ONDO: 0.92, PENDLE: 4.1, HYPE: 28.6 };
  const ctxs = universe.map((u) => {
    const p = px[u.name];
    const fund = { BTC: 0.0000125, ETH: 0.0000090, SOL: 0.0000210, BNB: 0.0000060, TAO: -0.0000150, LINK: 0.0000100, ONDO: 0.0000300, PENDLE: 0.0000050, HYPE: 0.0000180 }[u.name];
    const oi = { BTC: 26000, ETH: 380000, SOL: 4100000, BNB: 210000, TAO: 90000, LINK: 6100000, ONDO: 52000000, PENDLE: 8000000, HYPE: 11000000 }[u.name];
    const chg = { BTC: 0.012, ETH: -0.004, SOL: 0.031, BNB: 0.008, TAO: -0.021, LINK: 0.015, ONDO: 0.044, PENDLE: -0.012, HYPE: 0.052 }[u.name];
    return {
      funding: String(fund), openInterest: String(oi), prevDayPx: String(p / (1 + chg)), dayNtlVlm: String(oi * p * 1.8),
      premium: String(fund * 4), oraclePx: String(p * 0.9998), markPx: String(p), midPx: String(p * 1.00005), impactPxs: [String(p * 0.9995), String(p * 1.0005)],
    };
  });
  const metaAndAssetCtxs = [{ universe }, ctxs];
  const allMids = Object.fromEntries(Object.entries(px).map(([k, v]) => [k, String(v * 1.00005)]));

  const positions = [
    { coin: "BTC", szi: 0.42, entryPx: 86400, lev: 8, liq: 62150 },
    { coin: "SOL", szi: 120, entryPx: 139.0, lev: 5, liq: 88.5 },
    { coin: "ETH", szi: -4.0, entryPx: 3260, lev: 6, liq: 4980 },
    { coin: "BNB", szi: 6.0, entryPx: 598, lev: 3, liq: 402 },
  ];
  const assetPositions = positions.map((p) => {
    const mark = px[p.coin];
    const notional = Math.abs(p.szi) * mark;
    const upnl = p.szi * (mark - p.entryPx);
    return {
      type: "oneWay",
      position: {
        coin: p.coin, szi: String(p.szi), leverage: { type: "cross", value: p.lev }, entryPx: String(p.entryPx), positionValue: String(notional),
        unrealizedPnl: String(upnl), returnOnEquity: String(upnl / (notional / p.lev)), liquidationPx: String(p.liq), marginUsed: String(notional / p.lev),
        maxLeverage: universe.find((u) => u.name === p.coin).maxLeverage, cumFunding: { allTime: "312.4", sinceOpen: "84.2", sinceChange: "12.1" },
      },
    };
  });
  const totalNtl = assetPositions.reduce((s, a) => s + Number(a.position.positionValue), 0);
  const totalMarginUsed = assetPositions.reduce((s, a) => s + Number(a.position.marginUsed), 0);
  const mm = assetPositions.reduce((s, a) => s + Number(a.position.positionValue) * (0.5 / a.position.maxLeverage), 0);
  const accountValue = 21850;
  const clearinghouseState = {
    assetPositions,
    crossMaintenanceMarginUsed: String(mm),
    crossMarginSummary: { accountValue: String(accountValue), totalMarginUsed: String(totalMarginUsed), totalNtlPos: String(totalNtl), totalRawUsd: String(accountValue - 1200) },
    marginSummary: { accountValue: String(accountValue), totalMarginUsed: String(totalMarginUsed), totalNtlPos: String(totalNtl), totalRawUsd: String(accountValue - 1200) },
    withdrawable: String(accountValue - totalMarginUsed),
    time: Date.now(),
  };

  const openOrders = [
    { coin: "BTC", side: "A", sz: "0.42", origSz: "0.42", limitPx: "80000", triggerPx: "82000", isTrigger: true, reduceOnly: true, orderType: "Stop Market", tpsl: "sl", isPositionTpsl: true, oid: 1, timestamp: Date.now() - 3 * 86400e3 },
    { coin: "BTC", side: "A", sz: "0.21", origSz: "0.21", limitPx: "98500", triggerPx: "98000", isTrigger: true, reduceOnly: true, orderType: "Take Profit Market", tpsl: "tp", isPositionTpsl: true, oid: 2, timestamp: Date.now() - 3 * 86400e3 },
    { coin: "ETH", side: "B", sz: "4.0", origSz: "4.0", limitPx: "3400", triggerPx: "3390", isTrigger: true, reduceOnly: true, orderType: "Stop Market", tpsl: "sl", isPositionTpsl: true, oid: 3, timestamp: Date.now() - 86400e3 },
    { coin: "SOL", side: "B", sz: "60", origSz: "60", limitPx: "131", isTrigger: false, reduceOnly: false, orderType: "Limit", oid: 4, timestamp: Date.now() - 5 * 3600e3 },
  ];

  const predictedFundings = universe.map((u) => [u.name, [["BinPerp", { fundingRate: String(Number(ctxs.find((c, i) => universe[i].name === u.name).funding) * 8 * 0.9), nextFundingTime: Date.now() + 3 * 3600e3, fundingIntervalHours: 8 }], ["HlPerp", { fundingRate: ctxs.find((c, i) => universe[i].name === u.name).funding, nextFundingTime: Date.now() + 1800e3, fundingIntervalHours: 1 }]]]);

  // ---- synthetic history: deterministic pseudo-random walk (seeded) ------------------
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function walk(coin, endPx, bars, stepMs, vol, drift, seed) {
    const r = rng(seed);
    const out = [];
    let p = endPx;
    // build backwards then reverse so the last close equals endPx
    const closes = [p];
    for (let i = 1; i < bars; i++) { const z = (r() + r() + r() + r() - 2) * 1.7; p = p / Math.exp(drift + vol * z); closes.push(p); }
    closes.reverse();
    const end = Date.now() - (Date.now() % stepMs);
    for (let i = 0; i < bars; i++) {
      const c = closes[i], o = i ? closes[i - 1] : c * (1 - vol / 2);
      const hi = Math.max(o, c) * (1 + vol * r() * 0.8), lo = Math.min(o, c) * (1 - vol * r() * 0.8);
      out.push({ t: end - (bars - 1 - i) * stepMs, o, h: hi, l: lo, c, v: (800 + 600 * r()) * (coin === "BTC" ? 1 : 30) });
    }
    return out;
  }
  const hist = { candles: {}, funding: {}, l2: {} };
  const seeds = { BTC: 7, ETH: 11, SOL: 13, BNB: 17, TAO: 19, LINK: 23, ONDO: 29, PENDLE: 31, HYPE: 37 };
  const vols1h = { BTC: 0.0075, ETH: 0.0095, SOL: 0.013, BNB: 0.008, TAO: 0.016, LINK: 0.012, ONDO: 0.017, PENDLE: 0.015, HYPE: 0.018 };
  for (const u of universe) {
    const c = u.name;
    hist.candles[c] = { "1h": walk(c, px[c], 720, 3600e3, vols1h[c], 0.00006, seeds[c]), "1d": walk(c, px[c], 220, 86400e3, vols1h[c] * 4.6, 0.0012, seeds[c] + 100) };
    const fr = rng(seeds[c] + 200);
    const base = Number(ctxs[universe.indexOf(u)].funding);
    hist.funding[c] = Array.from({ length: 720 }, (_, i) => ({ t: Date.now() - (719 - i) * 3600e3, rate: base * (0.5 + fr()) + (fr() - 0.5) * 0.00002, premium: 0 }));
  }
  for (const p of positions) hist.l2[p.coin] = { bidUsd: 1.2e6, askUsd: 0.95e6, imbalance: 0.116, spread: 0.00008, t: Date.now() };

  const fr = rng(999);
  const fills = [];
  let t = Date.now() - 80 * 86400e3;
  const trades = [
    ["BTC", "Open Long", 0.3, 78200], ["BTC", "Close Long", 0.3, 84100], ["ETH", "Open Short", 3, 3480], ["ETH", "Close Short", 3, 3210],
    ["SOL", "Open Long", 100, 162], ["SOL", "Close Long", 100, 151], ["BTC", "Open Long", 0.25, 88900], ["BTC", "Close Long", 0.25, 86200],
    ["SOL", "Open Long", 80, 128], ["SOL", "Close Long", 80, 141], ["ETH", "Open Short", 2, 3390], ["ETH", "Close Short", 2, 3455],
    ["BTC", "Open Long", 0.42, 86400], ["SOL", "Open Long", 120, 139], ["ETH", "Open Short", 4, 3260], ["BNB", "Open Long", 6, 598],
  ];
  let startPos = {};
  for (const [coin, dir, sz, p] of trades) {
    t += (2 + fr() * 6) * 86400e3;
    const isBuy = /Long/.test(dir) ? /Open/.test(dir) : /Close/.test(dir);
    const sp = startPos[coin] || 0;
    let closedPnl = 0;
    if (/Close/.test(dir)) { const opener = [...fills].reverse().find((f) => f.coin === coin && /Open/.test(f.dir)); closedPnl = (/Long/.test(dir) ? 1 : -1) * sz * (p - Number(opener.px)); }
    fills.push({ coin, px: String(p), sz: String(sz), side: isBuy ? "B" : "A", time: Math.min(t, Date.now() - 3600e3), startPosition: String(sp), dir, closedPnl: String(closedPnl), fee: String(sz * p * 0.00035), feeToken: "USDC", oid: fills.length + 1, tid: fills.length + 1, crossed: true });
    startPos[coin] = sp + (isBuy ? sz : -sz);
  }
  const userFunding = [];
  for (let i = 0; i < 90 * 24; i += 1) {
    const ts = Date.now() - (90 * 24 - i) * 3600e3;
    if (i % 3 === 0) userFunding.push({ time: ts, hash: "0x", delta: { type: "funding", coin: "BTC", usdc: String(-0.42 * 88000 * 0.0000125), szi: "0.42", fundingRate: "0.0000125", nSamples: 1 } });
    if (i % 4 === 0) userFunding.push({ time: ts, hash: "0x", delta: { type: "funding", coin: "ETH", usdc: String(4 * 3200 * 0.000009), szi: "-4", fundingRate: "0.000009", nSamples: 1 } });
  }
  const pr = rng(4242);
  const pnlHist = [], avHist = [];
  let av = 18400;
  for (let i = 0; i < 30; i++) { const ts = Date.now() - (29 - i) * 86400e3; av += (pr() - 0.45) * 600; avHist.push([ts, String(av)]); pnlHist.push([ts, String(av - 18400)]); }
  avHist[avHist.length - 1][1] = String(accountValue); pnlHist[pnlHist.length - 1][1] = String(accountValue - 18400);
  const portfolio = [["day", { accountValueHistory: avHist.slice(-2), pnlHistory: pnlHist.slice(-2), vlm: "50000" }], ["week", { accountValueHistory: avHist.slice(-8), pnlHistory: pnlHist.slice(-8), vlm: "210000" }], ["month", { accountValueHistory: avHist, pnlHistory: pnlHist, vlm: "640000" }], ["allTime", { accountValueHistory: avHist, pnlHistory: pnlHist, vlm: "2100000" }]];
  const ledger = [{ time: Date.now() - 120 * 86400e3, hash: "0x", delta: { type: "deposit", usdc: "15000" } }, { time: Date.now() - 45 * 86400e3, hash: "0x", delta: { type: "deposit", usdc: "3000" } }];

  AOS.fixtures = { wallet: "0x" + "0".repeat(36) + "de40", metaAndAssetCtxs, allMids, clearinghouseState, openOrders, predictedFundings, history: hist, fills, userFunding, portfolio, ledger, px };
})(typeof window !== "undefined" ? window : globalThis);
