/* Personal Alpha OS — sync orchestrator.
   Freshness state machine: IDLE → SYNCING → LIVE | DEGRADED | STALE | ERROR
   - sequence guard: a slower older response can never overwrite a newer snapshot
   - wallet-keyed cache: an old snapshot is ALWAYS shown as STALE, never as current
   - partial degradation is surfaced (which endpoint failed) instead of silently hidden
   - WebSocket (allMids / webData2) accelerates updates; REST polling is the source of truth */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, nowMs } = AOS.util;
  const store = AOS.store, hl = AOS.hl, N = AOS.normalize;

  let seq = 0, inFlight = null, pollTimer = null, tickTimer = null, ws = null, errorStreak = 0, demo = false;

  const S = store.state.sync;
  const set = (patch) => { Object.assign(S, patch); store.emit("sync", S); };

  function computeStatus() {
    if (S.status === "SYNCING" || S.status === "IDLE" || S.status === "ERROR") return S.status;
    const age = nowMs() - (S.lastOkTs || 0);
    if (!isNum(S.lastOkTs)) return S.status;
    if (age > store.settings.staleAfterMs) return "STALE";
    return S.partial.length ? "DEGRADED" : "LIVE";
  }

  function tick() {
    const st = computeStatus();
    if (st !== S.status && S.status !== "SYNCING") set({ status: st });
    else store.emit("tick", S);
  }

  function applySnapshot(snapshot, { fromCache = false, source = "rest" } = {}) {
    store.state.snapshot = snapshot;
    if (!fromCache) store.storage.set(store.KEYS.snapshot(snapshot.wallet), { ts: snapshot.ts, wallet: snapshot.wallet, account: snapshot.account, positions: snapshot.positions, orders: snapshot.orders, meta: snapshot.meta, mids: snapshot.mids, predictedFunding: snapshot.predictedFunding, partial: snapshot.partial });
    set({ source, partial: snapshot.partial || [] });
    store.emit("snapshot", snapshot);
  }

  /** Full REST sync. `reason` is for observability only. */
  async function sync(reason = "manual") {
    const wallet = (store.settings.wallet || "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) { set({ status: "ERROR", errors: ["Adresse wallet invalide (attendu: 0x + 40 hex)."] }); return null; }
    if (demo) return syncDemo();
    if (inFlight) return inFlight;
    const mySeq = ++seq;
    set({ status: "SYNCING", lastAttemptTs: nowMs(), seq: mySeq, reason });
    inFlight = (async () => {
      const t0 = nowMs();
      const results = await Promise.allSettled([
        hl.clearinghouseState(wallet),
        hl.metaAndAssetCtxs(),
        hl.allMids(),
        hl.openOrders(wallet),
        hl.predictedFundings(),
      ]);
      if (mySeq !== seq) return null; // superseded by a newer sync
      const [state, meta, mids, orders, predicted] = results.map((r) => (r.status === "fulfilled" ? r.value : null));
      const errors = results.map((r, i) => (r.status === "rejected" ? ["clearinghouseState", "metaAndAssetCtxs", "allMids", "openOrders", "predictedFundings"][i] + ": " + (r.reason?.message || r.reason) : null)).filter(Boolean);
      if (!state || typeof state !== "object") {
        errorStreak++;
        const cached = store.state.snapshot;
        set({ status: cached ? "STALE" : "ERROR", errors, latencyMs: nowMs() - t0 });
        return null;
      }
      errorStreak = 0;
      const snapshot = N.buildSnapshot({ wallet, state, metaAndCtxs: meta, mids, openOrders: orders, predicted, ts: nowMs() });
      set({ lastOkTs: snapshot.ts, errors, latencyMs: nowMs() - t0, status: snapshot.partial.length ? "DEGRADED" : "LIVE" });
      applySnapshot(snapshot, { source: "rest" });
      return snapshot;
    })().catch((e) => { set({ status: store.state.snapshot ? "STALE" : "ERROR", errors: [String(e?.message || e)] }); return null; })
      .finally(() => { inFlight = null; schedulePoll(); });
    return inFlight;
  }

  function syncDemo() {
    const fx = AOS.fixtures;
    const snapshot = N.buildSnapshot({ wallet: store.settings.wallet, state: fx.clearinghouseState, metaAndCtxs: fx.metaAndAssetCtxs, mids: fx.allMids, openOrders: fx.openOrders, predicted: fx.predictedFundings, ts: nowMs() });
    set({ status: "LIVE", lastOkTs: snapshot.ts, errors: [], source: "demo", ws: "DEMO" });
    applySnapshot(snapshot, { source: "demo", fromCache: true });
    schedulePoll();
    return Promise.resolve(snapshot);
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!store.settings.autoSync) { set({ nextTs: NaN }); return; }
    const base = store.settings.pollMs;
    const wait = Math.min(base * 2 ** Math.min(errorStreak, 4), 5 * 60e3); // backoff on errors: 30s → 60 → 120 → 240 → 300
    set({ nextTs: nowMs() + wait });
    pollTimer = setTimeout(() => sync("poll"), wait);
  }

  // ---- WebSocket integration ------------------------------------------------------
  function onMids(mids, ts) {
    const snap = store.state.snapshot;
    if (!snap || demo) return;
    // update marks in place (cheap) — a full rebuild happens at the next REST poll or webData2 message
    let changed = false;
    for (const p of snap.positions) {
      const m = AOS.util.num(mids[p.coin]);
      if (isNum(m) && m !== p.mark) {
        p.mark = m; p.prov.mark = "LIVE";
        if (isNum(p.entry)) p.upnl = p.szi * (m - p.entry);
        p.notional = p.absSize * m;
        if (isNum(p.liq) && p.liq > 0) p.liqDist = p.side === "LONG" ? (m - p.liq) / m : (p.liq - m) / m;
        changed = true;
      }
    }
    snap.mids = mids;
    if (changed) { set({ wsTs: ts }); store.emit("marks", snap); }
  }
  function onWebData(data, ts) {
    if (demo) return;
    const wallet = store.settings.wallet;
    const state = data.clearinghouseState;
    if (!state) return;
    const metaAndCtxs = data.meta && data.assetCtxs ? [data.meta, data.assetCtxs] : store.state.snapshot?.raw?.metaAndCtxs || null;
    const snapshot = N.buildSnapshot({ wallet, state, metaAndCtxs, mids: store.state.snapshot?.mids || {}, openOrders: Array.isArray(data.openOrders) ? data.openOrders : store.state.snapshot?.raw?.openOrders || null, predicted: store.state.snapshot?.raw?.predicted || null, ts });
    // WS-built snapshot inherits REST-only partial flags (openOrders/predictedFundings) so DEGRADED stays honest
    set({ lastOkTs: ts, wsTs: ts, status: snapshot.partial.length ? "DEGRADED" : "LIVE" });
    applySnapshot(snapshot, { source: "ws" });
  }
  function startWs() {
    if (demo || !store.settings.useWebSocket || typeof WebSocket === "undefined") return;
    if (!ws) ws = AOS.hlws.createWs({ onMids, onWebData, onStatus: (s) => set({ ws: s }), log: (...a) => (root.console || {}).debug?.(...a) });
    ws.start(store.settings.wallet);
  }
  function stopWs() { if (ws) ws.stop(); }

  // ---- lifecycle ---------------------------------------------------------------------
  function boot({ demoMode = false } = {}) {
    demo = demoMode;
    const wallet = store.settings.wallet;
    const cached = wallet ? store.storage.get(store.KEYS.snapshot(wallet)) : null;
    if (cached && cached.wallet === wallet && !demo) {
      cached.raw = {};
      store.state.snapshot = cached;
      set({ status: "STALE", lastOkTs: cached.ts, source: "cache" });
      store.emit("snapshot", cached);
    }
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 1000);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { clearTimeout(pollTimer); stopWs(); }
        else { const age = nowMs() - (S.lastOkTs || 0); if (age > 15000) sync("visible"); else schedulePoll(); startWs(); }
      });
    }
    if (typeof root.addEventListener === "function") {
      root.addEventListener("online", () => sync("online"));
      root.addEventListener("offline", () => set({ errors: ["Navigateur hors ligne"] }));
    }
    startWs();
    return sync("boot");
  }

  function setWallet(wallet) {
    stopWs();
    seq++; inFlight = null;
    store.saveSettings({ wallet });
    store.state.snapshot = null;
    set({ status: "IDLE", lastOkTs: NaN, errors: [], partial: [] });
    return boot({ demoMode: demo });
  }

  AOS.sync = { sync, boot, setWallet, schedulePoll, computeStatus, get isDemo() { return demo; }, stopWs, startWs };
})(typeof window !== "undefined" ? window : globalThis);
