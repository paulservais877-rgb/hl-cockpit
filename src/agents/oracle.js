/* SEAT 01 — ORACLE · Market Regime Agent (rule-based, transparent). Structured JSON output. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp } = AOS.util;

  function run(ctx) {
    const { features, snapshot } = ctx;
    const reg = features?.regime || {};
    const btc = features?.byCoin?.BTC;
    const votes = {};
    const coins = new Set(["BTC", "ETH", "SOL", ...(snapshot?.positions || []).map((p) => p.coin)]);
    for (const c of coins) {
      const f = features?.byCoin?.[c];
      if (!f?.d1) { votes[c] = { dir: 0, confidence: 0, reasons: ["Historique 1d indisponible"], prov: "UNKNOWN" }; continue; }
      const d = f.d1;
      let dir = clamp(d.trendScore / 3, -1, 1) * 0.6; // trend structure
      dir += clamp(d.ret20d / 0.15, -1, 1) * 0.25; // momentum
      dir += isNum(d.macdHist) && isNum(d.atr) && d.atr > 0 ? clamp(d.macdHist / d.atr, -1, 1) * 0.15 : 0;
      // RSI extremes reduce conviction in the trend direction (exhaustion risk)
      if (isNum(d.rsi) && ((d.rsi > 75 && dir > 0) || (d.rsi < 25 && dir < 0))) dir *= 0.5;
      // regime overlay
      if (reg.bias === "BEAR" && dir > 0) dir *= 0.6;
      if (reg.bias === "BULL" && dir < 0) dir *= 0.6;
      const confidence = clamp(Math.abs(dir) * (0.5 + (reg.confidence || 0) / 200), 0.05, 0.9);
      const reasons = [
        `${c} ${f.price > d.ema50 ? ">" : "<"} EMA50, ${f.price > d.ema200 ? ">" : "<"} EMA200 (score tendance ${d.trendScore})`,
        `Momentum 20j ${(d.ret20d * 100).toFixed(1)}%, RSI ${isNum(d.rsi) ? d.rsi.toFixed(0) : "—"}`,
        `Régime BTC : ${reg.regime} (${reg.confidence}%)`,
      ];
      votes[c] = { dir: clamp(dir, -1, 1), confidence, reasons, prov: "CALCULATED" };
    }
    const mdir = votes.BTC?.dir || 0;
    const expVol = btc?.d1?.vol30;
    const horizonDays = 7;
    const expectedReturn = isNum(expVol) ? mdir * expVol * Math.sqrt(horizonDays / 365) * 0.5 : NaN; // conservative: half a σ in the direction of the bias
    const expectedLoss = isNum(expVol) ? -expVol * Math.sqrt(horizonDays / 365) : NaN;
    return {
      agent: "ORACLE", seat: "01", role: "Market Regime", timestamp: new Date().toISOString(),
      direction: reg.bias === "BULL" ? "bullish" : reg.bias === "BEAR" ? "bearish" : "neutral",
      confidence: (reg.confidence || 0) / 100, expected_return: expectedReturn, expected_loss: expectedLoss, time_horizon: horizonDays + "d",
      signals: reg.drivers || [], risks: [`Probabilité de changement de régime ${reg.changeProbability ?? "—"}%`, `Volatilité attendue ${reg.expectedVol || "—"}`],
      invalidation: reg.invalidation || [], recommendation: reg.bias === "BULL" ? "LONG BIAS" : reg.bias === "BEAR" ? "SHORT BIAS / REDUCE" : "NEUTRAL",
      position_size_modifier: reg.expectedVol === "HIGH" ? 0.6 : reg.expectedVol === "LOW" ? 1.0 : 0.85,
      regime: reg, temperature: features?.temperature, votes, uncertainty: reg.uncertainty || "HIGH", prov: reg.prov || "UNKNOWN",
    };
  }
  AOS.agents = AOS.agents || {};
  AOS.agents.ORACLE = { run };
})(typeof window !== "undefined" ? window : globalThis);
