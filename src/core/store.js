/* Personal Alpha OS — central store: state, pub/sub, persistence (localStorage with graceful fallback) */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});

  const memory = new Map();
  const storage = {
    get(key, fallback = null) {
      try {
        const ls = root.localStorage;
        const raw = ls ? ls.getItem(key) : memory.get(key);
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try {
        if (root.localStorage) root.localStorage.setItem(key, raw);
        else memory.set(key, raw);
        return true;
      } catch (e) {
        memory.set(key, raw);
        return false; // quota exceeded or storage blocked (private mode / file:// on some browsers)
      }
    },
    remove(key) {
      try { if (root.localStorage) root.localStorage.removeItem(key); } catch (e) { /* ignore */ }
      memory.delete(key);
    },
    keys(prefix) {
      const out = [];
      try {
        const ls = root.localStorage;
        if (ls) for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(prefix)) out.push(k); }
      } catch (e) { /* ignore */ }
      for (const k of memory.keys()) if (k.startsWith(prefix) && !out.includes(k)) out.push(k);
      return out;
    },
  };

  const DEFAULT_SETTINGS = {
    wallet: "",
    pollMs: 30000,
    staleAfterMs: 90000,
    useWebSocket: true,
    privacy: false,
    autoSync: true,
    watcher: { enabled: false, startHour: 7.5, endHour: 20.5, everyHours: 2 },
    // Capital firewall — stored LOCALLY only, never committed. Empty = unknown.
    firewall: { coreCapital: NaN, investmentCapital: NaN, tradingCapital: NaN, tactical: NaN, lastVerified: null, monthlyObligations: NaN },
    // Risk policy
    risk: {
      baseRiskPerTrade: 0.01, // 1% of trading capital at invalidation
      maxRiskPerTrade: 0.02,
      minLiqDistance: 0.15,
      minBufferRatio: 0.25,
      kellyFraction: 0.25,
      maxConcentration: 0.6,
      normalCorrStress: 0.95,
    },
    // Base agent weights (Market/Quant 40, Flow 35, Context 25)
    weights: { ORACLE: 0.2, EDGE: 0.2, FLOW: 0.35, ALLOCATOR: 0.15, ARCHIVE: 0.1 },
    benchmarks: ["BTC", "ETH"],
    watchlist: ["BTC", "ETH", "SOL", "TAO", "LINK", "ONDO", "PENDLE", "BNB", "HYPE"],
  };

  const KEYS = {
    settings: "aos_settings_v1",
    snapshot: (w) => "aos_snapshot_v1_" + (w || "").toLowerCase(),
    history: (k) => "aos_hist_v1_" + k,
    journal: (w) => "aos_journal_v1_" + (w || "").toLowerCase(),
    calls: (w) => "aos_calls_v1_" + (w || "").toLowerCase(),
    decisions: (w) => "aos_decisions_v1_" + (w || "").toLowerCase(),
    reputation: (w) => "aos_reputation_v1_" + (w || "").toLowerCase(),
    baseline: (w) => "aos_baseline_v1_" + (w || "").toLowerCase(),
    alerts: (w) => "aos_alerts_v1_" + (w || "").toLowerCase(),
  };

  function mergeDeep(base, over) {
    if (!over || typeof over !== "object") return base;
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const k of Object.keys(over)) {
      const b = base ? base[k] : undefined, o = over[k];
      out[k] = b && typeof b === "object" && !Array.isArray(b) && o && typeof o === "object" && !Array.isArray(o) ? mergeDeep(b, o) : o;
    }
    return out;
  }

  const listeners = new Map();
  const state = {
    settings: mergeDeep(DEFAULT_SETTINGS, storage.get(KEYS.settings, {})),
    sync: { status: "IDLE", lastOkTs: NaN, lastAttemptTs: NaN, errors: [], partial: [], ws: "OFF", seq: 0, nextTs: NaN, source: "none" },
    snapshot: null, // normalized live snapshot
    history: { candles: {}, funding: {}, fills: null, userFunding: null, portfolio: null, ledger: null, loadedTs: NaN, errors: [] },
    analysis: null, // output of the engines (features, portfolio, risk, agents, decisions)
    ui: { scenario: {}, simulator: null, selected: null, openSections: {} },
  };

  const store = {
    state,
    storage,
    KEYS,
    DEFAULT_SETTINGS,
    get settings() { return state.settings; },
    saveSettings(patch) {
      state.settings = mergeDeep(state.settings, patch);
      storage.set(KEYS.settings, state.settings);
      store.emit("settings", state.settings);
      return state.settings;
    },
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => listeners.get(evt).delete(fn);
    },
    emit(evt, payload) {
      const set = listeners.get(evt);
      if (set) for (const fn of set) { try { fn(payload); } catch (e) { (root.console || {}).error?.("listener error", evt, e); } }
      const all = listeners.get("*");
      if (all) for (const fn of all) { try { fn(evt, payload); } catch (e) { /* ignore */ } }
    },
    // wallet-scoped collections
    list(kind) { return storage.get(KEYS[kind](state.settings.wallet), []); },
    saveList(kind, arr) { storage.set(KEYS[kind](state.settings.wallet), arr); store.emit(kind, arr); },
    push(kind, item) { const arr = store.list(kind); arr.push(item); store.saveList(kind, arr); return item; },
    obj(kind, fallback = {}) { return storage.get(KEYS[kind](state.settings.wallet), fallback); },
    saveObj(kind, o) { storage.set(KEYS[kind](state.settings.wallet), o); store.emit(kind, o); },
    clearWalletData() {
      for (const k of ["snapshot", "journal", "calls", "decisions", "reputation", "baseline", "alerts"]) storage.remove(KEYS[k](state.settings.wallet));
      for (const k of storage.keys("aos_hist_v1_")) storage.remove(k);
    },
  };

  AOS.store = store;
})(typeof window !== "undefined" ? window : globalThis);
