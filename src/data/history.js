/* Personal Alpha OS — historical data loader (candles, funding history, fills, user funding, portfolio, ledger)
   with TTL cache (memory + localStorage). Every dataset is tagged HISTORICAL with its load timestamp. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { H, D, isNum } = AOS.util;
  const store = AOS.store, hl = AOS.hl, N = AOS.normalize;

  const mem = new Map();
  const TTL = { candles1h: 20 * 60e3, candles4h: 60 * 60e3, candles1d: 3 * H, funding: H, fills: 5 * 60e3, userFunding: 15 * 60e3, portfolio: 15 * 60e3, ledger: H, l2: 60e3 };

  function cacheGet(key, ttl) {
    const m = mem.get(key);
    if (m && Date.now() - m.ts < ttl) return m.data;
    const s = store.storage.get(store.KEYS.history(key));
    if (s && Date.now() - s.ts < ttl) { mem.set(key, s); return s.data; }
    return null;
  }
  function cacheSet(key, data, persist = true) {
    const rec = { ts: Date.now(), data };
    mem.set(key, rec);
    if (persist) store.storage.set(store.KEYS.history(key), rec);
  }

  async function candles(coin, interval, days) {
    const key = `c_${coin}_${interval}_${days}`;
    const ttl = interval === "1d" ? TTL.candles1d : interval === "4h" ? TTL.candles4h : TTL.candles1h;
    const hit = cacheGet(key, ttl);
    if (hit) return hit;
    const end = Date.now();
    const raw = await hl.candles(coin, interval, end - days * D, end);
    const data = N.parseCandles(raw).map((k) => [k.t, k.o, k.h, k.l, k.c, k.v]); // compact for storage
    cacheSet(key, data);
    return data;
  }
  const expand = (compact) => (compact || []).map((k) => ({ t: k[0], o: k[1], h: k[2], l: k[3], c: k[4], v: k[5] }));

  async function fundingHistory(coin, days = 30) {
    const key = `f_${coin}_${days}`;
    const hit = cacheGet(key, TTL.funding);
    if (hit) return hit;
    const raw = await hl.fundingHistory(coin, Date.now() - days * D, Date.now());
    const data = N.parseFundingHistory(raw).map((r) => [r.t, r.rate, r.premium]);
    cacheSet(key, data);
    return data;
  }

  /** Fills over a window. Hyperliquid caps each response at 2000 fills (newest first), so we page backwards by time. */
  async function userFills(wallet, days = 30, maxPages = 5) {
    const key = `fills_${wallet.toLowerCase()}_${days}`;
    const hit = cacheGet(key, TTL.fills);
    if (hit) return hit;
    const start = Date.now() - days * D;
    let end = Date.now(), all = [], pages = 0;
    const seen = new Set();
    while (pages < maxPages) {
      const raw = await hl.userFillsByTime(wallet, start, end);
      const arr = Array.isArray(raw) ? raw : [];
      pages++;
      let oldest = Infinity;
      for (const f of arr) { const id = f.tid ?? f.hash + ":" + f.oid; if (seen.has(id)) continue; seen.add(id); all.push(f); oldest = Math.min(oldest, Number(f.time)); }
      if (arr.length < 2000 || !Number.isFinite(oldest) || oldest <= start) break;
      end = oldest - 1;
    }
    const data = N.parseFills(all);
    data.truncated = pages >= maxPages; // window not fully covered
    cacheSet(key, data);
    return data;
  }

  /** User funding payments, paged forward (500 per response). */
  async function userFunding(wallet, days = 90, maxPages = 12) {
    const key = `uf_${wallet.toLowerCase()}_${days}`;
    const hit = cacheGet(key, TTL.userFunding);
    if (hit) return hit;
    let start = Date.now() - days * D, all = [], pages = 0;
    const end = Date.now();
    while (pages < maxPages) {
      const raw = await hl.userFunding(wallet, start, end);
      const arr = Array.isArray(raw) ? raw : [];
      pages++;
      all = all.concat(arr);
      if (arr.length < 500) break;
      const newest = Math.max(...arr.map((r) => Number(r.time)));
      if (!Number.isFinite(newest) || newest <= start) break;
      start = newest + 1;
    }
    const data = N.parseUserFunding(all);
    cacheSet(key, data);
    return data;
  }

  async function spot(wallet) {
    const key = `spot_${wallet.toLowerCase()}`;
    const hit = cacheGet(key, TTL.portfolio);
    if (hit) return hit;
    const raw = await hl.spotClearinghouseState(wallet);
    const data = N.parseSpot(raw);
    cacheSet(key, data);
    return data;
  }

  async function portfolio(wallet) {
    const key = `pf_${wallet.toLowerCase()}`;
    const hit = cacheGet(key, TTL.portfolio);
    if (hit) return hit;
    const raw = await hl.portfolio(wallet);
    const data = N.parsePortfolio(raw);
    cacheSet(key, data);
    return data;
  }

  async function ledger(wallet, days = 365) {
    const key = `lg_${wallet.toLowerCase()}_${days}`;
    const hit = cacheGet(key, TTL.ledger);
    if (hit) return hit;
    const raw = await hl.ledger(wallet, Date.now() - days * D, Date.now());
    const data = N.parseLedger(raw);
    cacheSet(key, data);
    return data;
  }

  async function l2(coin) {
    const key = `l2_${coin}`;
    const hit = cacheGet(key, TTL.l2);
    if (hit) return hit;
    const raw = await hl.l2Book(coin);
    const data = N.parseL2(raw);
    cacheSet(key, data, false);
    return data;
  }

  /**
   * Load everything the engines need for a given snapshot. Failures are collected, never thrown:
   * the engines must run with whatever is available and tag the rest UNKNOWN.
   */
  async function loadAll(snapshot, { majors = ["BTC", "ETH", "SOL"], watchlist = [], wallet, onProgress } = {}) {
    const held = (snapshot?.positions || []).map((p) => p.coin);
    const universe = new Set(Object.keys(snapshot?.meta?.assets || {}));
    const core = [...new Set([...majors, ...held])].filter((c) => universe.size === 0 || universe.has(c));
    const extra = [...new Set(watchlist)].filter((c) => !core.includes(c) && (universe.size === 0 || universe.has(c)));
    const out = { candles: {}, funding: {}, l2: {}, fills: null, userFunding: null, portfolio: null, ledger: null, spot: null, errors: [], loadedTs: Date.now() };
    const tasks = [];
    const wrap = (label, p, assign) => tasks.push(p.then(assign).catch((e) => out.errors.push(label + ": " + (e?.message || e))));
    for (const c of core) {
      wrap("candles1h " + c, candles(c, "1h", 30), (d) => { (out.candles[c] = out.candles[c] || {})["1h"] = expand(d); });
      wrap("candles1d " + c, candles(c, "1d", 220), (d) => { (out.candles[c] = out.candles[c] || {})["1d"] = expand(d); });
      wrap("funding " + c, fundingHistory(c, 30), (d) => { out.funding[c] = d.map((r) => ({ t: r[0], rate: r[1], premium: r[2] })); });
    }
    for (const c of extra) wrap("candles1d " + c, candles(c, "1d", 40), (d) => { (out.candles[c] = out.candles[c] || {})["1d"] = expand(d); });
    for (const c of held) wrap("l2 " + c, l2(c), (d) => { out.l2[c] = d; });
    if (wallet) {
      wrap("userFills", userFills(wallet, 30), (d) => { out.fills = d; });
      wrap("userFunding", userFunding(wallet, 90), (d) => { out.userFunding = d; });
      wrap("portfolio", portfolio(wallet), (d) => { out.portfolio = d; });
      wrap("ledger", ledger(wallet, 365), (d) => { out.ledger = d; });
      wrap("spot", spot(wallet), (d) => { out.spot = d; });
    }
    let done = 0;
    await Promise.all(tasks.map((t) => t.then(() => onProgress?.(++done, tasks.length))));
    return out;
  }

  AOS.history = { candles, expand, fundingHistory, userFills, userFunding, portfolio, ledger, l2, spot, loadAll, TTL };
})(typeof window !== "undefined" ? window : globalThis);
