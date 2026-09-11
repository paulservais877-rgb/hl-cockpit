/* Personal Alpha OS — API diagnostic. Calls every Hyperliquid endpoint the dashboard uses for a wallet, prints status,
   latency, response shape (truncated) and what the normalizer extracts, with UNKNOWN fields flagged.
   Usage: node tests/diagnostic.js 0xWALLET [--full]   (Node ≥ 18, no dependency) */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const wallet = process.argv[2] || process.env.HL_WALLET;
const FULL = process.argv.includes("--full");
if (!/^0x[0-9a-fA-F]{40}$/.test(wallet || "")) { console.error("usage: node tests/diagnostic.js 0xWALLET"); process.exit(2); }
const ROOT = path.join(__dirname, "..");
globalThis.window = undefined;
for (const f of ["src/core/util.js", "src/core/store.js", "src/data/normalize.js"]) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
const AOS = globalThis.AOS, N = AOS.normalize, { isNum } = AOS.util;
const URL_ = "https://api.hyperliquid.xyz/info";
const D = 86400e3, now = Date.now();

const shape = (v, depth = 0) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return depth > 2 ? "[…]" : `[${v.length}]${v.length ? " of " + shape(v[0], depth + 1) : ""}`;
  if (typeof v === "object") return depth > 2 ? "{…}" : "{" + Object.keys(v).slice(0, 14).map((k) => k + ":" + shape(v[k], depth + 1)).join(", ") + (Object.keys(v).length > 14 ? ", …" : "") + "}";
  return typeof v === "string" ? `"${v.length > 18 ? v.slice(0, 18) + "…" : v}"` : String(v);
};
const trunc = (v, n = 1400) => { const s = JSON.stringify(v); return s.length > n && !FULL ? s.slice(0, n) + " …(" + s.length + " chars)" : s; };

async function call(label, payload) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const ms = Date.now() - t0;
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
    console.log(`\n### ${label}  →  HTTP ${res.status}  ${ms}ms  ${json === null ? "NON-JSON: " + text.slice(0, 200) : "shape " + shape(json)}`);
    if (json !== null) console.log(trunc(json));
    return { ok: res.ok && json !== null, json, status: res.status, ms };
  } catch (e) {
    console.log(`\n### ${label}  →  NETWORK ERROR ${e.message}`);
    return { ok: false, json: null, error: e.message };
  }
}

(async () => {
  console.log(`Alpha OS diagnostic · wallet ${wallet} · ${new Date().toISOString()}`);
  const r = {};
  r.state = await call("clearinghouseState", { type: "clearinghouseState", user: wallet });
  r.meta = await call("metaAndAssetCtxs", { type: "metaAndAssetCtxs" });
  r.mids = await call("allMids", { type: "allMids" });
  r.fo = await call("frontendOpenOrders", { type: "frontendOpenOrders", user: wallet });
  r.oo = await call("openOrders", { type: "openOrders", user: wallet });
  r.pf = await call("predictedFundings", { type: "predictedFundings" });
  r.portfolio = await call("portfolio", { type: "portfolio", user: wallet });
  r.fills = await call("userFills", { type: "userFills", user: wallet });
  r.uf = await call("userFunding (7d)", { type: "userFunding", user: wallet, startTime: now - 7 * D, endTime: now });
  r.ledger = await call("userNonFundingLedgerUpdates (365d)", { type: "userNonFundingLedgerUpdates", user: wallet, startTime: now - 365 * D, endTime: now });
  r.c1h = await call("candleSnapshot BTC 1h (2 bars)", { type: "candleSnapshot", req: { coin: "BTC", interval: "1h", startTime: now - 2 * 3600e3, endTime: now } });
  r.c1d = await call("candleSnapshot BTC 1d (2 bars)", { type: "candleSnapshot", req: { coin: "BTC", interval: "1d", startTime: now - 2 * D, endTime: now } });
  r.fh = await call("fundingHistory BTC (3h)", { type: "fundingHistory", coin: "BTC", startTime: now - 3 * 3600e3, endTime: now });
  r.l2 = await call("l2Book BTC", { type: "l2Book", coin: "BTC" });
  r.spot = await call("spotClearinghouseState", { type: "spotClearinghouseState", user: wallet });
  // exploratory: unified-account fields (keys only, to learn the API shape)
  for (const type of ["webData2", "userState", "unifiedAccountState", "delegatorSummary", "userVaultEquities"]) {
    const x = await call(type + " (exploratoire, clés seulement)", { type, user: wallet });
    if (x.json && typeof x.json === "object") console.log("   keys:", Array.isArray(x.json) ? "[array " + x.json.length + "]" : Object.keys(x.json).join(", "));
  }

  // ---- normalizer check --------------------------------------------------------------------------
  console.log("\n\n===== NORMALIZER =====");
  const snap = N.buildSnapshot({ wallet, state: r.state.json, metaAndCtxs: r.meta.json, mids: r.mids.json, openOrders: r.fo.ok ? r.fo.json : r.oo.json, predicted: r.pf.json, ts: now });
  console.log("partial endpoints:", snap.partial.length ? snap.partial.join(", ") : "none");
  const a = snap.account;
  console.log("account:", JSON.stringify({ equity: a.equity, marginUsed: a.marginUsed, mm: a.mm, withdrawable: a.withdrawable, bufferRatio: isNum(a.bufferRatio) ? +a.bufferRatio.toFixed(4) : NaN, effectiveLeverage: isNum(a.effectiveLeverage) ? +a.effectiveLeverage.toFixed(3) : NaN, prov: a.prov }));
  console.log(`positions: ${snap.positions.length}`);
  for (const p of snap.positions) {
    const unknown = Object.entries(p.prov).filter(([, v]) => v === "UNKNOWN").map(([k]) => k);
    const nan = ["entry", "mark", "liq", "liqDist", "notional", "upnl", "roe", "leverage", "marginUsed", "maxLeverage", "mmRate", "fundingHourly", "stopLoss", "takeProfit"].filter((k) => !isNum(p[k]));
    console.log(`  ${p.coin} ${p.side} szi=${p.szi} entry=${p.entry} mark=${p.mark} liq=${p.liq} dist=${isNum(p.liqDist) ? (p.liqDist * 100).toFixed(2) + "%" : "—"} lev=${p.leverage} ${p.marginMode} upnl=${p.upnl} roe=${p.roe} funding/h=${p.fundingHourly} SL=${p.stopLoss} TP=${p.takeProfit} orders=${p.orders}` + (unknown.length ? `  UNKNOWN: ${unknown.join(",")}` : "") + (nan.length ? `  NaN: ${nan.join(",")}` : ""));
  }
  console.log(`orders: ${snap.orders.length}`, snap.orders.map((o) => `${o.coin} ${o.side} ${o.kind} ${o.type} sz=${o.sz} px=${o.limitPx} trig=${o.triggerPx} ro=${o.reduceOnly} tpsl=${o.isPositionTpsl}`).join(" | "));
  const metaCoins = Object.keys(snap.meta.assets);
  console.log(`meta assets: ${metaCoins.length}`, metaCoins.length ? JSON.stringify(snap.meta.assets[metaCoins[0]]) : "");
  console.log("predicted funding BTC:", JSON.stringify(snap.predictedFunding.BTC || null));
  console.log("candles 1h parsed:", JSON.stringify(N.parseCandles(r.c1h.json).slice(-1)));
  console.log("funding history parsed:", JSON.stringify(N.parseFundingHistory(r.fh.json).slice(-1)));
  console.log("fills parsed:", N.parseFills(r.fills.json).length, JSON.stringify(N.parseFills(r.fills.json).slice(-1)));
  console.log("userFunding parsed:", N.parseUserFunding(r.uf.json).length, JSON.stringify(N.parseUserFunding(r.uf.json).slice(-1)));
  const pfp = N.parsePortfolio(r.portfolio.json);
  console.log("portfolio parsed keys:", Object.keys(pfp).join(","), Object.keys(pfp).length ? `month points=${pfp.month?.accountValue.length} last=${JSON.stringify(pfp.month?.accountValue.slice(-1))}` : "");
  console.log("ledger parsed:", N.parseLedger(r.ledger.json).length, JSON.stringify(N.parseLedger(r.ledger.json).slice(-2)));
  console.log("l2 parsed:", JSON.stringify(N.parseL2(r.l2.json)));
  // cross-check maintenance margin model
  const est = snap.positions.filter((p) => p.marginMode !== "isolated").reduce((s, p) => s + (isNum(p.mmEstimate) ? p.mmEstimate : 0), 0);
  console.log(`MM model: estimated Σ notional×0.5/maxLev = ${est.toFixed(2)} vs API crossMaintenanceMarginUsed = ${a.mm}  (scale ${isNum(a.mm) && est > 0 ? (a.mm / est).toFixed(3) : "—"})`);
  const failed = Object.entries(r).filter(([, v]) => !v.ok).map(([k]) => k);
  console.log("\nFAILED endpoints:", failed.length ? failed.join(", ") : "none");
  if (!r.state.ok) process.exit(1);

  // ---- full pipeline on live data (history loaded through the same code path as the browser) ----
  if (process.argv.includes("--pipeline") || process.env.HL_PIPELINE === "1") {
    console.log("\n\n===== FULL PIPELINE (live data) =====");
    for (const f of ["src/data/hl-rest.js", "src/data/history.js", "src/engine/features.js", "src/engine/portfolio.js", "src/engine/risk.js", "src/engine/simulate.js", "src/engine/cone.js", "src/engine/alpha.js", "src/agents/oracle.js", "src/agents/flow.js", "src/agents/edge.js", "src/agents/allocator.js", "src/agents/sentinel.js", "src/agents/archive.js", "src/agents/gates.js", "src/agents/reputation.js", "src/agents/orchestrator.js", "src/engine/alerts.js", "src/engine/pipeline.js"]) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
    AOS.store.saveSettings({ wallet });
    const t0 = Date.now();
    const history = await AOS.history.loadAll(snap, { wallet, watchlist: AOS.store.settings.watchlist });
    console.log(`history loaded in ${Date.now() - t0}ms · candles ${Object.keys(history.candles).join(",")} · fills ${history.fills?.length} · funding rows ${history.userFunding?.length} · ledger ${history.ledger?.length} · errors: ${history.errors.length ? history.errors.join(" | ") : "none"}`);
    const a = AOS.pipeline.run(snap, history, AOS.store.settings, null, { persist: false });
    const f2 = (x, d = 2) => (isNum(x) ? +x.toFixed(d) : null);
    console.log("timings", JSON.stringify(a.timings));
    console.log("REGIME", a.features.regime.regime, a.features.regime.confidence + "%", a.features.regime.bias, "· temperature", a.features.temperature.value, a.features.temperature.label, "· breadth", f2(a.features.breadth));
    console.log("PORTFOLIO", JSON.stringify({ gross: f2(a.portfolio.gross, 0), net: f2(a.portfolio.net, 0), grossLev: f2(a.portfolio.grossLev), betaBTC: f2(a.portfolio.betaBTC), volNormal: f2(a.portfolio.volNormal), volStress: f2(a.portfolio.volStress), effBets: f2(a.portfolio.effectiveBets), falseHedges: a.portfolio.falseHedges.length }));
    console.log("RISK", a.risk.level, JSON.stringify(a.risk.levels), "veto", a.risk.veto, "· btc20 loss", f2(a.risk.btc20LossPct, 3), "· combined loss", f2(a.risk.combinedLossPct, 3), "liquidated", a.risk.combined?.liquidated, "· reduceFirst", a.risk.reduceFirst[0]?.coin, "· fundingPerDay", f2(a.risk.fundingPerDay));
    for (const p of a.snapshot.positions) console.log(`  ${p.coin} ${p.side} liq=${f2(p.liq, 4)} dist=${f2(p.liqDist, 3)} ${p.noLiqAlone ? "(∞ alone)" : ""} prov=${p.prov.liq}`);
    console.log("SURVIVAL beta", a.risk.survival.beta.map((b) => `${b.label}:${f2(b.btcPx, 0)}(${f2(b.move, 2)})`).join(" "));
    console.log("SURVIVAL stress", a.risk.survival.stress.map((b) => `${b.label}:${f2(b.btcPx, 0)}(${f2(b.move, 2)})`).join(" "));
    console.log("GRAVITY", a.risk.gravity.map((g) => `${g.coin}:${Math.round(g.share * 100)}%`).join(" "));
    console.log("CONE", a.cone.ok ? a.cone.horizons.map((h) => `${h.horizon}d p10=${f2(h.p10, 0)} p50=${f2(h.p50, 0)} p90=${f2(h.p90, 0)} pLiq=${f2(h.pLiq, 3)}`).join(" | ") : a.cone.reason);
    for (const n of ["ORACLE", "FLOW", "EDGE", "ALLOCATOR", "SENTINEL", "ARCHIVE"]) console.log(`AGENT ${n}: ${a.agents[n].direction} conf=${f2(a.agents[n].confidence)} → ${a.agents[n].recommendation} · ${(a.agents[n].signals[0] || "").slice(0, 140)}`);
    console.log("EDGE opportunities", a.agents.EDGE.opportunities.map((o) => `${o.coin} ${o.side} ${o.type} EV=${f2(o.evR)} p=${f2(o.pWin)} rr=${f2(o.rr, 1)}`).join(" | ") || "none", "· rejected", a.agents.EDGE.rejected.length);
    console.log("CONVICTIONS", Object.values(a.orchestration.convictions).map((c) => `${c.coin}:${c.long}/DI${f2(c.disagreement)}`).join(" "));
    console.log("CARDS", a.orchestration.cards.map((c) => `${c.coin} ${c.side} ${c.status} conv=${c.conviction} failed=[${c.gate.failed.join(",")}] qty=${f2(c.sizing?.qty, 4)} risk$=${f2(c.sizing?.riskUsd, 0)}`).join(" | ") || "none");
    console.log("VERDICTS", a.orchestration.verdicts.map((v) => `${v.coin} ${v.side}: ${v.verdict} (${v.why[0]})`).join(" | "));
    console.log("ACTION", a.orchestration.action.kind, "—", a.orchestration.action.title, "—", a.orchestration.action.text);
    const al = a.alpha;
    console.log("ARCHIVE", JSON.stringify({ fills: al.fillsCount, spanDays: f2(al.activity.spanDays, 1), closed: al.closed.length, complete: al.complete.length, truncated: al.truncatedCount, winRate: f2(al.stats.winRate), expectancy: f2(al.stats.expectancy), profitFactor: f2(al.stats.profitFactor), fundingNet90d: f2(al.fundingNet), fees: f2(al.leakage.fees90d), perpsAllTimePnl: f2(al.perpsAllTimePnl, 0), capital: { total: f2(al.capital.totalHL, 0), perps: f2(al.capital.perps, 0), other: f2(al.capital.other, 0), deposits: f2(al.capital.deposits, 0), withdrawals: f2(al.capital.withdrawals, 0) } }));
    for (const k of ["week", "month", "allTime", "totalMonth", "totalAllTime"]) { const w = al.windows[k]; console.log(`  window ${k} (${w.key}): ret=${f2(w.ret, 4)} btc=${f2(w.btc, 4)} eth=${f2(w.eth, 4)} alphaBTC=${f2(w.alphaBTC, 4)} costPct=${f2(w.costPct, 4)} mdd=${f2(w.mdd?.mdd, 3)} sharpe=${f2(w.sharpe)} flows=${f2(w.flows, 0)} prov=${w.prov}`); }
    console.log("PATTERNS", al.patterns.join(" | ") || "none (n<5)");
    console.log("ANOMALIES", a.features.anomalies.map((x) => x.text).join(" | ") || "none");
    console.log("ALERTS", a.alerts.length);
    const nanScan = (obj, pathStr = "", out = [], depth = 0) => { if (depth > 4 || !obj || typeof obj !== "object") return out; for (const [k, v] of Object.entries(obj)) { if (typeof v === "number" && Number.isNaN(v)) out.push(pathStr + k); else if (v && typeof v === "object" && !Array.isArray(v)) nanScan(v, pathStr + k + ".", out, depth + 1); } return out; };
    const nans = nanScan({ portfolio: a.portfolio, risk: { level: a.risk.level, fundingPerDay: a.risk.fundingPerDay, budget: a.risk.budget }, regime: a.features.regime, temperature: a.features.temperature });
    console.log("NaN fields (expected UNKNOWN only):", nans.length ? nans.join(", ") : "none");
  }
})();
