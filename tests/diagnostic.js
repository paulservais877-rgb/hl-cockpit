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
})();
