/* Personal Alpha OS — Hyperliquid response normalization.
   Tolerant parsers: every field is tagged with a provenance (LIVE / CALCULATED / UNKNOWN).
   Nothing here is ever invented: a missing field stays NaN and is reported as UNKNOWN. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { num, isNum, PROV } = AOS.util;

  // Maintenance margin on Hyperliquid = half of the initial margin at max leverage.
  // Source: Hyperliquid docs (margining). mmRate = 0.5 / maxLeverage. Tagged CALCULATED.
  const mmRateFor = (maxLeverage) => (isNum(maxLeverage) && maxLeverage > 0 ? 0.5 / maxLeverage : NaN);

  function parseMeta(metaAndCtxs) {
    // metaAndAssetCtxs => [ {universe:[{name, szDecimals, maxLeverage, onlyIsolated}]}, [ {funding, openInterest, prevDayPx, dayNtlVlm, premium, oraclePx, markPx, midPx, impactPxs} ] ]
    const out = { assets: {}, ok: false };
    if (!Array.isArray(metaAndCtxs) || metaAndCtxs.length < 2) return out;
    const universe = metaAndCtxs[0]?.universe || [];
    const ctxs = Array.isArray(metaAndCtxs[1]) ? metaAndCtxs[1] : [];
    universe.forEach((u, i) => {
      const c = ctxs[i] || {};
      const name = u?.name;
      if (!name) return;
      const markPx = num(c.markPx), oraclePx = num(c.oraclePx), midPx = num(c.midPx);
      const oi = num(c.openInterest); // in base units
      out.assets[name] = {
        name,
        szDecimals: num(u.szDecimals),
        maxLeverage: num(u.maxLeverage),
        onlyIsolated: !!u.onlyIsolated,
        mmRate: mmRateFor(num(u.maxLeverage)),
        fundingHourly: num(c.funding), // HL funding is paid hourly; this is the current hourly rate
        openInterest: oi,
        openInterestUsd: isNum(oi) && isNum(markPx) ? oi * markPx : NaN,
        prevDayPx: num(c.prevDayPx),
        dayNtlVlm: num(c.dayNtlVlm),
        premium: num(c.premium),
        oraclePx, markPx, midPx,
        impactBid: num(c.impactPxs?.[0]), impactAsk: num(c.impactPxs?.[1]),
        change24h: isNum(markPx) && isNum(num(c.prevDayPx)) && num(c.prevDayPx) > 0 ? markPx / num(c.prevDayPx) - 1 : NaN,
      };
    });
    out.ok = Object.keys(out.assets).length > 0;
    return out;
  }

  function parseAccount(state) {
    const cms = state?.crossMarginSummary || {};
    const ms = state?.marginSummary || {};
    const equity = num(cms.accountValue ?? ms.accountValue);
    const totalNtl = num(ms.totalNtlPos ?? cms.totalNtlPos);
    const marginUsed = num(ms.totalMarginUsed ?? cms.totalMarginUsed);
    const rawUsd = num(ms.totalRawUsd ?? cms.totalRawUsd);
    const mm = num(state?.crossMaintenanceMarginUsed);
    const withdrawable = num(state?.withdrawable);
    return {
      equity, totalNtl, marginUsed, rawUsd, mm, withdrawable,
      crossEquity: num(cms.accountValue),
      buffer: isNum(equity) && isNum(mm) ? equity - mm : NaN,
      bufferRatio: isNum(equity) && equity > 0 && isNum(mm) ? (equity - mm) / equity : NaN,
      marginRatio: isNum(equity) && equity > 0 && isNum(mm) ? mm / equity : NaN,
      marginUtilisation: isNum(equity) && equity > 0 && isNum(marginUsed) ? marginUsed / equity : NaN,
      availableMargin: isNum(equity) && isNum(marginUsed) ? equity - marginUsed : NaN,
      effectiveLeverage: isNum(equity) && equity > 0 && isNum(totalNtl) ? totalNtl / equity : NaN,
      apiTime: num(state?.time),
      prov: {
        equity: isNum(equity) ? PROV.LIVE : PROV.UNKNOWN,
        mm: isNum(mm) ? PROV.LIVE : PROV.UNKNOWN,
        withdrawable: isNum(withdrawable) ? PROV.LIVE : PROV.UNKNOWN,
      },
    };
  }

  function parsePositions(state, meta, mids) {
    const out = [];
    const ap = Array.isArray(state?.assetPositions) ? state.assetPositions : [];
    for (const item of ap) {
      const p = item?.position || item;
      const coin = p?.coin;
      if (!coin) continue;
      const szi = num(p.szi);
      if (!isNum(szi) || szi === 0) continue;
      const a = meta?.assets?.[coin] || {};
      const entry = num(p.entryPx);
      const markLive = num(a.markPx);
      const mid = num(mids?.[coin]);
      const mark = isNum(markLive) ? markLive : mid;
      const markProv = isNum(markLive) ? PROV.LIVE : isNum(mid) ? PROV.LIVE : PROV.UNKNOWN;
      const liq = num(p.liquidationPx);
      const side = szi > 0 ? "LONG" : "SHORT";
      const absSize = Math.abs(szi);
      const notionalApi = num(p.positionValue);
      const notional = isNum(notionalApi) ? notionalApi : isNum(mark) ? absSize * mark : NaN;
      const upnlApi = num(p.unrealizedPnl);
      const upnl = isNum(upnlApi) ? upnlApi : isNum(entry) && isNum(mark) ? szi * (mark - entry) : NaN;
      const lev = p.leverage || {};
      const leverage = num(lev.value);
      const marginMode = lev.type === "isolated" ? "isolated" : "cross";
      const marginUsed = num(p.marginUsed);
      const roe = num(p.returnOnEquity);
      const cf = p.cumFunding || {};
      let liqDist = NaN;
      if (isNum(mark) && mark > 0 && isNum(liq) && liq > 0) liqDist = side === "LONG" ? (mark - liq) / mark : (liq - mark) / mark;
      const fundingHourly = num(a.fundingHourly);
      // positive funding => longs pay shorts
      const fundingPerHour = isNum(fundingHourly) && isNum(notional) ? (side === "LONG" ? -1 : 1) * notional * fundingHourly : NaN;
      out.push({
        coin, side, szi, absSize, entry, mark, liq, liqDist, notional, upnl, roe, leverage, marginMode, marginUsed,
        maxLeverage: num(a.maxLeverage), mmRate: a.mmRate,
        mmEstimate: isNum(notional) && isNum(a.mmRate) ? notional * a.mmRate : NaN,
        fundingHourly, fundingPerHour, fundingPerDay: isNum(fundingPerHour) ? fundingPerHour * 24 : NaN,
        cumFunding: { allTime: num(cf.allTime), sinceOpen: num(cf.sinceOpen), sinceChange: num(cf.sinceChange) },
        prov: {
          mark: markProv, liq: isNum(liq) ? PROV.LIVE : PROV.UNKNOWN,
          notional: isNum(notionalApi) ? PROV.LIVE : isNum(notional) ? PROV.CALCULATED : PROV.UNKNOWN,
          upnl: isNum(upnlApi) ? PROV.LIVE : isNum(upnl) ? PROV.CALCULATED : PROV.UNKNOWN,
          funding: isNum(fundingHourly) ? PROV.LIVE : PROV.UNKNOWN,
        },
      });
    }
    // deterministic order: largest notional first
    out.sort((x, y) => (isNum(y.notional) ? y.notional : 0) - (isNum(x.notional) ? x.notional : 0));
    return out;
  }

  function parseOrders(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const o of arr) {
      if (!o) continue;
      const coin = o.coin || "—";
      const sideRaw = String(o.side || "").toUpperCase();
      const side = sideRaw === "B" || sideRaw === "BUY" ? "BUY" : sideRaw === "A" || sideRaw === "SELL" ? "SELL" : sideRaw || "—";
      const triggerPx = num(o.triggerPx);
      const isTrigger = !!o.isTrigger || (isNum(triggerPx) && triggerPx > 0);
      const type = typeof o.orderType === "string" ? o.orderType : isTrigger ? "Trigger" : "Limit";
      const tpsl = String(o.tpsl || "").toLowerCase(); // "tp" | "sl" when present (frontendOpenOrders)
      const kind = tpsl === "tp" || /take/i.test(type) ? "TP" : tpsl === "sl" || /stop/i.test(type) ? "SL" : isTrigger ? "TRIGGER" : "LIMIT";
      out.push({
        oid: o.oid, coin, side, type, kind, isTrigger, triggerPx,
        sz: num(o.sz), origSz: num(o.origSz), limitPx: num(o.limitPx),
        reduceOnly: !!o.reduceOnly, isPositionTpsl: !!o.isPositionTpsl, ts: num(o.timestamp),
      });
    }
    out.sort((a, b) => a.coin.localeCompare(b.coin));
    return out;
  }

  function parsePredictedFundings(predicted) {
    // [ [ "BTC", [ ["BinPerp", {fundingRate, nextFundingTime, fundingIntervalHours}], ["HlPerp", {...}] ] ], ... ]
    const map = {};
    if (!Array.isArray(predicted)) return map;
    for (const entry of predicted) {
      const coin = entry?.[0];
      const venues = entry?.[1];
      if (!coin || !Array.isArray(venues)) continue;
      const rec = {};
      for (const v of venues) {
        const venue = v?.[0], obj = v?.[1];
        if (!venue || !obj) continue;
        const rate = num(obj.fundingRate);
        const interval = num(obj.fundingIntervalHours);
        // normalise everything to an hourly rate. HL native funding is hourly; other venues usually 8h.
        const hours = isNum(interval) && interval > 0 ? interval : venue === "HlPerp" ? 1 : 8;
        rec[venue] = { rate, intervalHours: hours, hourly: isNum(rate) ? rate / hours : NaN, nextFundingTime: num(obj.nextFundingTime) };
      }
      map[coin] = rec;
    }
    return map;
  }

  function parseCandles(raw) {
    // [{t, T, s, i, o, c, h, l, v, n}] — strings for prices
    if (!Array.isArray(raw)) return [];
    return raw
      .map((k) => ({ t: num(k.t), o: num(k.o), h: num(k.h), l: num(k.l), c: num(k.c), v: num(k.v), n: num(k.n) }))
      .filter((k) => isNum(k.t) && isNum(k.c))
      .sort((a, b) => a.t - b.t);
  }

  function parseFundingHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({ t: num(r.time), rate: num(r.fundingRate), premium: num(r.premium) })).filter((r) => isNum(r.t) && isNum(r.rate)).sort((a, b) => a.t - b.t);
  }

  function parseFills(raw) {
    // userFills => [{coin, px, sz, side:"A"|"B", time, startPosition, dir, closedPnl, hash, oid, crossed, fee, feeToken, tid}]
    if (!Array.isArray(raw)) return [];
    return raw
      .map((f) => ({
        coin: f.coin, px: num(f.px), sz: num(f.sz), side: f.side === "B" ? "BUY" : f.side === "A" ? "SELL" : String(f.side || ""),
        t: num(f.time), startPosition: num(f.startPosition), dir: f.dir || "", closedPnl: num(f.closedPnl), fee: num(f.fee), feeToken: f.feeToken, oid: f.oid, tid: f.tid, crossed: !!f.crossed,
      }))
      .filter((f) => f.coin && isNum(f.t))
      .sort((a, b) => a.t - b.t);
  }

  function parseUserFunding(raw) {
    // [{time, hash, delta:{type:"funding", coin, usdc, szi, fundingRate, nSamples}}] — usdc is signed: positive = received
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => ({ t: num(r.time), coin: r.delta?.coin, usdc: num(r.delta?.usdc), szi: num(r.delta?.szi), rate: num(r.delta?.fundingRate) }))
      .filter((r) => isNum(r.t) && r.coin && isNum(r.usdc))
      .sort((a, b) => a.t - b.t);
  }

  function parsePortfolio(raw) {
    // [["day",{accountValueHistory:[[t,"v"]], pnlHistory:[[t,"v"]], vlm}], ["week",...], ["month",...], ["allTime",...], ["perpDay",...] ...]
    const out = {};
    if (!Array.isArray(raw)) return out;
    for (const e of raw) {
      const key = e?.[0], v = e?.[1];
      if (!key || !v) continue;
      out[key] = {
        accountValue: (v.accountValueHistory || []).map((p) => [num(p[0]), num(p[1])]).filter((p) => isNum(p[0]) && isNum(p[1])),
        pnl: (v.pnlHistory || []).map((p) => [num(p[0]), num(p[1])]).filter((p) => isNum(p[0]) && isNum(p[1])),
        vlm: num(v.vlm),
      };
    }
    return out;
  }

  function parseLedger(raw) {
    // userNonFundingLedgerUpdates => [{time, hash, delta:{type:"deposit"|"withdraw"|..., usdc}}]
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => ({ t: num(r.time), type: r.delta?.type || "", usdc: num(r.delta?.usdc ?? r.delta?.amount) }))
      .filter((r) => isNum(r.t))
      .sort((a, b) => a.t - b.t);
  }

  function parseL2(raw, depth = 10) {
    const levels = raw?.levels;
    if (!Array.isArray(levels) || levels.length < 2) return null;
    const side = (arr) => (Array.isArray(arr) ? arr.slice(0, depth).reduce((s, l) => s + (num(l.sz) || 0) * (num(l.px) || 0), 0) : NaN);
    const bidUsd = side(levels[0]), askUsd = side(levels[1]);
    const bestBid = num(levels[0]?.[0]?.px), bestAsk = num(levels[1]?.[0]?.px);
    return { bidUsd, askUsd, imbalance: isNum(bidUsd) && isNum(askUsd) && bidUsd + askUsd > 0 ? (bidUsd - askUsd) / (bidUsd + askUsd) : NaN, spread: isNum(bestBid) && isNum(bestAsk) && bestBid > 0 ? (bestAsk - bestBid) / bestBid : NaN, t: num(raw?.time) };
  }

  /** Build a normalized snapshot from raw payloads. Missing pieces are reported in `partial`. */
  function buildSnapshot({ wallet, state, metaAndCtxs, mids, openOrders, predicted, ts }) {
    const partial = [];
    const meta = parseMeta(metaAndCtxs);
    if (!meta.ok) partial.push("metaAndAssetCtxs");
    if (!mids || typeof mids !== "object") partial.push("allMids");
    if (!Array.isArray(openOrders)) partial.push("openOrders");
    if (!Array.isArray(predicted)) partial.push("predictedFundings");
    const account = parseAccount(state);
    const positions = parsePositions(state, meta, mids);
    const orders = parseOrders(openOrders);
    // attach TP/SL orders to positions
    for (const p of positions) {
      const mine = orders.filter((o) => o.coin === p.coin && (o.reduceOnly || o.isPositionTpsl || o.isTrigger));
      const closing = mine.filter((o) => (p.side === "LONG" ? o.side === "SELL" : o.side === "BUY"));
      const trig = closing.filter((o) => isNum(o.triggerPx));
      const sl = trig.filter((o) => (p.side === "LONG" ? o.triggerPx < p.mark : o.triggerPx > p.mark) || o.kind === "SL");
      const tp = trig.filter((o) => (p.side === "LONG" ? o.triggerPx > p.mark : o.triggerPx < p.mark) || o.kind === "TP");
      p.stopLoss = sl.length ? sl.map((o) => o.triggerPx).sort((a, b) => (p.side === "LONG" ? b - a : a - b))[0] : NaN;
      p.takeProfit = tp.length ? tp.map((o) => o.triggerPx).sort((a, b) => (p.side === "LONG" ? a - b : b - a))[0] : NaN;
      p.orders = mine.length;
    }
    return { ts: ts || Date.now(), wallet, account, positions, orders, meta, mids: mids || {}, predictedFunding: parsePredictedFundings(predicted), partial, raw: { state, metaAndCtxs, openOrders, predicted } };
  }

  AOS.normalize = { mmRateFor, parseMeta, parseAccount, parsePositions, parseOrders, parsePredictedFundings, parseCandles, parseFundingHistory, parseFills, parseUserFunding, parsePortfolio, parseLedger, parseL2, buildSnapshot };
})(typeof window !== "undefined" ? window : globalThis);
