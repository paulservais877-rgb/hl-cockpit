/* Personal Alpha OS — intelligence views: council, decision cards, probability cone, ARCHIVE, alerts, settings */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, fmt, clamp, stats } = AOS.util;
  const D = AOS.dom;
  const { html, raw, set, $, usd, usdS, pct, px, tag, prov, lvlTag, sideTag, kv, why, list, json, esc } = D;
  const V = {};

  // ---- COUNCIL -------------------------------------------------------------------------------
  V.council = function (a) {
    const ag = a.agents, o = a.orchestration, rep = a.reputation;
    const order = ["ORACLE", "FLOW", "EDGE", "ALLOCATOR", "SENTINEL", "ARCHIVE"];
    const dirTag = (d) => tag(String(d).toUpperCase(), d === "bullish" ? "long" : d === "bearish" ? "short" : "");
    set($("#council-body"), html`
      <div class="agents">${raw(order.map((n) => { const x = ag[n]; const r = rep.agents[n]; return html`<div class="card agent"><div class="seat">SEAT ${x.seat} · ${x.role}</div><div class="name">${n} ${x.veto ? tag("VETO", "crit") : ""}</div>
        <div class="rec">${n === "SENTINEL" ? lvlTag(x.level) : dirTag(x.direction)} <span class="dimc">conf ${Math.round(x.confidence * 100)}% · horizon ${x.time_horizon} · taille ×${isNum(x.position_size_modifier) ? x.position_size_modifier.toFixed(2) : "—"}</span></div>
        <div style="margin-top:6px;font-weight:600">${x.recommendation}</div>
        ${list(x.signals.slice(0, 3))}
        ${x.risks?.length ? html`<div class="hint" style="margin-top:6px">Risques</div>${list(x.risks.slice(0, 2))}` : ""}
        <div class="hint" style="margin-top:6px">Réputation : ${r.n} calls résolus${r.n ? ` · précision ${fmt.pct(r.accuracy, 0)} · Brier ${r.brier.toFixed(2)} · poids ×${r.multiplier.toFixed(2)}` : " · poids ×1.00 (a priori)"} ${prov(x.prov)}</div>
        ${why("Structured output (JSON)", json({ ...x, votes: undefined, heatmap: undefined, oiStress: undefined, opportunities: x.opportunities?.map((q) => q.id), rejected: x.rejected?.map((q) => q.id), reviews: x.reviews?.map((q) => q.id), reputation: undefined, calibration: undefined, edgeDecay: undefined, regime: undefined, temperature: undefined }))}
      </div>`.s; }).join(""))}</div>
      <div class="grid c2" style="margin-top:12px">
        <div class="card"><h3>Conviction par actif <span class="tag">DI marché ${fmt.pct(o.marketDisagreement, 0)}</span></h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Actif</th><th class="r">Long</th><th class="r">Short</th><th class="r">Désaccord</th><th>Votes (dir·conf·poids)</th></tr></thead><tbody>
          ${raw(Object.values(o.convictions).map((c) => `<tr><td class="t"><b>${esc(c.coin)}</b></td><td class="r ${c.long >= 60 ? "pos" : ""}">${c.long}</td><td class="r ${c.short >= 60 ? "neg" : ""}">${c.short}</td><td class="r ${c.disagreement > 0.5 ? "warnc" : ""}">${Math.round(c.disagreement * 100)}%</td><td class="t" style="white-space:normal;font-size:11px">${c.parts.map((p) => `<span class="tag ${p.dir > 0.15 ? "long" : p.dir < -0.15 ? "short" : ""}">${esc(p.agent)} ${p.dir > 0 ? "+" : ""}${p.dir.toFixed(2)}·${Math.round(p.confidence * 100)}%·${(p.weight * 100).toFixed(0)}</span>`).join(" ")}</td></tr>`).join(""))}
          </tbody></table></div>
          <div class="hint">Score = Σ poids × réputation × direction × confiance. Poids de base : Market/Quant 40% (ORACLE 20 + EDGE 20), Flow 35%, Contexte 25% (ALLOCATOR 15 + ARCHIVE 10). SENTINEL ne vote pas : il oppose son veto.</div>
        </div>
        <div class="card"><h3>Agent scoreboard ${prov("HISTORICAL")}</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Agent</th><th class="r">Calls</th><th class="r">Précision</th><th class="r">Récent (20)</th><th class="r">Brier</th><th class="r">Faux pos.</th><th class="r">Poids eff.</th></tr></thead><tbody>
          ${raw(order.filter((n) => n !== "SENTINEL").map((n) => { const r = rep.agents[n]; return `<tr><td class="t"><b>${esc(n)}</b></td><td class="r">${r.n}<span class="dimc">${r.pending ? " +" + r.pending + " en cours" : ""}</span></td><td class="r">${esc(fmt.pct(r.accuracy, 0))}</td><td class="r">${esc(fmt.pct(r.accuracyRecent, 0))}</td><td class="r">${isNum(r.brier) ? r.brier.toFixed(3) : "—"}</td><td class="r">${r.falsePositives}</td><td class="r">${(o.effectiveWeights[n] * 100).toFixed(0)}%</td></tr>`; }).join(""))}
          <tr><td class="t"><b>SENTINEL</b></td><td class="r" colspan="5">${rep.avoided.sentinelN} vetos résolus · pertes évitées <span data-private>${esc(fmt.usd(rep.avoided.sentinelAvoided))}</span> · trades rejetés par le gate : ${a.orchestration.cards.filter((c) => c.status !== "APPROVED").length} aujourd'hui</td><td class="r">veto</td></tr>
          </tbody></table></div>
          <div class="hint">Un call = direction + probabilité, résolu à l'horizon de l'agent (ORACLE 7j, FLOW 2j, EDGE 4j) sur la clôture 1h. Le poids converge vers la performance après ~20 calls (shrinkage). Décisions IGNORE/VETO résolues : ${rep.avoided.n} · pertes évitées <span data-private>${fmt.usd(rep.avoided.lossesAvoided)}</span> · gains manqués <span data-private>${fmt.usd(rep.avoided.gainsMissed)}</span>.</div>
        </div>
      </div>`);
  };

  // ---- DECISION CARDS ----------------------------------------------------------------------------
  V.decisions = function (a) {
    const o = a.orchestration;
    if (!o.cards.length) { set($("#decisions-body"), html`<div class="card"><div class="big" style="font-size:18px">NO TRADE — PERFECT DECISION</div><div class="sub2">Aucun setup avec un edge suffisant après coûts sur ${Object.keys(a.features.byCoin).filter((c) => a.features.byCoin[c].h4).length} actifs scannés. ${a.agents.EDGE.rejected.length ? a.agents.EDGE.rejected.length + " setup(s) rejeté(s) pour EV insuffisante." : ""}</div>${why("Setups rejetés par EDGE", list(a.agents.EDGE.rejected.map((r) => `${r.coin} ${r.side} ${r.name}: ${r.rejectReason}`)))}</div>`); return; }
    set($("#decisions-body"), raw(o.cards.map((c) => {
      const st = c.status;
      const sz = c.sizing;
      return html`<div class="card decision ${st === "APPROVED" ? "lift" : ""}" data-card="${c.id}"><span class="stripe ${st === "APPROVED" ? "NORMAL" : st === "VETO" ? "CRITICAL" : "WATCH"}"></span>
        <div class="head"><span class="sym">${c.coin}</span>${sideTag(c.side)}<span class="tag">${c.name}</span>${tag(st === "APPROVED" ? "SENTINEL: APPROVED" : st === "VETO" ? "SENTINEL: VETO" : "GATE: REJECTED", st === "APPROVED" ? "ok" : st === "VETO" ? "crit" : "warn")}<span class="conv">Conviction <b>${c.conviction}</b>/100 <span class="dimc">· DI ${Math.round(c.disagreement * 100)}%</span></span></div>
        <div class="levels"><div><div class="k">Entry</div><div class="v">${px(c.entry)}</div></div><div><div class="k">Invalidation</div><div class="v neg">${px(c.invalidation)}</div></div><div><div class="k">Target</div><div class="v pos">${px(c.target)}</div></div></div>
        <div class="facts">${tag(`EV ${c.evR >= 0 ? "+" : ""}${c.evR.toFixed(2)}R`, c.evR > 0 ? "ok" : "bad")}${tag(`R/R ${c.rr.toFixed(1)}`)}${tag(`p ${Math.round(c.pRange[0] * 100)}–${Math.round(c.pRange[1] * 100)}% · ${c.uncertainty}`)}${tag(`Regime: ${c.regime}`)}${tag(`Flow: ${c.flowDir > 0.15 ? "Positive" : c.flowDir < -0.15 ? "Negative" : "Neutral"}`)}${tag(`Portfolio: ${c.portfolioImpact}`)}${tag(`Funding: ${c.fundingLabel}`)}${sz ? tag(`Size ${fmt.qty(sz.qty)} · risk ${fmt.usd(sz.riskUsd)}`, "accent") : ""}</div>
        <div class="gates">${raw(c.gate.gates.map((g) => `<span class="g ${g.pass ? "pass" : "fail"}" title="${esc(g.detail)}">${esc(g.name)} ${g.pass ? "✓" : "✕"}</span>`).join(""))}</div>
        <div class="actions"><button class="btn primary" data-act="EXECUTE" ${st !== "APPROVED" ? "disabled" : ""}>EXECUTE</button><button class="btn" data-act="SIMULATE">SIMULATE</button><button class="btn ghost" data-act="IGNORE">IGNORE</button></div>
        ${why("Why?", raw(`<b>${esc(c.why)}</b>${list(c.convictionParts.map((p) => `${p.agent} (${p.dir > 0 ? "+" : ""}${p.dir.toFixed(2)}): ${p.reasons[0] || ""}`)).s}<div class="hint" style="margin-top:8px">Invalidation : ${esc(c.invalidationWhy)} · Cible : ${esc(c.targetWhy)} · T2 ${esc(fmt.px(c.target2))} · T3 ${esc(fmt.px(c.target3))} · horizon ${c.horizonDays}j · MFE est. ${esc(fmt.px(c.mfeEst))} · MAE est. ${esc(fmt.px(c.maeEst))}</div><div class="hint">Probabilité : prior ${esc(AOS.agents.EDGE.PRIORS[c.type] * 100)}% ${esc(c.pAdjustments.join(" · "))} · EV avant coûts ${c.evRBeforeCosts.toFixed(2)}R · coûts ${c.costR.toFixed(2)}R (frais ${(c.feePct * 100).toFixed(3)}% + funding ${(c.fundingCostPct * 100).toFixed(3)}%) · poids edge-decay ×${c.decayWeight.toFixed(2)}</div>`))}
        ${why("Risk gate details", raw(`<div class="tbl-wrap"><table class="tbl"><tbody>${c.gate.gates.map((g) => `<tr><td class="t ${g.pass ? "pos" : "neg"}">${esc(g.name)}</td><td class="t" style="white-space:normal">${esc(g.detail)}</td></tr>`).join("")}</tbody></table></div>${sz ? `<div class="hint" style="margin-top:8px">Sizing : ${esc(sz.why)} · Kelly plein ${(sz.kelly.full * 100).toFixed(1)}% (jamais utilisé) · 0.10K ${esc(fmt.usd(sz.kellyRiskUsd.k10))} · 0.25K ${esc(fmt.usd(sz.kellyRiskUsd.k25))} · 0.50K ${esc(fmt.usd(sz.kellyRiskUsd.k50))} · retenu : ${esc(sz.chosen)}</div>` : ""}${c.gate.impact ? `<div class="mini" style="margin-top:8px"><div class="m"><div class="k">Δ Expected return</div><div class="v" data-private>${esc(fmt.usdSigned(c.gate.impact.deltas.expectedReturn))}</div></div><div class="m"><div class="k">Δ CVaR 95% 1j</div><div class="v" data-private>${esc(fmt.usdSigned(c.gate.impact.deltas.cvar))}</div></div><div class="m"><div class="k">Δ Liq distance</div><div class="v">${esc(fmt.pct(c.gate.impact.deltas.liqRisk, 1, true))}</div></div><div class="m"><div class="k">Δ Funding /j</div><div class="v" data-private>${esc(fmt.usdSigned(c.gate.impact.deltas.funding, 2))}</div></div><div class="m"><div class="k">Δ Corr (stress/normal)</div><div class="v">${c.gate.impact.deltas.correlation.toFixed(3)}</div></div><div class="m"><div class="k">Δ Net exposure</div><div class="v" data-private>${esc(fmt.usdSigned(c.gate.impact.deltas.netExposure))}</div></div><div class="m"><div class="k">Δ Stress loss</div><div class="v" data-private>${esc(fmt.usdSigned(c.gate.impact.deltas.stressLoss))}</div></div><div class="m"><div class="k">Niveau après</div><div class="v lvl-${esc(c.gate.impact.newLevel)}">${esc(c.gate.impact.newLevel)}</div></div></div>` : ""}`))}
        ${c.review ? why(`Red team (${c.review.redTeam.verdict}) & pre-mortem`, raw(`${list(c.review.redTeam.findings.filter((f) => f.severity > 0).map((f) => `[${f.test}] ${f.text}`)).s}<div class="hint" style="margin-top:8px"><b>Pre-mortem — si ce trade perd fort, la cause la plus probable :</b></div>${list(c.review.preMortem).s}`)) : ""}
      </div>`.s;
    }).join("")));
  };

  // ---- PROBABILITY CONE ---------------------------------------------------------------------------
  V.cone = function (a) {
    const c = a.cone;
    const body = $("#cone-body");
    if (!c.ok) { set(body, html`<div class="empty">Cône indisponible : ${c.reason}</div>`); return; }
    set(body, html`<div class="card"><h3>Distribution de l'equity ${prov(c.prov)} <span class="tag">${c.paths} chemins</span></h3>
      <canvas id="cone-canvas" class="chart" width="800" height="300"></canvas>
      <div class="legend"><span><i style="background:rgba(200,178,131,.18)"></i>P10–P90</span><span><i style="background:rgba(200,178,131,.4)"></i>P25–P75</span><span><i style="background:#c8b283"></i>P50</span><span><i style="background:#ff3d5a"></i>liquidation (equity ≤ MM)</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Horizon</th><th class="r">P10</th><th class="r">P25</th><th class="r">P50</th><th class="r">P75</th><th class="r">P90</th><th class="r">P(perte)</th><th class="r">P(liquidation)</th></tr></thead><tbody>
      ${raw(c.horizons.map((h) => `<tr><td class="t">${h.horizon}j</td><td class="r neg" data-private>${esc(fmt.usd(h.p10))}</td><td class="r" data-private>${esc(fmt.usd(h.p25))}</td><td class="r" data-private><b>${esc(fmt.usd(h.p50))}</b></td><td class="r" data-private>${esc(fmt.usd(h.p75))}</td><td class="r pos" data-private>${esc(fmt.usd(h.p90))}</td><td class="r">${esc(fmt.pct(h.pLoss, 0))}</td><td class="r ${h.pLiq > 0.1 ? "neg" : h.pLiq > 0.02 ? "warnc" : ""}">${esc(fmt.pct(h.pLiq, 1))}</td></tr>`).join(""))}
      </tbody></table></div>
      <div class="hint">${c.note} Le risque de ruine à 90j (P(liquidation)) suppose des positions inchangées : c'est le coût de l'inaction, pas une prévision.</div></div>`);
    const cv = $("#cone-canvas"); const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height, padL = 64, padR = 16, padT = 14, padB = 28;
    const pts = [{ horizon: 0, p10: c.equity0, p25: c.equity0, p50: c.equity0, p75: c.equity0, p90: c.equity0 }, ...c.horizons];
    const maxH = Math.max(...c.horizons.map((h) => h.horizon));
    const lo = Math.min(...pts.map((p) => p.p10)) * 0.95, hi = Math.max(...pts.map((p) => p.p90)) * 1.03;
    const X = (h) => padL + (Math.sqrt(h / maxH)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(196,208,232,.1)"; ctx.fillStyle = "#8b93a7"; ctx.font = "11px JetBrains Mono, monospace"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(W - padR, Y(v)); ctx.stroke(); ctx.fillText(document.body.classList.contains("privacy") ? "•••" : fmt.usd(v), padL - 6, Y(v) + 4); }
    ctx.textAlign = "center"; for (const h of c.horizons) ctx.fillText(h.horizon + "j", X(h.horizon), H - 8);
    const band = (kLo, kHi, col) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.horizon), Y(p[kLo])) : ctx.moveTo(X(p.horizon), Y(p[kLo])))); [...pts].reverse().forEach((p) => ctx.lineTo(X(p.horizon), Y(p[kHi]))); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
    band("p10", "p90", "rgba(200,178,131,.16)"); band("p25", "p75", "rgba(200,178,131,.3)");
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.horizon), Y(p.p50)) : ctx.moveTo(X(p.horizon), Y(p.p50)))); ctx.strokeStyle = "#c8b283"; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(padL, Y(c.equity0)); ctx.lineTo(W - padR, Y(c.equity0)); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    const mm = a.snapshot.account.mm; if (isNum(mm) && mm > lo) { ctx.beginPath(); ctx.moveTo(padL, Y(mm)); ctx.lineTo(W - padR, Y(mm)); ctx.strokeStyle = "rgba(255,61,90,.7)"; ctx.stroke(); }
  };

  // ---- ARCHIVE --------------------------------------------------------------------------------
  V.archive = function (a) {
    const al = a.alpha, st = al.stats, rep = a.reputation, w = al.windows;
    const journal = AOS.store.list("journal");
    const winRow = (k, label) => { const x = w[k]; if (!x || !isNum(x.ret)) return `<tr><td class="t">${esc(label)}</td><td colspan="8" class="t dimc">indisponible</td></tr>`; return `<tr><td class="t">${esc(label)} <span class="dimc">${x.days}j</span></td><td class="r ${x.ret >= 0 ? "pos" : "neg"}">${esc(fmt.pct(x.ret, 1, true))}</td><td class="r">${esc(fmt.pct(x.btc, 1, true))}</td><td class="r">${esc(fmt.pct(x.eth, 1, true))}</td><td class="r">${esc(fmt.pct(x.mix, 1, true))}</td><td class="r ${x.alphaBTC >= 0 ? "pos" : "neg"}"><b>${esc(fmt.pct(x.alphaBTC, 1, true))}</b></td><td class="r">${esc(fmt.pct(x.alphaBTCBeforeCosts, 1, true))}</td><td class="r">${esc(fmt.pct(x.mdd.mdd, 1))}</td><td class="r">${isNum(x.sharpe) ? x.sharpe.toFixed(2) : "—"} / ${isNum(x.sortino) ? x.sortino.toFixed(2) : "—"}</td></tr>`; };
    set($("#archive-body"), html`
      <div class="mini">
        <div class="m"><div class="k">Trades clos</div><div class="v">${st.n} <small class="dimc">${st.uncertainty}</small></div></div>
        <div class="m"><div class="k">Win rate · PF</div><div class="v">${fmt.pct(st.winRate, 0)} · ${isNum(st.profitFactor) ? (st.profitFactor === Infinity ? "∞" : st.profitFactor.toFixed(2)) : "—"}</div></div>
        <div class="m"><div class="k">Espérance / trade</div><div class="v ${st.expectancy >= 0 ? "pos" : "neg"}" data-private>${fmt.usdSigned(st.expectancy)}</div></div>
        <div class="m"><div class="k">Gain moy. / perte moy.</div><div class="v" data-private>${fmt.usdSigned(st.avgWin)} / ${fmt.usdSigned(st.avgLoss)}</div></div>
        <div class="m"><div class="k">Durée moyenne</div><div class="v">${fmt.dur(st.avgHoldMs)}</div></div>
        <div class="m"><div class="k">Funding 90j net</div><div class="v ${al.fundingNet >= 0 ? "pos" : "neg"}" data-private>${fmt.usdSigned(al.fundingNet)}</div><div class="hint">payé ${fmt.usd(al.fundingPaid)} · reçu ${fmt.usd(al.fundingReceived)}</div></div>
        <div class="m"><div class="k">Frais 90j</div><div class="v neg" data-private>${fmt.usd(al.leakage.fees90d)}</div></div>
        <div class="m"><div class="k">Fee + funding leakage 90j</div><div class="v neg" data-private>${fmt.usd(al.leakage.fees90d - al.leakage.funding90d)}</div></div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Alpha attribution ${prov(w.month?.prov || "UNKNOWN")}</h3>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fenêtre</th><th class="r">Toi</th><th class="r">BTC B&H</th><th class="r">ETH B&H</th><th class="r">Mix 50/50</th><th class="r">Alpha vs BTC</th><th class="r">avant coûts</th><th class="r">Max DD</th><th class="r">Sharpe / Sortino</th></tr></thead><tbody>${raw(winRow("week", "7 jours") + winRow("month", "30 jours") + winRow("allTime", "Depuis le début"))}</tbody></table></div>
        <div class="hint">Rendement = Dietz modifié sur l'historique de valeur du compte (dépôts/retraits neutralisés via le ledger). « Ne rien faire » = 0%. Une hausse due uniquement au beta BTC n'est pas de l'alpha.</div>
        ${al.attribution ? html`<h3 style="margin-top:14px">PnL decomposition (30j) ${prov("ESTIMATED")}</h3><div class="tbl-wrap"><table class="tbl"><tbody>${raw(al.attribution.map((r) => `<tr><td class="t">${esc(r.name)}</td><td class="r ${r.value >= 0 ? "pos" : "neg"}" data-private>${esc(fmt.usdSigned(r.value))}</td><td class="t dimc">${esc(r.note)} <span class="prov">${esc(r.prov)}</span></td></tr>`).join(""))}</tbody></table></div>` : ""}
      </div>
      <div class="grid c2" style="margin-top:12px">
        <div class="card"><h3>PnL par actif · sens · régime ${prov(al.prov)}</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Clé</th><th class="r">n</th><th class="r">Win</th><th class="r">Net</th></tr></thead><tbody>${raw([...st.byAsset, ...st.bySide, ...st.byRegime.filter((r) => r.key !== "UNKNOWN")].map((r) => `<tr><td class="t">${esc(r.key)}</td><td class="r">${r.n}</td><td class="r">${esc(fmt.pct(r.winRate, 0))}</td><td class="r ${r.net >= 0 ? "pos" : "neg"}" data-private>${esc(fmt.usdSigned(r.net))}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">Aucun trade clos</td></tr>')}</tbody></table></div>
          ${al.patterns.length ? html`<div class="hint" style="margin-top:8px"><b>Patterns (n ≥ 5)</b></div>${list(al.patterns)}` : html`<div class="hint" style="margin-top:8px">Patterns : il faut ≥ 5 trades par catégorie pour une conclusion.</div>`}
        </div>
        <div class="card"><h3>Counterfactual / regret ${prov("CALCULATED")}</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Trade</th><th class="r">Réel</th><th class="r">Hold</th><th class="r">MFE</th><th class="r">MAE</th><th class="r">BTC</th></tr></thead><tbody>${raw(al.counterfactuals.slice(-12).reverse().map((c) => `<tr><td class="t">${esc(c.coin)} ${esc(c.side)} <span class="dimc">${esc(fmt.date(c.openTs))}${c.regime ? " · " + esc(c.regime) : ""}</span></td><td class="r ${c.actual >= 0 ? "pos" : "neg"}" data-private>${esc(fmt.usdSigned(c.actual))}</td><td class="r" data-private>${esc(fmt.usdSigned(c.hold))}</td><td class="r" data-private>${esc(fmt.usdSigned(c.mfe))}</td><td class="r" data-private>${esc(fmt.usdSigned(c.mae))}</td><td class="r" data-private>${esc(fmt.usdSigned(c.btc))}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Aucun trade clos dans la fenêtre 1h (30j)</td></tr>')}</tbody></table></div>
          <div class="hint">Sert à améliorer les règles, pas à regretter : MFE = meilleur gain atteint, MAE = pire excursion, BTC = même notional en BTC sur la même durée.</div>
        </div>
      </div>
      <div class="grid c2" style="margin-top:12px">
        <div class="card"><h3>Calibration · edge decay ${prov("HISTORICAL")} <span class="tag">${rep.calibration.uncertainty}</span></h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>p prédite</th><th class="r">n</th><th class="r">prédit</th><th class="r">réalisé</th></tr></thead><tbody>${raw(rep.calibration.bins.map((b) => `<tr><td class="t">${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</td><td class="r">${b.n}</td><td class="r">${esc(fmt.pct(b.predicted, 0))}</td><td class="r ${isNum(b.realized) && isNum(b.predicted) && b.realized < b.predicted - 0.1 ? "neg" : ""}">${esc(fmt.pct(b.realized, 0))}</td></tr>`).join(""))}</tbody></table></div>
          <div class="hint">Brier global ${isNum(rep.calibration.brier) ? rep.calibration.brier.toFixed(3) : "—"} sur ${rep.calibration.n} décisions résolues. Les probabilités EDGE sont recalibrées automatiquement à partir de 30 décisions par type de setup.</div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Setup</th><th class="r">n</th><th class="r">R moy 30</th><th class="r">R moy 90</th><th class="r">Poids</th></tr></thead><tbody>${raw(Object.entries(rep.edgeDecay).map(([k, v]) => `<tr><td class="t">${esc(AOS.agents.EDGE.NAMES[k] || k)} ${v.decaying ? '<span class="tag bad">DECAY</span>' : ""}</td><td class="r">${v.n}</td><td class="r">${isNum(v.rolling30) ? v.rolling30.toFixed(2) : "—"}</td><td class="r">${isNum(v.rolling90) ? v.rolling90.toFixed(2) : "—"}</td><td class="r">×${v.weight.toFixed(2)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">Aucune décision résolue</td></tr>')}</tbody></table></div>
        </div>
        <div class="card"><h3>Journal de décisions</h3>
          <div class="form c2"><div class="field"><label>Actif / contexte</label><input id="j-title" placeholder="ex: BTC long — pourquoi je garde"/></div><div class="field"><label>Type</label><select id="j-type"><option>THESE</option><option>ENTREE</option><option>SORTIE</option><option>RENFORT</option><option>HEDGE</option><option>NO TRADE</option><option>ERREUR</option></select></div></div>
          <div class="field" style="margin-top:8px"><label>Note (hypothèse, raison de sortie, ce que j'ai appris)</label><textarea id="j-note"></textarea></div>
          <div style="display:flex;gap:8px;margin-top:8px"><button class="btn primary" id="j-add" style="flex:0 0 auto;padding:0 16px">Enregistrer</button><span class="hint">Régime ${a.features.regime.regime} · niveau ${a.risk.level} enregistrés automatiquement.</span></div>
          <div style="margin-top:10px">${raw(journal.slice(-8).reverse().map((j) => `<div class="kv" style="align-items:flex-start"><span class="k" style="flex:1"><b style="color:var(--text)">${esc(j.title)}</b> <span class="tag">${esc(j.type)}</span><br/>${esc(j.note)}<br/><span class="dimc">${esc(fmt.datetime(j.ts))} · ${esc(j.regime)} · ${esc(j.level)}</span></span></div>`).join("") || '<div class="empty">Aucune note.</div>')}</div>
          ${why("Décisions résolues (dernières)", raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Card</th><th>Action</th><th class="r">p</th><th>Résultat</th><th class="r">R</th></tr></thead><tbody>${rep.decisionsList.filter((d) => d.resolved).slice(0, 15).map((d) => `<tr><td class="t">${esc(fmt.date(d.ts))}</td><td class="t">${esc(d.coin)} ${esc(d.side)} ${esc(AOS.agents.EDGE.NAMES[d.type] || d.type)}</td><td class="t">${esc(d.action)}</td><td class="r">${Math.round(d.pWin * 100)}%</td><td class="t ${/WIN/.test(d.outcome) ? "pos" : "neg"}">${esc(d.outcome)}</td><td class="r">${isNum(d.realizedR) ? d.realizedR.toFixed(2) : "—"}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Aucune</td></tr>'}</tbody></table></div>`))}
        </div>
      </div>`);
    $("#j-add").addEventListener("click", () => { const title = $("#j-title").value.trim(), note = $("#j-note").value.trim(); if (!title && !note) return; AOS.store.push("journal", { id: AOS.util.uid(), ts: Date.now(), title, type: $("#j-type").value, note, regime: a.features.regime.regime, level: a.risk.level }); V.archive(a); });
  };

  // ---- ALERTS ------------------------------------------------------------------------------------
  V.alerts = function (a) {
    const stored = AOS.store.list("alerts").slice(-12).reverse();
    const cur = a.alerts || [];
    const all = [...cur, ...stored.filter((s) => !cur.some((c) => c.id === s.id))].slice(0, 12);
    set($("#alerts-body"), all.length ? raw(all.map((x) => `<div class="alert card"><span class="stripe ${x.severity >= 3 ? "DANGER" : x.severity === 2 ? "WATCH" : "NORMAL"}"></span><div class="what">${esc(x.what)} <span class="dimc num" style="font-weight:400">${esc(fmt.datetime(x.ts))}</span></div><div class="why"><b>Why it matters:</b> ${esc(x.why)}</div><div class="act"><b>${/^NO ACTION/i.test(x.action) ? "No action" : "Action"}:</b> ${esc(x.action)}</div></div>`).join("")) : html`<div class="empty">Aucune alerte. Le watcher n'alerte que sur : changement de régime, transition de risque, seuil de liquidation, anomalie de funding, invalidation de position, setup à forte conviction, niveau majeur, nouvelle position.</div>`);
  };

  // ---- SETTINGS ------------------------------------------------------------------------------------
  V.settings = function () {
    const s = AOS.store.settings, fw = s.firewall, R = s.risk, W = s.weights;
    const n = (v) => (isNum(v) ? v : "");
    set($("#settings-body"), html`
      <div class="grid c2">
        <div class="card"><h3>Source de vérité</h3>
          <div class="field"><label>Wallet Hyperliquid (0x…)</label><input id="s-wallet" class="mono" value="${s.wallet}" spellcheck="false" autocapitalize="off"/></div>
          <div class="form c3" style="margin-top:8px">
            <div class="field"><label>Polling (s)</label><input id="s-poll" inputmode="numeric" value="${Math.round(s.pollMs / 1000)}"/></div>
            <div class="field"><label>Stale après (s)</label><input id="s-stale" inputmode="numeric" value="${Math.round(s.staleAfterMs / 1000)}"/></div>
            <div class="field"><label>WebSocket</label><select id="s-ws"><option value="1" ${s.useWebSocket ? "selected" : ""}>ON</option><option value="0" ${!s.useWebSocket ? "selected" : ""}>OFF</option></select></div>
          </div>
          <div class="form c2" style="margin-top:8px"><div class="field"><label>Auto-sync</label><select id="s-auto"><option value="1" ${s.autoSync ? "selected" : ""}>ON</option><option value="0" ${!s.autoSync ? "selected" : ""}>OFF</option></select></div><div class="field"><label>Watchlist (narratives)</label><input id="s-watch" value="${s.watchlist.join(" ")}"/></div></div>
          <h3 style="margin-top:14px">Watcher (07h30–20h30, ~2h)</h3>
          <div class="form c3"><div class="field"><label>Activé</label><select id="s-w-on"><option value="1" ${s.watcher.enabled ? "selected" : ""}>ON</option><option value="0" ${!s.watcher.enabled ? "selected" : ""}>OFF</option></select></div><div class="field"><label>Début (h)</label><input id="s-w-start" inputmode="decimal" value="${s.watcher.startHour}"/></div><div class="field"><label>Fin (h)</label><input id="s-w-end" inputmode="decimal" value="${s.watcher.endHour}"/></div></div>
          <div class="hint" style="margin-top:6px">Le watcher ne fonctionne que si l'onglet est ouvert (page statique, sans serveur). Les notifications navigateur sont demandées à l'activation.</div>
        </div>
        <div class="card"><h3>Personal capital firewall <span class="tag">LOCAL ONLY</span></h3>
          <div class="hint" style="margin-bottom:8px">Stocké uniquement dans ce navigateur. Jamais envoyé, jamais commité. Vide = inconnu. Le capital de trading plafonne le sizing ; sinon l'equity Hyperliquid est utilisée.</div>
          <div class="form c2">
            <div class="field"><label>Core capital (intouchable)</label><input id="s-fw-core" inputmode="decimal" value="${n(fw.coreCapital)}"/></div>
            <div class="field"><label>Investment capital (LT)</label><input id="s-fw-inv" inputmode="decimal" value="${n(fw.investmentCapital)}"/></div>
            <div class="field"><label>Trading capital</label><input id="s-fw-trade" inputmode="decimal" value="${n(fw.tradingCapital)}"/></div>
            <div class="field"><label>Tactical margin (exceptionnel)</label><input id="s-fw-tact" inputmode="decimal" value="${n(fw.tactical)}"/></div>
            <div class="field"><label>Obligations mensuelles (crédits + charges)</label><input id="s-fw-obl" inputmode="decimal" value="${n(fw.monthlyObligations)}"/></div>
            <div class="field"><label>Dernière vérification</label><input id="s-fw-date" type="date" value="${fw.lastVerified || ""}"/></div>
          </div>
          <h3 style="margin-top:14px">Politique de risque</h3>
          <div class="form c3">
            <div class="field"><label>Risque/trade base</label><input id="s-r-base" inputmode="decimal" value="${R.baseRiskPerTrade}"/></div>
            <div class="field"><label>Risque/trade max</label><input id="s-r-max" inputmode="decimal" value="${R.maxRiskPerTrade}"/></div>
            <div class="field"><label>Dist. liq min</label><input id="s-r-liq" inputmode="decimal" value="${R.minLiqDistance}"/></div>
            <div class="field"><label>Buffer min</label><input id="s-r-buf" inputmode="decimal" value="${R.minBufferRatio}"/></div>
            <div class="field"><label>Concentration max</label><input id="s-r-conc" inputmode="decimal" value="${R.maxConcentration}"/></div>
            <div class="field"><label>Corr. stress</label><input id="s-r-corr" inputmode="decimal" value="${R.normalCorrStress}"/></div>
          </div>
          <h3 style="margin-top:14px">Poids de base des agents</h3>
          <div class="form c3">${raw(["ORACLE", "EDGE", "FLOW", "ALLOCATOR", "ARCHIVE"].map((k) => `<div class="field"><label>${k}</label><input id="s-w-${k}" inputmode="decimal" value="${W[k]}"/></div>`).join(""))}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn primary" id="s-save" style="flex:0 0 auto;padding:0 18px">Enregistrer & resynchroniser</button><button class="btn ghost" id="s-export" style="flex:0 0 auto;padding:0 14px">Exporter (JSON)</button><button class="btn danger ghost" id="s-clear" style="flex:0 0 auto;padding:0 14px">Effacer les données locales de ce wallet</button></div>`);
  };

  AOS.views = Object.assign(AOS.views || {}, V);
})(typeof window !== "undefined" ? window : globalThis);
