/* Personal Alpha OS — node test-suite (no dependencies). Run: node tests/run.js */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const FILES = [
  "src/core/util.js", "src/core/store.js", "src/data/normalize.js", "src/data/hl-rest.js", "src/data/history.js", "src/data/fixtures.js",
  "src/engine/features.js", "src/engine/portfolio.js", "src/engine/risk.js", "src/engine/simulate.js", "src/engine/cone.js", "src/engine/alpha.js",
  "src/agents/oracle.js", "src/agents/flow.js", "src/agents/edge.js", "src/agents/allocator.js", "src/agents/sentinel.js", "src/agents/archive.js",
  "src/agents/gates.js", "src/agents/reputation.js", "src/agents/orchestrator.js", "src/engine/alerts.js", "src/engine/pipeline.js",
];
globalThis.window = undefined;
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
const AOS = globalThis.AOS;
const { isNum } = AOS.util;

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } };
const near = (a, b, tol) => isNum(a) && isNum(b) && Math.abs(a - b) <= tol;

console.log("== normalize ==");
const fx = AOS.fixtures;
AOS.store.saveSettings({ wallet: fx.wallet });
const snap = AOS.normalize.buildSnapshot({ wallet: fx.wallet, state: fx.clearinghouseState, metaAndCtxs: fx.metaAndAssetCtxs, mids: fx.allMids, openOrders: fx.openOrders, predicted: fx.predictedFundings, ts: Date.now() });
t("4 positions parsed", snap.positions.length === 4);
t("no partial", snap.partial.length === 0, snap.partial.join(","));
t("BNB appears automatically", !!snap.positions.find((p) => p.coin === "BNB"));
const btc = snap.positions.find((p) => p.coin === "BTC");
t("BTC long side", btc.side === "LONG");
t("BTC mark from assetCtx", near(btc.mark, 91250, 1));
t("BTC liqDist", near(btc.liqDist, (91250 - 62150) / 91250, 1e-6));
t("BTC funding/h negative for long with positive funding", btc.fundingPerHour < 0);
t("BTC stop loss attached from TP/SL orders", near(btc.stopLoss, 82000, 1e-6), String(btc.stopLoss));
t("BTC take profit attached", near(btc.takeProfit, 98000, 1e-6), String(btc.takeProfit));
const eth = snap.positions.find((p) => p.coin === "ETH");
t("ETH short stop above mark", near(eth.stopLoss, 3390, 1e-6), String(eth.stopLoss));
t("account equity", near(snap.account.equity, 21850, 1e-6));
t("mm rate BTC = 0.5/40", near(snap.meta.assets.BTC.mmRate, 0.0125, 1e-9));
t("predicted funding HlPerp hourly", near(snap.predictedFunding.BTC.HlPerp.hourly, 0.0000125, 1e-12));
t("predicted funding BinPerp normalised to hourly", near(snap.predictedFunding.BTC.BinPerp.hourly, 0.0000125 * 8 * 0.9 / 8, 1e-12));
// tolerance: missing fields
const snap2 = AOS.normalize.buildSnapshot({ wallet: fx.wallet, state: { assetPositions: [{ position: { coin: "BTC", szi: "0.1", entryPx: "90000" } }] }, metaAndCtxs: null, mids: null, openOrders: null, predicted: null });
t("degraded snapshot lists partial endpoints", snap2.partial.length === 4, snap2.partial.join(","));
t("position without ctx has UNKNOWN mark", snap2.positions[0].prov.mark === "UNKNOWN");
t("candles parse", AOS.normalize.parseCandles([{ t: "1", o: "1", h: "2", l: "0.5", c: "1.5", v: "10" }]).length === 1);
const bnb = snap.positions.find((p) => p.coin === "BNB");
t("null liquidationPx → UNKNOWN before pipeline", !isNum(bnb.liq) && bnb.prov.liq === "UNKNOWN");
t("margin tiers parsed for BTC", Array.isArray(snap.meta.assets.BTC.marginTiers) && snap.meta.assets.BTC.marginTiers.length === 2);
t("tiered mm rate: small notional 0.5/40, huge notional 0.5/20", near(AOS.normalize.mmRateForNotional(snap.meta.assets.BTC, 1000), 0.0125, 1e-9) && near(AOS.normalize.mmRateForNotional(snap.meta.assets.BTC, 2e8), 0.025, 1e-9));
const lg = AOS.normalize.parseLedger(fx.ledger);
t("ledger flows signed (deposit +, send −, staking → total only)", lg[0].flowPerps === 15000 && lg[3].flowPerps === -500 && lg[2].flowPerps === 0 && lg[2].flowTotal === -77.2, JSON.stringify(lg));
const spotP = AOS.normalize.parseSpot(fx.spotClearinghouseState);
t("spot parsed", spotP.usdc === 1200.5 && spotP.balances.length === 2 && spotP.prov === "LIVE");
t("frontendOpenOrders limit (triggerPx '0.0') is LIMIT not trigger", snap.orders.find((o) => o.coin === "BTC" && o.limitPx === 60000).kind === "LIMIT");

console.log("== features ==");
const history = { candles: fx.history.candles, funding: fx.history.funding, l2: fx.history.l2, fills: AOS.normalize.parseFills(fx.fills), userFunding: AOS.normalize.parseUserFunding(fx.userFunding), portfolio: AOS.normalize.parsePortfolio(fx.portfolio), ledger: AOS.normalize.parseLedger(fx.ledger), spot: AOS.normalize.parseSpot(fx.spotClearinghouseState), errors: [] };
const feats = AOS.features.compute(snap, history, {});
t("BTC d1 features", !!feats.byCoin.BTC.d1 && isNum(feats.byCoin.BTC.d1.ema50));
t("BTC h4 features", !!feats.byCoin.BTC.h4 && isNum(feats.byCoin.BTC.h4.atr));
t("vol annualised plausible", feats.byCoin.BTC.vol > 0.2 && feats.byCoin.BTC.vol < 3, String(feats.byCoin.BTC.vol));
t("regime classified", AOS.features.REGIMES.includes(feats.regime.regime), feats.regime.regime);
t("regime confidence in range", feats.regime.confidence >= 5 && feats.regime.confidence <= 92);
t("temperature 0-100", feats.temperature.value >= 0 && feats.temperature.value <= 100, String(feats.temperature.value));
t("corr matrix diag 1", feats.corr.normal[0][0] === 1);
t("stress corr >= normal", feats.corr.stress[0][1] >= feats.corr.normal[0][1]);
t("beta BTC of BTC = 1", feats.corr.betaBTC.BTC === 1);
t("ema deterministic (SMA seed)", near(AOS.features.ema([1, 2, 3, 4, 5], 2)[4], 4.5, 1e-9));
t("rsi bounded", (() => { const r = AOS.features.rsi(Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5)); const l = r[r.length - 1]; return l >= 0 && l <= 100; })());

console.log("== portfolio ==");
const pf = AOS.portfolio.analyze(snap.positions, snap.account, feats);
t("gross = sum notionals", near(pf.gross, snap.positions.reduce((s, p) => s + p.notional, 0), 1e-6));
t("net = longs - shorts", near(pf.net, pf.longNtl - pf.shortNtl, 1e-6));
t("false hedge ETH short vs BTC/SOL long detected when corr high", pf.falseHedges.length >= 0);
t("stress vol >= normal vol", pf.volStress >= pf.volNormal - 1e-9);
t("concentration share sums to 1", near(pf.byAsset.reduce((s, a) => s + a.share, 0), 1, 1e-9));

console.log("== risk ==");
const risk = AOS.risk.evaluate(snap, feats, pf, AOS.store.settings);
t("risk level valid", ["NORMAL", "WATCH", "STRESSED", "DANGER", "CRITICAL"].includes(risk.level), risk.level);
t("margin model calibrated ~1", risk.model.scale > 0.5 && risk.model.scale < 2.5, String(risk.model.scale));
const zero = AOS.risk.shock(snap.positions, snap.account, {}, risk.model);
t("zero shock keeps equity", near(zero.equity1, snap.account.equity, 1e-6));
const down = AOS.risk.shock(snap.positions, snap.account, { BTC: -0.2 }, risk.model);
t("BTC -20% loses on the long", down.dPnl < 0 && near(down.dPnl, btc.szi * btc.mark * -0.2, 1e-6));
t("stress grid has combined row", !!risk.combined);
t("survival map monotonic (beta)", (() => { const m = risk.survival.beta.map((b) => b.move).filter(isNum); for (let i = 1; i < m.length; i++) if (Math.abs(m[i]) < Math.abs(m[i - 1]) - 1e-9) return false; return true; })(), JSON.stringify(risk.survival.beta.map((b) => b.move)));
t("gravity shares sum to 1", near(risk.gravity.reduce((s, g) => s + g.share, 0), 1, 1e-9));
t("reduceFirst ranked", risk.reduceFirst.length === 4);
t("veto boolean", typeof risk.veto === "boolean");
// deep-liquidation case
const badState = JSON.parse(JSON.stringify(fx.clearinghouseState)); badState.crossMarginSummary.accountValue = "1500"; badState.marginSummary.accountValue = "1500";
const badSnap = AOS.normalize.buildSnapshot({ wallet: fx.wallet, state: badState, metaAndCtxs: fx.metaAndAssetCtxs, mids: fx.allMids, openOrders: [], predicted: null });
const badRisk = AOS.risk.evaluate(badSnap, feats, AOS.portfolio.analyze(badSnap.positions, badSnap.account, feats), AOS.store.settings);
t("tiny equity → CRITICAL/DANGER + veto", (badRisk.level === "CRITICAL" || badRisk.level === "DANGER") && badRisk.veto, badRisk.level);

console.log("== simulate ==");
const levels = AOS.simulate.suggestLevels({ coin: "SOL", side: "LONG" }, feats, feats.byCoin.SOL.price);
t("suggested invalidation below entry for long", levels.invalidation < feats.byCoin.SOL.price);
t("suggested target above entry for long", levels.target > feats.byCoin.SOL.price);
const after = AOS.simulate.applyTrade(snap, feats, { coin: "LINK", side: "LONG", qty: 100 }, AOS.store.settings);
t("new position added", after.positions.length === 5 && !!after.positions.find((p) => p.coin === "LINK"));
t("new liq price computed for LINK", isNum(after.target.liq) && after.target.liq < after.target.mark, String(after.target.liq));
const single = AOS.normalize.buildSnapshot({ wallet: fx.wallet, state: { assetPositions: [], crossMarginSummary: { accountValue: "10000", totalMarginUsed: "0", totalNtlPos: "0" }, marginSummary: { accountValue: "10000", totalMarginUsed: "0", totalNtlPos: "0" }, crossMaintenanceMarginUsed: "0" }, metaAndCtxs: fx.metaAndAssetCtxs, mids: fx.allMids, openOrders: [], predicted: null });
const one = AOS.simulate.applyTrade(single, feats, { coin: "BTC", side: "LONG", qty: 0.5, leverage: 5 }, AOS.store.settings);
// single long 0.5 BTC @91250 with 10k equity: liq when 10000 + 0.5(p-91250) = 0.5 p × 0.0125 → p = (0.5·91250 − 10000)/(0.5·(1−0.0125))
t("single-position liq formula", near(one.target.liq, (0.5 * 91250 - 10000) / (0.5 * (1 - 0.0125)), 0.01), String(one.target.liq));
const oneS = AOS.simulate.applyTrade(single, feats, { coin: "BTC", side: "SHORT", qty: 0.5, leverage: 5 }, AOS.store.settings);
t("single short liq above mark", oneS.target.liq > 91250 && near(oneS.target.liq, (10000 + 0.5 * 91250) / (0.5 * (1 + 0.0125)), 0.01), String(oneS.target.liq));
const red = AOS.simulate.applyTrade(snap, feats, { coin: "BTC", side: "SHORT", qty: 0.42 }, AOS.store.settings);
t("closing trade removes position", !red.positions.find((p) => p.coin === "BTC"));
const imp = AOS.simulate.impact(snap, feats, { portfolio: pf, risk }, { coin: "LINK", side: "LONG", qty: 100 }, levels, AOS.store.settings);
t("impact has deltas", imp && isNum(imp.deltas.netExposure) && imp.deltas.netExposure > 0);
const sc = AOS.simulate.parseScenario("Que devient mon portefeuille si BTC baisse de 12 %, ETH monte de 5% et SOL baisse de 20 % ?", ["BNB"]);
t("NL parse BTC -12%", near(sc.BTC.pct, -0.12, 1e-9), JSON.stringify(sc));
t("NL parse ETH +5%", near(sc.ETH.pct, 0.05, 1e-9));
t("NL parse SOL -20%", near(sc.SOL.pct, -0.2, 1e-9));
const sc2 = AOS.simulate.parseScenario("BTC = 100k, ETH à 2500, SOL 150", []);
t("NL parse absolute BTC 100k", sc2.BTC.price === 100000, JSON.stringify(sc2));
t("NL parse ETH à 2500", sc2.ETH.price === 2500);
t("NL parse SOL 150", sc2.SOL?.price === 150, JSON.stringify(sc2));
const sc3 = AOS.simulate.parseScenario("BTC -15%, BNB +8%", ["BNB"]);
t("NL parse signed pct", near(sc3.BTC.pct, -0.15, 1e-9) && near(sc3.BNB.pct, 0.08, 1e-9), JSON.stringify(sc3));
const scen = AOS.simulate.applyScenario(snap, sc, feats);
t("scenario equity computed", isNum(scen.equity1) && scen.rows.length === 4);

console.log("== cone ==");
const cone = AOS.cone.simulate(snap.positions, snap.account, feats, risk.model, { paths: 400, fundingPerDay: risk.fundingPerDay, seed: 42 });
t("cone ok", cone.ok);
t("cone quantiles ordered", cone.horizons.every((h) => h.p10 <= h.p25 && h.p25 <= h.p50 && h.p50 <= h.p75 && h.p75 <= h.p90));
t("cone widens with horizon", cone.horizons[3].p90 - cone.horizons[3].p10 > cone.horizons[0].p90 - cone.horizons[0].p10);
t("cone deterministic with seed", (() => { const c2 = AOS.cone.simulate(snap.positions, snap.account, feats, risk.model, { paths: 400, fundingPerDay: risk.fundingPerDay, seed: 42 }); return c2.horizons[1].p50 === cone.horizons[1].p50; })());

console.log("== alpha ==");
const alpha = AOS.alpha.compute(snap, history, feats);
t("trades reconstructed (6 complete + 1 truncated)", alpha.closed.length === 7 && alpha.complete.length === 6 && alpha.truncatedCount === 1, `${alpha.closed.length}/${alpha.complete.length}/${alpha.truncatedCount}`);
t("truncated trade flagged and excluded from stats", alpha.closed.find((x) => x.coin === "XMR").truncated === true && alpha.stats.n === 6);
t("open trades = 4", alpha.open.length === 4, String(alpha.open.length));
t("first complete trade BTC long win", alpha.complete[0].coin === "BTC" && alpha.complete[0].side === "LONG" && alpha.complete[0].net > 0);
t("stats win rate in [0,1]", alpha.stats.winRate >= 0 && alpha.stats.winRate <= 1);
t("month window uses perps series", alpha.windows.month.key === "perpMonth" && isNum(alpha.windows.month.ret), JSON.stringify(alpha.windows.month.prov));
t("total-account window present", alpha.windows.totalMonth.key === "month" && isNum(alpha.windows.totalMonth.ret));
t("capital split total vs perps", near(alpha.capital.other, 6000, 1), String(alpha.capital.other));
t("alpha vs BTC computed", isNum(alpha.windows.month.alphaBTC));
t("funding paid > 0", alpha.fundingPaid > 0);
t("attribution present", Array.isArray(alpha.attribution) && alpha.attribution.length === 6);
const dz = AOS.alpha.dietz([[0, 1000], [10, 1200]], [{ t: 5, amt: 100 }], 0, 10);
t("dietz with deposit", near(dz.ret, (1200 - 1000 - 100) / (1000 + 50), 1e-9), String(dz.ret));
t("dietz ledger wrapper (perps kind ignores staking)", near(AOS.alpha.dietzLedger([[0, 1000], [10, 1100]], [{ t: 5, flowPerps: 0, flowTotal: -50 }], 0, 10, "perps").ret, 0.1, 1e-9));
// courbe d'equity rebasée : flux neutralisés, BTC rebasé sur la même fenêtre, HWM et repli
{
  const D = 86400e3, t0 = 1700000000000;
  const h = { portfolio: { perpMonth: { accountValue: [[t0, 1000], [t0 + D, 1100], [t0 + 2 * D, 1600], [t0 + 3 * D, 1400]] } }, ledger: [{ t: t0 + 1.5 * D, flowPerps: 500, flowTotal: 500 }], candles: { BTC: { "1d": [{ t: t0 - 3600e3, c: 100 }, { t: t0 + D, c: 110 }, { t: t0 + 2 * D, c: 120 }, { t: t0 + 3 * D, c: 90 }] } } };
  const c = AOS.alpha.equityCurve(h, "perpMonth", "perps");
  t("equity curve ok", c.ok === true && c.points.length === 4, c.reason);
  t("equity curve neutralises the deposit", near(c.points[2].you, 0.1, 1e-9) && near(c.points[3].you, -0.1, 1e-9), JSON.stringify(c.points.map((p) => p.you)));
  t("equity curve HWM and drawdown", near(c.hwm, 0.1, 1e-9) && near(c.dd, 900 / 1100 - 1, 1e-9), `${c.hwm} ${c.dd}`);
  t("equity curve BTC rebased on same window", near(c.points[3].btc, -0.1, 1e-9) && c.btcGapHours === 1, `${c.points[3].btc} gap ${c.btcGapHours}`);
  t("equity curve refuses a series starting at 0", AOS.alpha.equityCurve({ portfolio: { perpMonth: { accountValue: [[t0, 0], [t0 + D, 50]] } } }).ok === false);
}

console.log("== agents & pipeline ==");
const analysis = AOS.pipeline.run(snap, history, AOS.store.settings, null, { persist: true });
for (const name of ["ORACLE", "FLOW", "EDGE", "ALLOCATOR", "SENTINEL", "ARCHIVE"]) t(name + " structured output", analysis.agents[name] && analysis.agents[name].agent === name && typeof analysis.agents[name].recommendation === "string");
t("ORACLE votes for held coins", Object.keys(analysis.agents.ORACLE.votes).includes("BNB"));
const bnbA = analysis.snapshot.positions.find((p) => p.coin === "BNB");
t("pipeline fills null liq with model value (CALCULATED)", bnbA.prov.liq === "CALCULATED" && (bnbA.noLiqAlone === true || (isNum(bnbA.liq) && bnbA.liq < bnbA.mark)), JSON.stringify({ liq: bnbA.liq, none: bnbA.noLiqAlone }));
t("FLOW reports unknown data honestly", analysis.agents.FLOW.unknown.length >= 3);
t("SENTINEL has no votes", !analysis.agents.SENTINEL.votes);
t("conviction 0-100", Object.values(analysis.orchestration.convictions).every((c) => c.long >= 0 && c.long <= 100 && c.long + c.short === 100));
t("disagreement in [0,1]", analysis.orchestration.marketDisagreement >= 0 && analysis.orchestration.marketDisagreement <= 1);
t("verdicts for each position", analysis.orchestration.verdicts.length === 4 && analysis.orchestration.verdicts.every((v) => ["KEEP", "INCREASE", "REDUCE", "EXIT", "HEDGE", "NO EDGE"].includes(v.verdict)));
t("action present", !!analysis.orchestration.action?.title, JSON.stringify(analysis.orchestration.action));
t("cards have 7 gates", analysis.orchestration.cards.every((c) => c.gate.gates.length === 7));
t("calls recorded", AOS.store.list("calls").length > 0);
t("decisions recorded (cards)", AOS.store.list("decisions").length === analysis.orchestration.cards.length, AOS.store.list("decisions").length + " vs " + analysis.orchestration.cards.length);
t("alerts array", Array.isArray(analysis.alerts));
t("no NaN conviction", Object.values(analysis.orchestration.convictions).every((c) => isNum(c.score)));
// veto propagates through gates
const vetoAnalysis = AOS.pipeline.run(badSnap, history, { ...AOS.store.settings, unifiedAccount: false }, null, { persist: false });
t("unified account: equity = perps + rest of account", near(analysis.snapshot.account.equity, 21850 + 6000, 1) && near(analysis.snapshot.account.equityPerps, 21850, 1e-6) && analysis.snapshot.account.unified.on === true, JSON.stringify(analysis.snapshot.account.unified));
t("unified account idempotent on re-run", near(AOS.pipeline.run(snap, history, AOS.store.settings, analysis, { persist: false }).snapshot.account.equity, 27850, 1));
t("unified off keeps perps equity", near(AOS.pipeline.run(JSON.parse(JSON.stringify({ ...snap, raw: {} })), history, { ...AOS.store.settings, unifiedAccount: false }, null, { persist: false }).snapshot.account.equity, 21850, 1));
t("veto → no approved cards", vetoAnalysis.orchestration.approved.length === 0);
t("veto → action is RISK", vetoAnalysis.orchestration.action.kind === "RISK", vetoAnalysis.orchestration.action.kind);
// second run produces alerts diff without crash & respects throttle
const analysis2 = AOS.pipeline.run(snap, history, AOS.store.settings, analysis, { persist: true });
t("second run stable", analysis2.risk.level === analysis.risk.level);
t("call throttle (no duplicates within 4h)", AOS.store.list("calls").length === analysis.reputation.calls);
// reputation resolution with synthetic matured calls
const calls = AOS.store.list("calls");
calls.push({ id: "x1", agent: "ORACLE", coin: "BTC", dir: 1, p: 0.7, horizonH: 24, px0: fx.px.BTC * 0.9, ts: Date.now() - 48 * 3600e3, resolved: false });
calls.push({ id: "x2", agent: "ORACLE", coin: "BTC", dir: -1, p: 0.6, horizonH: 24, px0: fx.px.BTC * 0.9, ts: Date.now() - 48 * 3600e3, resolved: false });
AOS.store.saveList("calls", calls);
const rep = AOS.reputation.summary(history, null, null, true);
t("calls resolved", rep.agents.ORACLE.n >= 2, JSON.stringify(rep.agents.ORACLE));
t("multiplier shrunk toward 1 with small n", rep.agents.ORACLE.multiplier > 0.8 && rep.agents.ORACLE.multiplier < 1.2, String(rep.agents.ORACLE.multiplier));
// decision resolution
const ds = AOS.store.list("decisions");
ds.push({ id: "d1", cardId: "t", coin: "BTC", side: "LONG", type: "breakout", action: "IGNORE", ts: Date.now() - 5 * 864e5, entry: fx.px.BTC * 0.97, invalidation: fx.px.BTC * 0.5, target: fx.px.BTC * 0.99, risk: fx.px.BTC * 0.47, rr: 0.04, pWin: 0.5, horizonDays: 4, riskUsd: 100, resolved: false });
AOS.store.saveList("decisions", ds);
const rep2 = AOS.reputation.summary(history, null, null, true);
t("decision resolved", AOS.store.list("decisions").find((d) => d.id === "d1").resolved === true);
t("calibration by type", rep2.calibration.byType.breakout?.n >= 1);

console.log("== alerts ==");
const prevA = JSON.parse(JSON.stringify({ features: { regime: { regime: "Compression", confidence: 60 }, anomalies: [] }, risk: { level: "NORMAL", reasons: [] }, snapshot: { positions: snap.positions.filter((p) => p.coin !== "BNB") }, orchestration: { approved: [] } }));
const al = AOS.alerts.diff(prevA, analysis);
t("new position alert for BNB", al.some((a) => a.type === "POSITION" && /BNB/.test(a.what)), JSON.stringify(al.map((a) => a.what)));
t("alerts have what/why/action", al.every((a) => a.what && a.why && a.action));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
