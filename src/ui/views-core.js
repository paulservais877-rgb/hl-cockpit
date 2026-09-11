/* Personal Alpha OS — core views: command center, positions, SENTINEL, market */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, fmt, clamp, stats } = AOS.util;
  const D = AOS.dom;
  const { html, raw, set, $, usd, usdS, pct, px, tag, prov, lvlTag, sideTag, kv, why, list, json, heatColor, esc } = D;

  const V = {};

  // ---- COMMAND CENTER --------------------------------------------------------------------
  V.command = function (a, prev) {
    const s = a.snapshot, acc = s.account, pf = a.portfolio, rk = a.risk, f = a.features, o = a.orchestration;
    const dayPnl = (() => { const p = a.history?.portfolio?.day?.pnl; return p?.length >= 2 ? p[p.length - 1][1] - p[0][1] : NaN; })();
    const upnl = stats.sum(s.positions.map((p) => (isNum(p.upnl) ? p.upnl : 0)));
    const best = o.approved[0] || o.cards[0];
    const m = a.alpha?.windows?.month;
    const temp = f.temperature;
    const lvlCls = "lvl-" + (rk.level || "UNKNOWN");
    set($("#cmd-tiles"), html`
      <div class="card"><h3>Portfolio ${prov(acc.prov?.equity)}</h3>
        <div class="big" data-private>${fmt.usd(acc.equity)}</div>
        <div class="sub2">PnL latent ${usdS(upnl)} · jour ${usdS(dayPnl)}</div>
        ${kv("Marge utilisée", pct(acc.marginUtilisation, 0))}
        ${kv("Funding / jour", usdS(rk.fundingPerDay), { prov: "CALCULATED" })}
        ${kv("Levier brut", fmt.x(pf.grossLev))}
      </div>
      <div class="card"><span class="stripe ${esc(rk.level)}"></span><h3>Risk ${lvlTag(rk.level)}</h3>
        <div class="big ${lvlCls}">${rk.level}</div>
        <div class="sub2">${rk.reasons[0] || ""}</div>
        ${kv("Distance liquidation", rk.worstLiq ? raw(`${esc(rk.worstLiq.coin)} <b>${esc(fmt.pct(rk.worstLiq.liqDist, 0))}</b>`) : s.positions.length ? "inconnue" : "—")}
        ${kv("Perte BTC −20% (corr→1)", raw(`${pct(rk.btc20LossPct, 0).s} ${usdS(rk.btc20?.dPnl).s}`))}
        ${kv("Buffer (equity−MM)/equity", pct(acc.bufferRatio, 0))}
      </div>
      <div class="card"><h3>Market ${prov(f.regime.prov)}</h3>
        <div class="big" style="font-size:19px">${f.regime.regime}</div>
        <div class="sub2">Confiance ${f.regime.confidence}% · biais ${f.regime.bias} · vol ${f.regime.expectedVol}</div>
        <div style="margin:10px 0 4px"><div class="gauge"><i style="left:${clamp(temp.value || 50, 0, 100)}%"></i></div><div class="bandlabels"><span>PANIC</span><span>${isNum(temp.value) ? temp.value + " · " + temp.label : "—"}</span><span>EUPHORIA</span></div></div>
        ${kv("Flows", `${a.agents.FLOW.direction.toUpperCase()} · stress levier ${a.agents.FLOW.leverageStress.label}`)}
      </div>
      <div class="card"><h3>Alpha</h3>
        ${best ? html`<div class="big" style="font-size:19px">${best.side} ${best.coin} <small>${best.conviction}/100</small></div><div class="sub2">${best.name} · EV ${best.evR.toFixed(2)}R · ${best.status}</div>` : html`<div class="big" style="font-size:19px">Aucune</div><div class="sub2">Aucun setup avec edge suffisant</div>`}
        ${kv("Alpha vs BTC (30j)", m && isNum(m.alphaBTC) ? pct(m.alphaBTC, 1, true) : "—", { prov: m?.prov })}
        ${kv("Perf 30j / BTC", m ? raw(`${pct(m.ret, 1, true).s} / ${pct(m.btc, 1, true).s}`) : "—")}
        ${kv("Désaccord agents", fmt.pct(o.marketDisagreement, 0))}
      </div>
      <div class="card accent"><h3>Action</h3>
        <div class="big" style="font-size:17px;line-height:1.25">${o.action.title}</div>
        <div class="sub2">${o.action.text}</div>
        ${why("Why?", list(o.action.why || []))}
      </div>`);
  };

  // ---- POSITIONS -----------------------------------------------------------------------
  V.positions = function (a) {
    const s = a.snapshot, verdicts = a.orchestration.verdicts, grav = a.risk.gravity;
    if (!s.positions.length) { set($("#poslist"), html`<div class="empty">Aucune position ouverte sur ce wallet. ${s.partial.length ? "(données partielles : " + s.partial.join(", ") + ")" : ""}</div>`); return; }
    set($("#poslist"), raw(s.positions.map((p) => {
      const v = verdicts.find((x) => x.coin === p.coin), g = grav.find((x) => x.coin === p.coin);
      const liqCls = !isNum(p.liqDist) ? "dimc" : p.liqDist < 0.1 ? "neg" : p.liqDist < 0.2 ? "warnc" : "";
      return html`<div class="card poscard" data-coin="${p.coin}" role="button" tabindex="0"><span class="stripe ${p.liqDist < 0.1 ? "DANGER" : p.liqDist < 0.2 ? "WATCH" : "NORMAL"}"></span>
        <div><div class="sym">${p.coin}</div>${sideTag(p.side)} ${p.isHypothetical ? tag("SIM", "info") : ""}</div>
        <div class="meta"><span data-private>${fmt.qty(p.absSize)} · ${fmt.usd(p.notional)}</span> · ${fmt.x(p.leverage, 0)} ${p.marginMode}<br/>entrée <span class="num">${px(p.entry)}</span> · mark <span class="num">${px(p.mark)}</span></div>
        <div class="pnl ${p.upnl >= 0 ? "pos" : "neg"}"><span data-private>${fmt.usdSigned(p.upnl)}</span><br/><small class="num" style="font-weight:500">${fmt.pct(p.roe, 1, true)}</small></div>
        <div class="foot"><span class="verdict ${(v?.verdict || "").replace(" ", "")}">${v?.verdict || "—"}</span><span>liq <b class="num ${liqCls}">${fmt.pct(p.liqDist, 0)}</b> @ <span class="num">${px(p.liq)}</span></span><span>funding <b class="num">${fmt.usdSigned(p.fundingPerDay)}/j</b></span><span>gravité <b class="num">${g ? Math.round(g.share * 100) + "%" : "—"}</b></span>${isNum(p.stopLoss) ? html`<span>SL <b class="num">${px(p.stopLoss)}</b></span>` : tag("NO STOP", "warn")}${isNum(p.takeProfit) ? html`<span>TP <b class="num">${px(p.takeProfit)}</b></span>` : ""}</div>
      </div>`.s;
    }).join("")));
  };

  V.positionDetail = function (a, coin) {
    const p = a.snapshot.positions.find((x) => x.coin === coin);
    const el = $("#posdetail");
    if (!p) { el.hidden = true; return; }
    const v = a.orchestration.verdicts.find((x) => x.coin === coin);
    const sm = a.risk.survival.perAsset.find((x) => x.coin === coin);
    const conv = a.orchestration.convictions[coin];
    const f = a.features.byCoin[coin];
    const h = a.agents.FLOW.heatmap.find((x) => x.coin === coin);
    const cfUsd = a.alpha?.fundingByCoin?.find((x) => x.coin === coin)?.net;
    el.hidden = false;
    set(el, html`<div class="card lift"><h3>${p.coin} ${sideTag(p.side)} <span class="verdict ${(v?.verdict || "").replace(" ", "")}">${v?.verdict || ""}</span><button class="iconbtn tag" data-close-detail style="margin-left:auto">Fermer ✕</button></h3>
      <div class="grid c2">
        <div>
          ${kv("Taille", raw(`<span data-private>${esc(fmt.qty(p.absSize))} ${esc(p.coin)}</span>`))}
          ${kv("Notional", usd(p.notional), { prov: p.prov.notional })}
          ${kv("Entrée / Mark", `${fmt.px(p.entry)} / ${fmt.px(p.mark)}`, { prov: p.prov.mark })}
          ${kv("PnL latent / ROE", raw(`${usdS(p.upnl).s} / ${esc(fmt.pct(p.roe, 1, true))}`), { prov: p.prov.upnl })}
          ${kv("Levier / mode", `${fmt.x(p.leverage, 0)} · ${p.marginMode}`)}
          ${kv("Marge utilisée", usd(p.marginUsed))}
          ${kv("Prix de liquidation", raw(`${esc(fmt.px(p.liq))} <b class="${p.liqDist < 0.1 ? "neg" : p.liqDist < 0.2 ? "warnc" : "pos"}">${esc(fmt.pct(p.liqDist, 1))}</b>`), { prov: p.prov.liq })}
          ${kv("Stop / Take profit", `${fmt.px(p.stopLoss)} / ${fmt.px(p.takeProfit)}`, { prov: p.orders ? "LIVE" : "UNKNOWN" })}
        </div>
        <div>
          ${kv("Funding courant", `${isNum(p.fundingHourly) ? (p.fundingHourly * 100).toFixed(4) + "%/h" : "—"} → ${fmt.usdSigned(p.fundingPerDay)}/j`, { prov: p.prov.funding })}
          ${kv("Funding 24h / 7j / 30j (moy.)", h ? `${fmt.bp(h.h24 * 24)}/j · ${fmt.bp(h.d7 * 24)}/j · ${fmt.bp(h.d30 * 24)}/j` : "—", { prov: "HISTORICAL" })}
          ${kv("Funding cumulé (depuis ouverture)", usdS(-p.cumFunding.sinceOpen), { prov: isNum(p.cumFunding.sinceOpen) ? "LIVE" : "UNKNOWN" })}
          ${kv("Funding net 90j (ledger)", usdS(cfUsd), { prov: isNum(cfUsd) ? "HISTORICAL" : "UNKNOWN" })}
          ${kv("Vol 30j / 7j (ann.)", `${fmt.pct(f?.vol, 0)} / ${fmt.pct(f?.volShort, 0)}`, { prov: f?.volProv })}
          ${kv("β BTC / corr", `${isNum(a.features.corr.betaBTC[coin]) ? a.features.corr.betaBTC[coin].toFixed(2) : "—"} / ${(() => { const i = a.features.corr.coins.indexOf(coin), j = a.features.corr.coins.indexOf("BTC"); return i >= 0 && j >= 0 && isNum(a.features.corr.normal[i][j]) ? a.features.corr.normal[i][j].toFixed(2) : "—"; })()}`)}
          ${kv("Conviction agents (long)", `${conv?.long ?? "—"}/100 · désaccord ${fmt.pct(conv?.disagreement, 0)}`)}
          ${kv("Squeeze", h?.squeezeProb ? `${Math.round(h.squeezeProb * 100)}% ${h.squeezeSide}` : "—")}
        </div>
      </div>
      ${sm ? html`<div style="margin-top:10px"><div class="hint">Jusqu'où ${p.coin} seul peut aller contre toi :</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Seuil</th><th class="r">Prix ${p.coin}</th><th class="r">Mouvement</th></tr></thead><tbody>${raw(sm.rows.map((r) => `<tr><td class="t lvl-${r.label === "LIQUIDATION" ? "CRITICAL" : r.label}">${esc(r.label)}${r.threshold !== null ? " (equity " + Math.round(r.threshold * 100) + "%)" : ""}</td><td class="r">${esc(fmt.px(r.px))}</td><td class="r">${esc(fmt.pct(r.move, 0, true))}</td></tr>`).join(""))}</tbody></table></div></div>` : ""}
      <div class="form c3" style="margin-top:12px">
        <div class="field"><label>TP (prix)</label><input id="d-tp" inputmode="decimal" placeholder="${fmt.px(p.takeProfit)}"/></div>
        <div class="field"><label>SL (prix)</label><input id="d-sl" inputmode="decimal" placeholder="${fmt.px(p.stopLoss)}"/></div>
        <div class="field"><label>PnL @TP / @SL (local)</label><div id="d-tpsl" class="num" style="min-height:42px;display:flex;align-items:center">—</div></div>
      </div>
      ${why("Why this verdict?", list(v?.why || []))}
      ${why("Raw position (Hyperliquid)", json({ ...p, prov: p.prov }))}
    </div>`);
    const recalc = () => { const tp = Number($("#d-tp").value), sl = Number($("#d-sl").value); const f2 = (x) => (Number.isFinite(x) && x > 0 ? fmt.usdSigned(p.szi * (x - p.entry)) : "—"); $("#d-tpsl").innerHTML = `<span data-private>${esc(f2(tp))} / ${esc(f2(sl))}</span>`; };
    $("#d-tp").addEventListener("input", recalc); $("#d-sl").addEventListener("input", recalc);
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // ---- SENTINEL ------------------------------------------------------------------------------
  V.sentinel = function (a) {
    const rk = a.risk, acc = a.snapshot.account, sv = rk.survival;
    const bandHtml = (rows, label) => {
      const items = rows.filter((r) => isNum(r.btcPx));
      if (!items.length) return html`<div class="hint">${label} : aucun seuil atteint jusqu'à −97% (positions couvertes ou vides)</div>`;
      const cur = sv.btcPx;
      const down = items[0].dir < 0;
      const seq = [{ label: "SAFE", px: cur }, ...items.map((r) => ({ label: r.label, px: r.btcPx }))];
      // widths proportional to price span (min 6% so every band stays visible)
      const total = Math.abs(seq[seq.length - 1].px - cur) || 1;
      const spans = seq.map((r, i) => { const next = seq[i + 1]; const w = next ? Math.abs(next.px - r.px) / total : 0.06; return { label: r.label, w: Math.max(w, 0.06), px: r.px }; });
      const sum = spans.reduce((s, x) => s + x.w, 0);
      return html`<div class="hint" style="margin-bottom:4px">${label} · BTC ${down ? "en baisse" : "en hausse"} depuis ${fmt.px(cur)}</div>
        <div class="bands">${raw(spans.map((x) => { const w = x.w / sum; const short = x.label === "LIQUIDATION" ? "LIQ" : x.label; return `<span class="b-${x.label === "LIQUIDATION" ? "CRITICAL" : x.label}" style="width:${(w * 100).toFixed(1)}%" title="${esc(short)}">${w < 0.14 ? esc(short[0]) : esc(short)}</span>`; }).join(""))}</div>
        <div class="bandlabels">${raw(items.map((r) => `<span>${esc(r.label === "LIQUIDATION" ? "LIQ" : r.label)} ${esc(fmt.px(r.btcPx))} (${esc(fmt.pct(r.move, 0, true))})</span>`).join(""))}</div>`;
    };
    const groups = ["BTC", "ETH", "ALTS", "COMBINED"];
    set($("#sentinel-body"), html`
      <div class="grid c2">
        <div class="card"><span class="stripe ${rk.level}"></span><h3>Statut ${lvlTag(rk.level)} ${prov(rk.prov)}</h3>
          ${list(rk.reasons)}
          ${rk.veto ? html`<div class="banner bad" style="margin-top:10px"><b>VETO</b> ${rk.vetoReason}</div>` : ""}
          <div class="mini" style="margin-top:10px">
            <div class="m"><div class="k">Survival (choc simultané)</div><div class="v ${rk.survivalCombined ? "pos" : "neg"}">${rk.survivalCombined === null ? "—" : rk.survivalCombined ? "OUI" : "NON"}</div></div>
            <div class="m"><div class="k">Margin after shock</div><div class="v">${fmt.pct(rk.marginAfterShock, 0)}</div></div>
            <div class="m"><div class="k">Estimated loss</div><div class="v neg" data-private>${fmt.usdSigned(rk.estimatedLossCombined)}</div><div class="hint">${fmt.pct(rk.combinedLossPct, 0)} de l'equity</div></div>
            <div class="m"><div class="k">Capital to survive</div><div class="v" data-private>${fmt.usd(rk.capitalToSurvive)}</div></div>
          </div>
          ${kv("Position à réduire en premier", rk.reduceFirst[0] ? `${rk.reduceFirst[0].coin} ${rk.reduceFirst[0].side} (perte stress évitée ${fmt.usd(rk.reduceFirst[0].stressLossAvoided)})` : "—")}
          ${kv("Sous-niveaux", `buffer ${rk.levels.buffer} · liq ${rk.levels.liquidation} · stress ${rk.levels.stress} · levier ${rk.levels.leverage}`)}
          ${kv("Modèle de marge", `MM = notional × 0.5/maxLev × ${rk.model.scale.toFixed(2)} (calibré sur l'API)`, { prov: rk.model.prov })}
          ${why("Risk budget (dynamique)", raw(`Risque par trade <b class="num">${esc(fmt.pct(rk.budget.riskPerTrade, 2))}</b> du capital de trading (base ${esc(fmt.pct(rk.budget.base, 1))}, plafond ${esc(fmt.pct(rk.budget.cap, 1))})${list(rk.budget.factors.map((f) => `${f.name} : ×${f.factor} (${f.why})`)).s}`))}
        </div>
        <div class="card"><h3>Survival map ${prov(sv.prov)}</h3>
          ${bandHtml(sv.beta, "Propagation normale (beta)")}
          <div style="height:12px"></div>
          ${bandHtml(sv.stress, "Stress (corr → 1)")}
          <div class="hint" style="margin-top:8px">Seuils : WATCH = −10% d'equity · STRESSED −25% · DANGER −50% · CRITICAL −75% · LIQ = equity ≤ marge de maintenance. Calculés sur les positions LIVE.</div>
          <h3 style="margin-top:14px">Liquidation gravity</h3>
          ${raw(rk.gravity.map((g) => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:12px"><span><b class="num">${esc(g.coin)}</b> ${esc(g.side)} <span class="dimc">lev ${esc(fmt.x(g.lev, 0))} · vol ×${g.volR.toFixed(1)} · corr ×${g.corrFactor.toFixed(2)} · liq ${esc(fmt.pct(g.liqDist, 0))}</span></span><b class="num">${Math.round(g.share * 100)}%</b></div><div class="bar"><i style="width:${(g.share * 100).toFixed(1)}%;background:${g.side === "LONG" ? "var(--long)" : "var(--short)"}"></i></div></div>`).join("") || '<div class="empty">Aucune position</div>')}
        </div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Stress tests ${prov("CALCULATED")}</h3>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Scénario</th><th class="r">Δ PnL</th><th class="r">Equity</th><th class="r">% equity</th><th class="r">Buffer</th><th>Statut</th></tr></thead><tbody>
        ${raw(groups.map((g) => rk.grid.filter((r) => r.group === g).map((r) => `<tr><td class="t">${esc(r.label)}</td><td class="r ${r.dPnl < 0 ? "neg" : "pos"}" data-private>${esc(fmt.usdSigned(r.dPnl))}</td><td class="r" data-private>${esc(fmt.usd(r.equity1))}</td><td class="r">${esc(fmt.pct(isNum(acc.equity) && acc.equity > 0 ? r.equity1 / acc.equity - 1 : NaN, 0, true))}</td><td class="r">${esc(fmt.pct(r.bufferRatio, 0))}</td><td>${lvlTag(r.liquidated ? "CRITICAL" : AOS.risk.levelFromLoss(r, acc.equity)).s}</td></tr>`).join("")).join(""))}
        </tbody></table></div>
        <div class="hint" style="margin-top:6px">« beta » : les autres actifs bougent selon leur beta BTC 30j. « corr→1 » : tout bouge dans le même sens, amplifié par le ratio de volatilité. Marge de maintenance recalculée aux prix choqués.</div>
        ${why("Position to reduce first — détail", raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Position</th><th class="r">Δ buffer (choc simultané)</th><th class="r">Perte stress évitée</th><th class="r">par $ notional</th><th>Survit après</th></tr></thead><tbody>${rk.reduceFirst.map((r) => `<tr><td class="t">${esc(r.coin)} ${esc(r.side)}</td><td class="r">${esc(fmt.pct(r.dBuffer, 1, true))}</td><td class="r" data-private>${esc(fmt.usdSigned(r.stressLossAvoided))}</td><td class="r">${esc(fmt.pct(r.perNotional, 1, true))}</td><td>${r.survivesAfter ? "OUI" : "NON"}</td></tr>`).join("")}</tbody></table></div>`))}
      </div>`);
  };

  // ---- MARKET ----------------------------------------------------------------------------------
  V.market = function (a, prev) {
    const f = a.features, reg = f.regime, fl = a.agents.FLOW;
    const changed = [];
    if (prev?.features?.regime && prev.features.regime.regime !== reg.regime) changed.push(`Régime ${prev.features.regime.regime} → ${reg.regime}`);
    if (prev?.features?.regime && Math.abs(prev.features.regime.confidence - reg.confidence) >= 10) changed.push(`Confiance ${prev.features.regime.confidence}% → ${reg.confidence}%`);
    if (prev?.features?.temperature && isNum(prev.features.temperature.value) && Math.abs(prev.features.temperature.value - f.temperature.value) >= 8) changed.push(`Température ${prev.features.temperature.value} → ${f.temperature.value}`);
    const btc = f.byCoin.BTC?.d1;
    set($("#market-body"), html`
      <div class="grid c2">
        <div class="card accent"><h3>Market regime ${prov(reg.prov)} <span class="tag">${reg.uncertainty} uncertainty</span></h3>
          <div class="big" style="font-size:22px">${reg.regime}</div>
          <div class="sub2">Confidence ${reg.confidence}% · Volatility ${reg.expectedVol} · BTC trend ${btc ? (btc.trendScore > 0 ? "Positive" : btc.trendScore < 0 ? "Negative" : "Flat") : "—"} · Alt breadth ${isNum(f.breadth) ? (f.breadth > 0.6 ? "Strong" : f.breadth > 0.4 ? "Mixed" : "Weak") + " (" + Math.round(f.breadth * 100) + "%)" : "—"} · Leverage stress ${fl.leverageStress.label} · Regime change ${reg.changeProbability}%</div>
          <div style="margin-top:10px"><div class="hint"><b>What changed?</b></div>${changed.length ? list(changed) : html`<div class="hint">Rien de significatif depuis la dernière analyse${prev ? "" : " (première analyse de la session)"}.</div>`}</div>
          <div style="margin-top:8px"><div class="hint"><b>What matters?</b></div>${list(reg.drivers)}</div>
          <div style="margin-top:8px"><div class="hint"><b>What would invalidate this?</b></div>${list(reg.invalidation)}</div>
          ${why("Scores de tous les régimes", raw(`<div class="tbl-wrap"><table class="tbl"><tbody>${Object.entries(reg.scores).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<tr><td class="t">${esc(k)}</td><td class="r">${(v * 100).toFixed(0)}%</td><td style="width:40%"><div class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></div></td></tr>`).join("")}</tbody></table></div>`))}
        </div>
        <div class="card"><h3>Market temperature ${prov(f.temperature.prov)}</h3>
          <div class="big">${isNum(f.temperature.value) ? f.temperature.value : "—"} <small>${f.temperature.label}</small></div>
          <div style="margin:10px 0"><div class="gauge"><i style="left:${clamp(f.temperature.value || 50, 0, 100)}%"></i></div><div class="bandlabels"><span>0 PANIC</span><span>40 NEUTRAL 60</span><span>EUPHORIA 100</span></div></div>
          ${raw(f.temperature.components.map((c) => `<div class="kv"><span class="k">${esc(c.name)}</span><span class="v">${Math.round(c.value * 100)} <span class="dimc">×${c.weight}</span></span></div>`).join(""))}
          <h3 style="margin-top:14px">Narrative rotation ${prov("HISTORICAL")}</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Secteur</th><th class="r">7j vs BTC</th><th class="r">30j vs BTC</th><th>Volume</th></tr></thead><tbody>${raw(f.narratives.map((n) => `<tr><td class="t">${esc(n.sector)} <span class="dimc">${esc(n.coins.join(" "))}</span></td><td class="r ${n.rel7d > 0 ? "pos" : "neg"}">${esc(fmt.pct(n.rel7d, 1, true))}</td><td class="r ${n.rel30d > 0 ? "pos" : "neg"}">${esc(fmt.pct(n.rel30d, 1, true))}</td><td>${n.volumeConfirm === null ? "—" : n.volumeConfirm ? "confirmé" : "non confirmé"}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">Historique insuffisant</td></tr>')}</tbody></table></div>
          <div class="hint">Une narrative ne suffit jamais : elle doit être confirmée par flux + prix + volume.</div>
        </div>
      </div>
      <div class="grid c2" style="margin-top:12px">
        <div class="card"><h3>Funding heatmap ${prov("LIVE+HISTORICAL")}</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Coin</th><th class="r">Now /j</th><th class="r">24h</th><th class="r">7j</th><th class="r">30j</th><th class="r">z</th><th>Squeeze</th></tr></thead><tbody>
          ${raw(fl.heatmap.map((h) => `<tr><td class="t"><b>${esc(h.coin)}</b></td><td class="r"><span class="heat" style="background:${heatColor(h.z)}">${esc(fmt.bp(h.now * 24, 1))}</span></td><td class="r">${esc(fmt.bp(h.h24 * 24, 1))}</td><td class="r">${esc(fmt.bp(h.d7 * 24, 1))}</td><td class="r">${esc(fmt.bp(h.d30 * 24, 1))}</td><td class="r">${isNum(h.z) ? h.z.toFixed(1) : "—"}</td><td class="t">${h.squeezeProb ? Math.round(h.squeezeProb * 100) + "% " + esc(h.squeezeSide) : "—"}</td></tr>`).join(""))}
          </tbody></table></div>
          <div class="hint">Taux exprimés par jour (taux horaire Hyperliquid × 24). Positif = les longs paient.</div>
        </div>
        <div class="card"><h3>OI stress · anomalies ${prov("CALCULATED")}</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Coin</th><th class="r">OI</th><th class="r">Vol 24h</th><th class="r">OI/Vol</th><th class="r">24h</th></tr></thead><tbody>
          ${raw(fl.oiStress.map((r) => `<tr><td class="t"><b>${esc(r.coin)}</b></td><td class="r">${esc(fmt.usd(r.oiUsd))}</td><td class="r">${esc(fmt.usd(r.vol24))}</td><td class="r ${r.ratio > 1.2 ? "warnc" : ""}">${r.ratio.toFixed(2)}</td><td class="r ${r.change24h > 0 ? "pos" : "neg"}">${esc(fmt.pct(r.change24h, 1, true))}</td></tr>`).join(""))}
          </tbody></table></div>
          <div style="margin-top:10px">${f.anomalies.length ? list(f.anomalies.map((x) => `${x.text}`)) : html`<div class="hint">Aucune anomalie statistique (|z| ≥ 2) sur les actifs suivis.</div>`}</div>
          ${why("Données non disponibles (UNKNOWN)", list(fl.unknown))}
        </div>
      </div>`);
  };

  AOS.views = Object.assign(AOS.views || {}, V);
})(typeof window !== "undefined" ? window : globalThis);
