/* SEAT 06 — ARCHIVE · Learning / Post-Trade Intelligence. Votes from the trader's own realised history (by asset & side)
   and reports calibration, edge decay and agent reputations. Says UNKNOWN when the sample is too small. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, fmt } = AOS.util;

  function run(ctx, reputation) {
    const { alpha, snapshot } = ctx;
    const st = alpha?.stats;
    const votes = {};
    const coins = new Set(["BTC", "ETH", "SOL", ...(snapshot?.positions || []).map((p) => p.coin)]);
    for (const c of coins) {
      const rows = (alpha?.closed || []).filter((t) => t.coin === c);
      const longs = rows.filter((t) => t.side === "LONG"), shorts = rows.filter((t) => t.side === "SHORT");
      const exp = (arr) => (arr.length >= 5 ? arr.reduce((s, t) => s + t.net, 0) / arr.length : NaN);
      const eL = exp(longs), eS = exp(shorts);
      let dir = 0; const reasons = [];
      if (isNum(eL)) { dir += clamp(eL / 200, -0.5, 0.5); reasons.push(`Tes longs ${c} : ${longs.length} trades, espérance ${fmt.usdSigned(eL)}`); }
      if (isNum(eS)) { dir -= clamp(eS / 200, -0.5, 0.5); reasons.push(`Tes shorts ${c} : ${shorts.length} trades, espérance ${fmt.usdSigned(eS)}`); }
      if (!reasons.length) reasons.push(`Historique insuffisant sur ${c} (< 5 trades par sens) → pas d'avis`);
      votes[c] = { dir: clamp(dir, -1, 1), confidence: reasons.length && (isNum(eL) || isNum(eS)) ? clamp(rows.length / 30, 0.1, 0.7) : 0.05, reasons, prov: rows.length >= 5 ? "HISTORICAL" : "UNKNOWN" };
    }
    const m = alpha?.windows?.month;
    return {
      agent: "ARCHIVE", seat: "06", role: "Learning / Post-Trade", timestamp: new Date().toISOString(),
      direction: "neutral", confidence: st?.n >= 20 ? 0.5 : 0.2, expected_return: isNum(st?.expectancy) && isNum(snapshot?.account?.equity) ? st.expectancy / snapshot.account.equity : NaN, expected_loss: isNum(st?.avgLoss) && isNum(snapshot?.account?.equity) ? st.avgLoss / snapshot.account.equity : NaN, time_horizon: "history",
      signals: [
        st?.n ? `${st.n} trades clos · win rate ${fmt.pct(st.winRate, 0)} · profit factor ${isNum(st.profitFactor) ? st.profitFactor.toFixed(2) : "—"} · espérance ${fmt.usdSigned(st.expectancy)}` : "Aucun trade clos reconstruit (fills indisponibles ou compte neuf)",
        m ? `30j : ${fmt.pct(m.ret, 1, true)} vs BTC ${fmt.pct(m.btc, 1, true)} → alpha ${fmt.pct(m.alphaBTC, 1, true)} (${m.prov})` : "Fenêtre 30j indisponible",
        `Funding 90j net ${fmt.usdSigned(alpha?.fundingNet)} · frais 90j ${fmt.usd(alpha?.leakage?.fees90d)}`,
      ],
      risks: (alpha?.patterns || []).slice(0, 3), invalidation: ["Les statistiques < 20 trades ne sont pas significatives"],
      recommendation: st?.n >= 20 && st.expectancy < 0 ? "REDUCE ACTIVITY (espérance négative)" : "CONTINUE MEASURING",
      position_size_modifier: st?.n >= 20 ? clamp(0.7 + (st.winRate - 0.4), 0.5, 1.1) : 0.9,
      votes, reputation: reputation || null, calibration: reputation?.calibration || null, edgeDecay: reputation?.edgeDecay || null, uncertainty: st?.uncertainty || "HIGH", prov: alpha?.prov || "UNKNOWN",
    };
  }
  AOS.agents = AOS.agents || {};
  AOS.agents.ARCHIVE = { run };
})(typeof window !== "undefined" ? window : globalThis);
