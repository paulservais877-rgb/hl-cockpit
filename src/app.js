/* Personal Alpha OS — application boot: wiring data → pipeline → views, watcher, privacy, settings */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, fmt, nowMs } = AOS.util;
  const store = AOS.store, D = AOS.dom, V = AOS.views;
  const { $, set, html, raw, esc } = D;

  // Default wallet (public address already committed in this repository). Change it in Settings.
  const DEFAULT_WALLET = "0x35f0851EF6516c5706107b86dBe09A62A311ab07";
  const params = new URLSearchParams(location.search);
  const DEMO = params.get("demo") === "1" || root.AOS_DEMO === true;

  let analysis = null, prevAnalysis = null, history = null, historyTs = 0, historyCoins = "", orbital = null, pipelineTimer = null, lastPipelineTs = 0, historyLoading = null;

  function banner(kind, text, id) {
    const box = $("#banners");
    if (id && box.querySelector(`[data-id="${id}"]`)) return;
    const el = document.createElement("div"); el.className = "banner " + kind; if (id) el.dataset.id = id;
    el.innerHTML = `<span>${text}</span><button class="x" aria-label="Fermer">×</button>`;
    el.querySelector(".x").addEventListener("click", () => el.remove());
    box.appendChild(el);
  }

  // ---- sync pill ----------------------------------------------------------------------
  function renderSync() {
    const S = store.state.sync;
    const st = AOS.sync.computeStatus();
    const age = isNum(S.lastOkTs) ? nowMs() - S.lastOkTs : NaN;
    const el = $("#sync"); el.dataset.s = st;
    const label = AOS.i18n.sync(st);
    const wsLabel = { CONNECTED: "connecté", CONNECTING: "connexion", LIVE: "direct", RECONNECTING: "reconnexion", ERROR: "erreur", DEMO: "démo" }[S.ws] || S.ws;
    el.innerHTML = `<span class="dot"></span><b>${label}</b><span>${isNum(age) ? "il y a " + fmt.age(age) : "—"}</span>${S.ws && S.ws !== "OFF" && S.ws !== "DEMO" ? `<span class="dimc">ws ${esc(wsLabel)}</span>` : ""}${S.source === "demo" ? '<span class="tag info">DÉMO</span>' : ""}`;
    const det = $("#sync-detail");
    if (det) det.innerHTML = `<span>DERNIÈRE SYNCHRO <b class="num">${esc(fmt.time(S.lastOkTs))}</b></span><span>FRAÎCHEUR <b class="num">${isNum(age) ? esc(fmt.age(age)) : "—"}</b></span><span>API <b>${esc(label)}</b>${S.latencyMs ? ` <span class="dimc">${Math.round(S.latencyMs)} ms</span>` : ""}</span><span>MODE DÉGRADÉ <b class="${S.partial?.length ? "warnc" : ""}">${S.partial?.length ? "OUI (" + esc(S.partial.join(", ")) + ")" : "NON"}</b></span><span>PROCHAINE <b class="num">${isNum(S.nextTs) ? esc(fmt.age(Math.max(0, S.nextTs - nowMs()))) : "—"}</b></span>${S.errors?.length ? `<span class="neg">${esc(S.errors.slice(-2).join(" · "))}</span>` : ""}${history?.errors?.length ? `<span class="warnc">historique partiel : ${history.errors.length} erreur(s)</span>` : ""}`;
  }

  // ---- history loading ---------------------------------------------------------------
  async function ensureHistory(snapshot) {
    if (DEMO) {
      if (!history) { const fx = AOS.fixtures, N = AOS.normalize; history = { candles: fx.history.candles, funding: fx.history.funding, l2: fx.history.l2, fills: N.parseFills(fx.fills), userFunding: N.parseUserFunding(fx.userFunding), portfolio: N.parsePortfolio(fx.portfolio), ledger: N.parseLedger(fx.ledger), spot: N.parseSpot(fx.spotClearinghouseState), errors: [], loadedTs: nowMs() }; }
      return history;
    }
    const coins = (snapshot.positions || []).map((p) => p.coin).sort().join(",");
    const fresh = history && nowMs() - historyTs < 15 * 60e3 && coins === historyCoins;
    if (fresh) return history;
    if (historyLoading) return historyLoading;
    historyLoading = AOS.history.loadAll(snapshot, { wallet: snapshot.wallet, watchlist: store.settings.watchlist, onProgress: (d, n) => { const el = $("#hist-progress"); if (el) el.textContent = `historique ${d}/${n}`; } })
      .then((h) => { history = h; historyTs = nowMs(); historyCoins = coins; const el = $("#hist-progress"); if (el) el.textContent = ""; if (h.errors.length) banner("warn", `Historique partiel : ${h.errors.slice(0, 3).map(esc).join(" · ")}${h.errors.length > 3 ? " …" : ""}`, "hist"); return h; })
      .finally(() => { historyLoading = null; });
    return historyLoading;
  }

  // ---- pipeline & render -------------------------------------------------------------------
  async function analyze(reason) {
    const snap = store.state.snapshot;
    if (!snap) return;
    try {
      const h = await ensureHistory(snap);
      const t0 = performance.now();
      prevAnalysis = analysis;
      analysis = AOS.pipeline.run(store.state.snapshot, h, store.settings, prevAnalysis, { persist: !DEMO });
      analysis.history = h;
      lastPipelineTs = nowMs();
      renderAll();
      if (analysis.alerts.length && prevAnalysis) { const stored = store.list("alerts"); store.saveList("alerts", [...stored, ...analysis.alerts].slice(-100)); notify(analysis.alerts); }
      (root.console || {}).debug?.("[aos] pipeline", reason, Math.round(performance.now() - t0) + "ms", analysis.timings);
    } catch (e) {
      console.error("[aos] pipeline error", e);
      banner("bad", "Erreur d'analyse : " + esc(e?.message || e) + " — les données brutes restent visibles dans Réglages → Export.", "pipeline");
    }
  }
  const schedulePipeline = (reason, delay = 300) => { clearTimeout(pipelineTimer); pipelineTimer = setTimeout(() => analyze(reason), delay); };

  function renderAll() {
    const a = analysis; if (!a) return;
    V.command(a, prevAnalysis);
    V.alerts(a);
    V.positions(a);
    if (store.state.ui.selected) V.positionDetail(a, store.state.ui.selected);
    V.sentinel(a);
    V.market(a, prevAnalysis);
    V.council(a);
    V.decisions(a);
    AOS.simUI.setAnalysis(a);
    V.cone(a);
    V.archive(a);
    orbital?.update(a, { privacy: store.settings.privacy });
    D.sum("orbit", a.risk.gravity[0] ? `${a.risk.gravity[0].coin} porte ${Math.round(a.risk.gravity[0].share * 100)} % du risque` : "aucune position");
    $("#stamp").textContent = `Analyse à ${fmt.time(a.ts)} · ${a.snapshot.positions.length} position(s) · calcul complet en ${a.timings.cone} ms`;
  }

  // ---- notifications / watcher -------------------------------------------------------------
  function notify(alerts) {
    if (!store.settings.watcher.enabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const a of alerts.filter((x) => x.severity >= 2).slice(0, 3)) { try { new Notification("Alpha OS — " + a.what, { body: `${a.why}\n${a.action}` }); } catch (e) { /* ignore */ } }
  }
  let lastWatch = 0;
  setInterval(() => {
    const w = store.settings.watcher;
    if (!w.enabled || !AOS.alerts.inWindow(w)) return;
    if (nowMs() - lastWatch < (w.everyHours || 2) * 3600e3) return;
    lastWatch = nowMs();
    AOS.sync.sync("watcher").then(() => analyze("watcher"));
  }, 60e3);

  // ---- events ---------------------------------------------------------------------------------
  store.on("sync", renderSync);
  store.on("tick", renderSync);
  store.on("snapshot", () => { renderSync(); schedulePipeline("snapshot", 50); });
  store.on("marks", () => { if (nowMs() - lastPipelineTs > 8000) schedulePipeline("marks", 500); });

  function wire() {
    $("#btn-sync").addEventListener("click", () => AOS.sync.sync("manual"));
    $("#btn-privacy").addEventListener("click", () => { const p = !store.settings.privacy; store.saveSettings({ privacy: p }); applyPrivacy(); });
    $("#btn-settings").addEventListener("click", () => { const d = $("#settings"); d.open = true; d.scrollIntoView({ behavior: "smooth" }); });
    // ouvrir la section visée par un lien de navigation
    document.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", () => { const d = document.querySelector(a.getAttribute("href")); if (d && d.tagName === "DETAILS") d.open = true; }));
    D.on($("#poslist"), "click", ".poscard", (e, t) => { store.state.ui.selected = t.dataset.coin; V.positionDetail(analysis, t.dataset.coin); });
    D.on($("#poslist"), "keydown", ".poscard", (e, t) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); store.state.ui.selected = t.dataset.coin; V.positionDetail(analysis, t.dataset.coin); } });
    D.on($("#posdetail"), "click", "[data-close-detail]", () => { store.state.ui.selected = null; $("#posdetail").hidden = true; });
    D.on($("#decisions-body"), "click", "button[data-act]", (e, t) => {
      const id = t.closest("[data-card]").dataset.card;
      const card = analysis.orchestration.cards.find((c) => c.id === id);
      if (!card) return;
      const act = t.dataset.act;
      if (!DEMO) AOS.reputation.recordDecision(card, act);
      if (act === "EXECUTE") { window.open("https://app.hyperliquid.xyz/trade/" + encodeURIComponent(card.coin), "_blank", "noopener"); banner("info", `Décision « exécuter » enregistrée pour ${card.side} ${card.coin}. L'exécution se fait dans l'interface Hyperliquid : cette page n'envoie jamais d'ordre.`); }
      if (act === "SIMULATE") AOS.simUI.prefill(card);
      if (act === "IGNORE") { t.closest(".card").style.opacity = 0.45; banner("info", `« Ignorer » enregistré : ${card.side} ${card.coin} sera résolu à l'horizon pour mesurer les pertes évitées et les gains manqués.`); }
    });
    // settings
    D.on($("#settings-body"), "click", "#s-save", () => {
      const g = (id) => $(id).value.trim();
      const n = (id) => { const v = Number(g(id).replace(",", ".")); return Number.isFinite(v) && g(id) !== "" ? v : NaN; };
      const wallet = g("#s-wallet");
      store.saveSettings({
        pollMs: Math.max(10, n("#s-poll") || 30) * 1000, staleAfterMs: Math.max(30, n("#s-stale") || 90) * 1000, useWebSocket: g("#s-ws") === "1", autoSync: g("#s-auto") === "1",
        watchlist: g("#s-watch").toUpperCase().split(/[\s,]+/).filter(Boolean), watcher: { enabled: g("#s-w-on") === "1", startHour: n("#s-w-start") || 7.5, endHour: n("#s-w-end") || 20.5, everyHours: 2 },
        firewall: { coreCapital: n("#s-fw-core"), investmentCapital: n("#s-fw-inv"), tradingCapital: n("#s-fw-trade"), tactical: n("#s-fw-tact"), monthlyObligations: n("#s-fw-obl"), lastVerified: g("#s-fw-date") || null },
        risk: { baseRiskPerTrade: n("#s-r-base") || 0.01, maxRiskPerTrade: n("#s-r-max") || 0.02, minLiqDistance: n("#s-r-liq") || 0.15, minBufferRatio: n("#s-r-buf") || 0.25, maxConcentration: n("#s-r-conc") || 0.6, normalCorrStress: n("#s-r-corr") || 0.95 },
        weights: Object.fromEntries(["ORACLE", "EDGE", "FLOW", "ALLOCATOR", "ARCHIVE"].map((k) => [k, n("#s-w-" + k) || 0])),
      });
      if (store.settings.watcher.enabled && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
      if (wallet !== store.settings.wallet) { AOS.sync.setWallet(wallet); } else { AOS.sync.sync("settings"); }
      banner("info", "Réglages enregistrés.");
    });
    D.on($("#settings-body"), "click", "#s-export", () => {
      const blob = new Blob([JSON.stringify({ settings: { ...store.settings, firewall: undefined }, snapshot: store.state.snapshot ? { ...store.state.snapshot, raw: undefined } : null, analysis: analysis ? { ts: analysis.ts, risk: { level: analysis.risk.level, reasons: analysis.risk.reasons, grid: analysis.risk.grid.map((r) => ({ label: r.label, dPnl: r.dPnl, equity1: r.equity1 })) }, agents: analysis.agents, orchestration: { convictions: analysis.orchestration.convictions, cards: analysis.orchestration.cards.map((c) => ({ ...c, gate: { status: c.gate.status, failed: c.gate.failed }, convictionParts: undefined, review: undefined })), verdicts: analysis.orchestration.verdicts, action: analysis.orchestration.action }, alpha: { stats: analysis.alpha.stats, windows: analysis.alpha.windows } } : null, journal: store.list("journal"), decisions: store.list("decisions"), calls: store.list("calls") }, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "alpha-os-export.json"; document.body.appendChild(a); a.click(); a.remove();
    });
    D.on($("#settings-body"), "click", "#s-clear", () => { if (confirm("Effacer snapshot, journal, calls, décisions et réputation de ce wallet (local uniquement) ?")) { store.clearWalletData(); location.reload(); } });
  }

  function applyPrivacy() { document.body.classList.toggle("privacy", !!store.settings.privacy); $("#btn-privacy").setAttribute("aria-pressed", String(!!store.settings.privacy)); orbital?.update(analysis, { privacy: store.settings.privacy }); if (analysis) V.cone(analysis); }

  // ---- boot ---------------------------------------------------------------------------------------
  function boot() {
    AOS.starfield.start($("#stars"));
    orbital = AOS.orbital.create($("#orbit-canvas"), { onSelect: (coin) => { store.state.ui.selected = coin; if (analysis) { V.positionDetail(analysis, coin); } } });
    if (DEMO) { store.saveSettings({ wallet: AOS.fixtures.wallet }); banner("info", "<b>MODE DÉMO</b> — données inventées pour l'exemple, aucune connexion à Hyperliquid. Retire <code>?demo=1</code> de l'adresse pour ton wallet.", "demo"); }
    else if (!store.settings.wallet) store.saveSettings({ wallet: DEFAULT_WALLET });
    V.settings();
    wire();
    applyPrivacy();
    renderSync();
    if (location.protocol === "file:") banner("warn", "Ouvert en <code>file://</code> : le stockage local peut être limité (Safari/Brave). Héberge la page (GitHub Pages) pour une expérience fiable.", "file");
    AOS.sync.boot({ demoMode: DEMO }).then((snap) => { if (!snap && !store.state.snapshot) banner("bad", "Connexion Hyperliquid impossible et aucun cache. Vérifie le wallet dans Réglages, ta connexion, ou les Shields du navigateur (Brave/iOS).", "nosnap"); });
    store.on("settings", () => { if (!DEMO) V.settings(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  AOS.app = { get analysis() { return analysis; }, analyze, DEMO };
})(typeof window !== "undefined" ? window : globalThis);
