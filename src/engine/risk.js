/* Personal Alpha OS — Risk engine (SENTINEL core). Cross-margin liquidation model, stress tests, survival map,
   liquidation gravity, risk levels, position-to-reduce-first, dynamic risk budget.
   Model: Hyperliquid cross account is liquidated when accountValue < Σ maintenance margin.
   maintenance rate per asset = 0.5 / maxLeverage (CALCULATED), calibrated against the LIVE crossMaintenanceMarginUsed. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, clamp, stats } = AOS.util;

  const LEVELS = ["NORMAL", "WATCH", "STRESSED", "DANGER", "CRITICAL"];
  const levelFromBuffer = (br) => (!isNum(br) ? "UNKNOWN" : br >= 0.25 ? "NORMAL" : br >= 0.15 ? "WATCH" : br >= 0.08 ? "STRESSED" : br >= 0.03 ? "DANGER" : "CRITICAL");
  const worstLevel = (...ls) => ls.filter((l) => LEVELS.includes(l)).sort((a, b) => LEVELS.indexOf(b) - LEVELS.indexOf(a))[0] || "UNKNOWN";

  /** Build the margin model from a snapshot (calibration factor vs API maintenance margin). */
  function marginModel(positions, account) {
    const cross = positions.filter((p) => p.marginMode !== "isolated");
    const estMM = stats.sum(cross.map((p) => (isNum(p.mmEstimate) ? p.mmEstimate : 0)));
    const apiMM = account?.mm;
    let scale = 1;
    if (isNum(apiMM) && apiMM > 0 && estMM > 0) scale = clamp(apiMM / estMM, 0.5, 2.5);
    return { scale, estMM, apiMM, prov: isNum(apiMM) ? "LIVE+CALCULATED" : "CALCULATED" };
  }

  /**
   * Shock the portfolio. shocks = {coin: pctMove}. Returns equity', mm', buffer ratio', per-position pnl and isolated liquidations.
   */
  function shock(positions, account, shocks, model) {
    const equity0 = account?.equity;
    let dPnl = 0, mm = 0;
    const perPos = [];
    const isolatedLiq = [];
    for (const p of positions) {
      const s = isNum(shocks[p.coin]) ? shocks[p.coin] : 0;
      const px1 = p.mark * (1 + s);
      const pnlDelta = p.szi * (px1 - p.mark);
      const notional1 = p.absSize * px1;
      const mmRate = isNum(p.mmRate) ? p.mmRate : 0.05;
      const mm1 = notional1 * mmRate * (p.marginMode === "isolated" ? 1 : model.scale);
      perPos.push({ coin: p.coin, side: p.side, px1, pnlDelta, mm1, notional1 });
      if (p.marginMode === "isolated") {
        const iso = (isNum(p.marginUsed) ? p.marginUsed : 0) + (isNum(p.upnl) ? p.upnl : 0) + pnlDelta;
        if (iso < mm1) isolatedLiq.push({ coin: p.coin, loss: -(isNum(p.marginUsed) ? p.marginUsed : 0) });
        continue;
      }
      dPnl += pnlDelta; mm += mm1;
    }
    const equity1 = isNum(equity0) ? equity0 + dPnl : NaN;
    const bufferRatio = isNum(equity1) && equity1 > 0 ? (equity1 - mm) / equity1 : isNum(equity1) ? -1 : NaN;
    const liquidated = isNum(equity1) && equity1 <= mm;
    const r = { equity1, mm1: mm, dPnl, bufferRatio, liquidated, perPos, isolatedLiq, capitalToSurvive: liquidated ? mm * 1.1 - equity1 : Math.max(0, mm * 1.1 - equity1) };
    // level = worst of the margin view (buffer) and the trader's view (loss of equity)
    r.level = liquidated ? "CRITICAL" : worstLevel(levelFromBuffer(bufferRatio), levelFromLoss(r, equity0));
    return r;
  }

  /** Propagate a BTC shock to other assets: "beta" (normal corr, via beta) or "stress" (corr → 1, via vol ratio, floor at BTC move). */
  function propagate(btcMove, positions, features, mode) {
    const out = {};
    const volB = features?.byCoin?.BTC?.vol;
    for (const p of positions) {
      if (p.coin === "BTC") { out.BTC = btcMove; continue; }
      const beta = features?.corr?.betaBTC?.[p.coin];
      const vol = features?.byCoin?.[p.coin]?.vol;
      if (mode === "stress") {
        const ratio = isNum(vol) && isNum(volB) && volB > 0 ? clamp(vol / volB, 1, 3) : 1.5;
        out[p.coin] = btcMove * ratio;
      } else {
        const b = isNum(beta) ? clamp(beta, 0.3, 3) : 1.2;
        out[p.coin] = btcMove * b;
      }
    }
    return out;
  }

  function stressGrid(positions, account, features, model) {
    const rows = [];
    const add = (label, shocks, group) => {
      rows.push({ label, group, shocks, ...shock(positions, account, shocks, model) });
    };
    for (const s of [-0.05, -0.10, -0.15, -0.20, -0.30]) {
      add(`BTC ${Math.round(s * 100)}% (beta)`, propagate(s, positions, features, "beta"), "BTC");
      add(`BTC ${Math.round(s * 100)}% (corr→1)`, propagate(s, positions, features, "stress"), "BTC");
    }
    for (const s of [-0.30, -0.20, -0.10, 0.10, 0.20, 0.30]) add(`ETH ${s > 0 ? "+" : ""}${Math.round(s * 100)}% seul`, { ETH: s }, "ETH");
    const alts = positions.filter((p) => !["BTC", "ETH"].includes(p.coin)).map((p) => p.coin);
    for (const s of [-0.10, -0.20, -0.30, -0.40, -0.50]) add(`Alts/SOL ${Math.round(s * 100)}%`, Object.fromEntries(alts.map((c) => [c, s])), "ALTS");
    // simultaneous worst-case
    const combined = { BTC: -0.20, ETH: -0.25, SOL: -0.40 };
    for (const c of alts) if (c !== "SOL") combined[c] = -0.50;
    add("Choc simultané : BTC −20 / ETH −25 / SOL −40 / alts −50", combined, "COMBINED");
    const combinedUp = { BTC: 0.15, ETH: 0.25, SOL: 0.35 };
    for (const c of alts) if (c !== "SOL") combinedUp[c] = 0.4;
    add("Squeeze haussier : BTC +15 / ETH +25 / SOL +35 / alts +40", combinedUp, "COMBINED");
    return rows;
  }

  // Survival bands are defined on equity drawdown (what the trader feels), liquidation on equity ≤ maintenance margin.
  const SURVIVAL_BANDS = [["WATCH", -0.10], ["STRESSED", -0.25], ["DANGER", -0.50], ["CRITICAL", -0.75], ["LIQUIDATION", null]];
  const metric = (r, equity0, target) => (target === null ? (r.liquidated ? -1 : 1) : isNum(r.equity1) && isNum(equity0) && equity0 > 0 ? r.equity1 / equity0 - 1 - target : NaN);

  /** Solve the BTC move (in the hurting direction) at which the equity drawdown reaches `target` (or liquidation when null). */
  function solveBtcMove(positions, account, features, model, target, mode) {
    const equity0 = account?.equity;
    const probeDown = shock(positions, account, propagate(-0.05, positions, features, mode), model).equity1;
    const probeUp = shock(positions, account, propagate(0.05, positions, features, mode), model).equity1;
    const dir = probeDown <= probeUp ? -1 : 1;
    let lo = 0, hi = 0.97;
    const f = (m) => metric(shock(positions, account, propagate(dir * m, positions, features, mode), model), equity0, target);
    if (!isNum(f(0))) return { move: NaN, dir };
    if (f(0) <= 0) return { move: 0, dir };
    if (f(hi) > 0) return { move: NaN, dir };
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
    return { move: dir * hi, dir };
  }

  function survivalMap(positions, account, features, model) {
    const btcPx = features?.byCoin?.BTC?.price ?? positions.find((p) => p.coin === "BTC")?.mark;
    const bands = (mode) => SURVIVAL_BANDS.map(([label, t]) => { const r = solveBtcMove(positions, account, features, model, t, mode); return { label, threshold: t, move: r.move, dir: r.dir, btcPx: isNum(btcPx) && isNum(r.move) ? btcPx * (1 + r.move) : NaN }; });
    const beta = bands("beta"), stress = bands("stress");
    const equity0 = account?.equity;
    // single-asset maps for each held asset (only that asset moves)
    const perAsset = positions.map((p) => {
      const rows = SURVIVAL_BANDS.map(([label, t]) => {
        const dir = p.side === "LONG" ? -1 : 1;
        let lo = 0, hi = 0.97;
        const f = (m) => metric(shock(positions, account, { [p.coin]: dir * m }, model), equity0, t);
        if (!isNum(f(0)) || f(0) <= 0) return { label, threshold: t, move: 0, px: p.mark };
        if (f(hi) > 0) return { label, threshold: t, move: NaN, px: NaN };
        for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
        return { label, threshold: t, move: dir * hi, px: p.mark * (1 + dir * hi) };
      });
      return { coin: p.coin, side: p.side, rows };
    });
    return { btcPx, beta, stress, perAsset, bands: SURVIVAL_BANDS, prov: "CALCULATED" };
  }

  /** Level implied by a stress loss as a fraction of equity. */
  const levelFromLoss = (r, equity0) => (!r || !isNum(r.equity1) || !isNum(equity0) || equity0 <= 0 ? "UNKNOWN" : r.liquidated ? "CRITICAL" : (() => { const l = 1 - r.equity1 / equity0; return l > 0.5 ? "DANGER" : l > 0.3 ? "STRESSED" : l > 0.15 ? "WATCH" : "NORMAL"; })());

  function gravity(positions, account, features, portfolio) {
    const equity = account?.equity;
    const volB = features?.byCoin?.BTC?.vol || 0.6;
    const cc = features?.corr?.coins || [];
    const rows = positions.map((p) => {
      const size = isNum(equity) && equity > 0 ? p.notional / equity : 0;
      const lev = isNum(p.leverage) ? p.leverage : 1;
      const vol = features?.byCoin?.[p.coin]?.vol;
      const volR = isNum(vol) ? clamp(vol / volB, 0.5, 4) : 1.5;
      // average correlation with the other positions (same-direction risk)
      const i = cc.indexOf(p.coin);
      const others = positions.filter((q) => q.coin !== p.coin);
      const corrs = others.map((q) => { const j = cc.indexOf(q.coin); const rho = i >= 0 && j >= 0 ? features.corr.normal[i][j] : NaN; return isNum(rho) ? rho * (q.side === p.side ? 1 : -1) : 0; });
      const corrFactor = 1 + Math.max(0, stats.mean(corrs) || 0);
      const dist = isNum(p.liqDist) ? Math.max(p.liqDist, 0.03) : 0.5;
      const mass = size * Math.sqrt(lev) * volR * corrFactor / dist;
      return { coin: p.coin, side: p.side, mass, size, lev, volR, corrFactor, liqDist: p.liqDist, notional: p.notional };
    });
    const total = stats.sum(rows.map((r) => r.mass)) || 1;
    for (const r of rows) r.share = r.mass / total;
    return rows.sort((a, b) => b.mass - a.mass);
  }

  /** Which position to reduce first: greatest improvement of the combined stress buffer per $ of notional removed. */
  function reduceFirst(positions, account, features, model, combinedRow) {
    const base = combinedRow?.bufferRatio;
    const rows = positions.map((p) => {
      const rest = positions.filter((q) => q !== p);
      // closing p realises its upnl into equity (already in accountValue), so equity is unchanged
      const r = shock(rest, account, combinedRow?.shocks || {}, model);
      const dBuffer = isNum(base) && isNum(r.bufferRatio) ? r.bufferRatio - base : NaN;
      const dLoss = isNum(combinedRow?.dPnl) ? r.dPnl - combinedRow.dPnl : NaN; // positive = less loss
      return { coin: p.coin, side: p.side, dBuffer, stressLossAvoided: dLoss, perNotional: isNum(dLoss) && p.notional > 0 ? dLoss / p.notional : NaN, survivesAfter: !r.liquidated };
    });
    return rows.sort((a, b) => (b.dBuffer || -1) - (a.dBuffer || -1));
  }

  /** Dynamic risk budget (fraction of trading capital at risk per trade). */
  function riskBudget(settings, ctx) {
    const base = settings.baseRiskPerTrade || 0.01, cap = settings.maxRiskPerTrade || 0.02;
    const factors = [];
    const push = (name, f, why) => factors.push({ name, factor: f, why });
    const dd = ctx.drawdown30d;
    if (isNum(dd)) push("Drawdown 30j", dd < -0.2 ? 0.3 : dd < -0.1 ? 0.5 : dd < -0.05 ? 0.7 : 1, `${(dd * 100).toFixed(1)}%`);
    const vr = ctx.volRatio;
    if (isNum(vr)) push("Vol 7j/30j", vr > 1.5 ? 0.6 : vr > 1.2 ? 0.8 : vr < 0.8 ? 1.1 : 1, vr.toFixed(2) + "×");
    const ac = ctx.avgCorr;
    if (isNum(ac)) push("Corrélation moyenne", ac > 0.85 ? 0.7 : ac > 0.7 ? 0.85 : 1, ac.toFixed(2));
    const di = ctx.disagreement;
    if (isNum(di)) push("Désaccord des agents", di > 0.6 ? 0.6 : di > 0.35 ? 0.8 : 1, Math.round(di * 100) + "%");
    push("Niveau de risque", { NORMAL: 1, WATCH: 0.8, STRESSED: 0.5, DANGER: 0.25, CRITICAL: 0 }[ctx.level] ?? 0.5, ctx.level || "—");
    if (isNum(ctx.edgeScore)) push("Edge / confiance", ctx.edgeScore > 0.7 ? 1.3 : ctx.edgeScore > 0.5 ? 1.1 : 1, Math.round(ctx.edgeScore * 100) + "%");
    const mult = factors.reduce((m, f) => m * f.factor, 1);
    return { base, cap, multiplier: mult, riskPerTrade: clamp(base * mult, 0, cap), factors };
  }

  /** Full SENTINEL evaluation. */
  function evaluate(snapshot, features, portfolio, settings = {}) {
    const positions = snapshot?.positions || [];
    const account = snapshot?.account || {};
    const model = marginModel(positions, account);
    const grid = stressGrid(positions, account, features, model);
    const combined = grid.find((r) => r.group === "COMBINED");
    const btc20 = grid.find((r) => r.label.startsWith("BTC -20% (corr"));
    const worstLiq = positions.filter((p) => isNum(p.liqDist)).sort((a, b) => a.liqDist - b.liqDist)[0] || null;
    const bufferLevel = levelFromBuffer(account.bufferRatio);
    const liqLevel = !worstLiq ? (positions.length ? "UNKNOWN" : "NORMAL") : worstLiq.liqDist < 0.05 ? "CRITICAL" : worstLiq.liqDist < 0.10 ? "DANGER" : worstLiq.liqDist < 0.15 ? "STRESSED" : worstLiq.liqDist < 0.25 ? "WATCH" : "NORMAL";
    // stress level: loss of equity under BTC −20% (corr→1); the simultaneous shock only escalates when it liquidates
    const stressLevel = worstLevel(levelFromLoss(btc20, account.equity), combined?.liquidated ? "DANGER" : "NORMAL");
    const combinedLevel = levelFromLoss(combined, account.equity);
    const levLevel = !isNum(portfolio?.grossLev) ? "UNKNOWN" : portfolio.grossLev > 8 ? "DANGER" : portfolio.grossLev > 5 ? "STRESSED" : portfolio.grossLev > 3 ? "WATCH" : "NORMAL";
    const level = positions.length ? worstLevel(bufferLevel, liqLevel, stressLevel, levLevel) : "NORMAL";
    const reasons = [];
    if (bufferLevel !== "NORMAL") reasons.push(`Buffer (equity − MM) / equity = ${(account.bufferRatio * 100).toFixed(1)}% → ${bufferLevel}`);
    if (worstLiq && liqLevel !== "NORMAL") reasons.push(`${worstLiq.coin} ${worstLiq.side} à ${(worstLiq.liqDist * 100).toFixed(1)}% de sa liquidation → ${liqLevel}`);
    if (btc20 && stressLevel !== "NORMAL") reasons.push(`BTC −20% (corr→1) ${btc20.liquidated ? "LIQUIDE le compte" : `coûterait ${(100 * (1 - btc20.equity1 / account.equity)).toFixed(0)}% de l'equity (${AOS.util.fmt.usdSigned(btc20.dPnl)})`}`);
    if (combined?.liquidated) reasons.push("Le choc simultané (BTC −20 / ETH −25 / SOL −40 / alts −50) liquide le compte");
    if (levLevel !== "NORMAL" && levLevel !== "UNKNOWN") reasons.push(`Levier brut ${portfolio.grossLev.toFixed(1)}× → ${levLevel}`);
    if (!reasons.length) reasons.push("Buffer, distance de liquidation, stress −20% et levier dans les bornes normales.");
    const map = survivalMap(positions, account, features, model);
    const grav = gravity(positions, account, features, portfolio);
    const reduce = reduceFirst(positions, account, features, model, combined);
    const fundingPerDay = stats.sum(positions.map((p) => (isNum(p.fundingPerDay) ? p.fundingPerDay : 0)));
    const dd30 = features?.portfolioDrawdown30d;
    const budget = riskBudget(settings.risk || {}, { drawdown30d: dd30, volRatio: features?.regime?.volRatio, avgCorr: features?.corr?.avgCorr, level, disagreement: NaN });
    // veto policy: any risk-increasing trade is vetoed at DANGER/CRITICAL, or when the combined stress liquidates
    const veto = level === "DANGER" || level === "CRITICAL" || !!combined?.liquidated;
    const vetoReason = veto ? (combined?.liquidated ? "Le choc simultané liquide le compte : aucune augmentation de risque tant que ce scénario n'est pas survivable." : `Niveau ${level} : aucune augmentation de risque autorisée.`) : null;
    return {
      level, reasons, model, grid, combined, btc20, worstLiq, survival: map, gravity: grav, reduceFirst: reduce, fundingPerDay,
      fundingPerMonth: fundingPerDay * 30, fundingAnnualPct: isNum(account.equity) && account.equity > 0 ? (fundingPerDay * 365) / account.equity : NaN,
      budget, veto, vetoReason, levels: { buffer: bufferLevel, liquidation: liqLevel, stress: stressLevel, leverage: levLevel, combined: combinedLevel },
      btc20LossPct: btc20 && isNum(account.equity) && account.equity > 0 ? 1 - btc20.equity1 / account.equity : NaN,
      combinedLossPct: combined && isNum(account.equity) && account.equity > 0 ? 1 - combined.equity1 / account.equity : NaN,
      survivalCombined: combined ? !combined.liquidated : null, marginAfterShock: combined?.bufferRatio, estimatedLossCombined: combined?.dPnl, capitalToSurvive: combined?.capitalToSurvive,
      prov: "CALCULATED",
    };
  }

  AOS.risk = { LEVELS, SURVIVAL_BANDS, levelFromBuffer, levelFromLoss, worstLevel, marginModel, shock, propagate, stressGrid, solveBtcMove, survivalMap, gravity, reduceFirst, riskBudget, evaluate };
})(typeof window !== "undefined" ? window : globalThis);
