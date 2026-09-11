/* Alpha OS — vues principales : tableau de bord, positions, sentinelle, marché (français, chevrons, jauges) */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, fmt, clamp, stats } = AOS.util;
  const T = AOS.i18n, D = AOS.dom;
  const { html, raw, set, sum, $, usd, usdS, pct, px, tag, prov, lvlTag, levelColor, sideTag, verdictTag, kv, more, list, json, heatColor, esc, ring } = D;
  const V = {};

  // ---- TABLEAU DE BORD ------------------------------------------------------------------------
  V.command = function (a, prev) {
    const s = a.snapshot, acc = s.account, pf = a.portfolio, rk = a.risk, f = a.features, o = a.orchestration;
    const dayPnl = (() => { const p = a.history?.portfolio?.perpDay?.pnl || a.history?.portfolio?.day?.pnl; return p?.length >= 2 ? p[p.length - 1][1] - p[0][1] : NaN; })();
    const upnl = stats.sum(s.positions.map((p) => (isNum(p.upnl) ? p.upnl : 0)));
    const best = o.approved[0] || o.cards[0];
    const m = a.alpha?.windows?.month;
    const temp = f.temperature;
    const worst = rk.worstLiq;
    const liqScore = worst && isNum(worst.liqDist) ? clamp(worst.liqDist / 0.5, 0, 1) * 100 : 100;
    set($("#cmd-tiles"), html`
      <div class="card"><h3>Mon compte ${prov(acc.prov?.equity)}</h3>
        <div class="big" data-private>${fmt.usd(acc.equity)}</div>
        <div class="sub2">Aujourd'hui ${usdS(dayPnl)} · latent ${usdS(upnl)}</div>
        ${isNum(a.alpha?.capital?.totalHL) ? kv("Compte HL total", usd(a.alpha.capital.totalHL), { prov: a.alpha.capital.prov }) : ""}
        ${kv("Marge disponible", usd(acc.withdrawable))}
        ${more("Détails", raw(`${kv("Marge utilisée", pct(acc.marginUtilisation, 0)).s}${kv("Funding par jour", usdS(rk.fundingPerDay), { prov: "CALCULATED" }).s}${kv("Levier brut · net", `${fmt.x(pf.grossLev)} · ${fmt.x(pf.netLev, 1)} ${pf.directional === "NET LONG" ? "acheteur" : pf.directional === "NET SHORT" ? "vendeur" : "neutre"}`).s}${kv("Coussin (equity − maintenance)", pct(acc.bufferRatio, 0)).s}`))}
      </div>
      <div class="card"><span class="stripe ${esc(rk.level)}"></span><h3>Risque ${lvlTag(rk.level)}</h3>
        <div class="rowring">${ring(liqScore, "liquid.", levelColor(rk.level), worst && isNum(worst.liqDist) ? fmt.pct(worst.liqDist, 0) : "∞")}<div><div class="big lvl-${esc(rk.level)}" style="font-size:22px">${T.level(rk.level)}</div><div class="sub2">${worst ? `${worst.coin} est la position la plus proche de sa liquidation` : "Aucune liquidation atteignable"}</div></div></div>
        ${kv("BTC −20 % (tout corrélé)", raw(`${pct(-rk.btc20LossPct, 0, true).s} d'equity`))}
        ${more("Pourquoi ?", list(rk.reasons))}
      </div>
      <div class="card"><h3>Marché ${prov(f.regime.prov)}</h3>
        <div class="rowring">${ring(temp.value, "météo", temp.value >= 60 ? "var(--hot)" : temp.value < 40 ? "var(--info)" : "var(--accent)")}<div><div class="big" style="font-size:19px">${T.regime(f.regime.regime)}</div><div class="sub2">Confiance ${f.regime.confidence} % · biais ${T.bias(f.regime.bias)} · ${T.temp(temp.label)}</div></div></div>
        ${kv("Flux", `${T.dir(a.agents.FLOW.direction)} · stress de levier ${T.vol(a.agents.FLOW.leverageStress.label === "HIGH" ? "HIGH" : a.agents.FLOW.leverageStress.label === "LOW" ? "LOW" : "MODERATE")}`)}
        ${more("Ce qui invaliderait ce régime", list(f.regime.invalidation))}
      </div>
      <div class="card"><h3>Alpha</h3>
        ${best ? html`<div class="big" style="font-size:19px">${best.side} ${best.coin} <small>${best.conviction}/100</small></div><div class="sub2">${best.name} · espérance ${best.evR.toFixed(2)}R · ${T.status(best.status)}</div>` : html`<div class="big" style="font-size:19px">Aucune opportunité</div><div class="sub2">Aucune configuration avec un avantage suffisant</div>`}
        ${kv("Alpha vs BTC (30 j)", m && isNum(m.alphaBTC) ? pct(m.alphaBTC, 1, true) : "—", { prov: m?.prov })}
        ${kv("Toi / BTC (30 j)", m ? raw(`${pct(m.ret, 1, true).s} / ${pct(m.btc, 1, true).s}`) : "—")}
        ${kv("Désaccord des agents", fmt.pct(o.marketDisagreement, 0))}
      </div>
      <div class="card accent"><h3>Action</h3>
        <div class="big" style="font-size:18px;line-height:1.25">${o.action.title}</div>
        <div class="sub2">${o.action.text}</div>
        ${more("Pourquoi ?", list(o.action.why || []))}
      </div>`);
    sum("cmd", `${document.body.classList.contains("privacy") ? "•••" : fmt.usd(acc.equity)} · ${T.level(rk.level)} · ${T.regime(f.regime.regime)}`);
  };

  // ---- POSITIONS ------------------------------------------------------------------------------
  V.positions = function (a) {
    const s = a.snapshot, verdicts = a.orchestration.verdicts, grav = a.risk.gravity;
    const upnl = stats.sum(s.positions.map((p) => (isNum(p.upnl) ? p.upnl : 0)));
    sum("positions", s.positions.length ? `${s.positions.length} position${s.positions.length > 1 ? "s" : ""} · ${document.body.classList.contains("privacy") ? "•••" : fmt.usdSigned(upnl)}` : "aucune");
    if (!s.positions.length) { set($("#poslist"), html`<div class="empty">Aucune position ouverte sur ce wallet.${s.partial.length ? " (données partielles : " + s.partial.join(", ") + ")" : ""}</div>`); V.orders(a); return; }
    set($("#poslist"), raw(s.positions.map((p) => {
      const v = verdicts.find((x) => x.coin === p.coin), g = grav.find((x) => x.coin === p.coin);
      const liqCls = !isNum(p.liqDist) ? "dimc" : p.liqDist < 0.1 ? "neg" : p.liqDist < 0.2 ? "warnc" : "";
      return html`<div class="card tap poscard" data-coin="${p.coin}" role="button" tabindex="0"><span class="stripe ${p.liqDist < 0.1 ? "DANGER" : p.liqDist < 0.2 ? "WATCH" : "NORMAL"}"></span>
        <div><div class="sym">${p.coin}</div>${sideTag(p.side)}</div>
        <div class="meta"><span data-private>${fmt.qty(p.absSize)} · ${fmt.usd(p.notional)}</span> · ${fmt.x(p.leverage, 0)}<br/>entrée <span class="num">${px(p.entry)}</span> → <span class="num">${px(p.mark)}</span></div>
        <div class="pnl ${p.upnl >= 0 ? "pos" : "neg"}"><span data-private>${fmt.usdSigned(p.upnl)}</span><br/><small class="num" style="font-weight:500">${fmt.pct(p.roe, 1, true)}</small></div>
        <div class="foot">${verdictTag(v?.verdict)}<span class="chip">liq ${p.noLiqAlone ? raw('<b class="pos" title="Aucune liquidation atteignable par cet actif seul">∞</b>') : raw(`<b class="${liqCls}">${esc(fmt.pct(p.liqDist, 0))}</b>`)}</span><span class="chip">funding <b>${fmt.usdSigned(p.fundingPerDay)}/j</b></span><span class="chip">poids risque <b>${g ? Math.round(g.share * 100) + " %" : "—"}</b></span>${isNum(p.stopLoss) ? html`<span class="chip">stop <b>${px(p.stopLoss)}</b></span>` : tag("SANS STOP", "warn")}</div>
      </div>`.s;
    }).join("")));
    V.orders(a);
  };

  V.orders = function (a) {
    const el = $("#orders"); if (!el) return;
    const s = a.snapshot, eq = s.account.equity;
    const pending = s.orders.filter((o) => !o.reduceOnly && !o.isPositionTpsl);
    const closing = s.orders.filter((o) => o.reduceOnly || o.isPositionTpsl);
    if (!s.orders.length) { el.hidden = true; return; }
    el.hidden = false;
    const pendNtl = stats.sum(pending.map((o) => (isNum(o.sz) && isNum(o.limitPx) ? o.sz * o.limitPx : 0)));
    const row = (o) => { const px0 = isNum(o.triggerPx) && o.triggerPx > 0 ? o.triggerPx : o.limitPx; const ntl = isNum(o.sz) && isNum(px0) ? o.sz * px0 : NaN; const mark = s.meta.assets[o.coin]?.markPx; return `<tr><td class="t"><b>${esc(o.coin)}</b> <span class="tag ${o.side === "BUY" ? "long" : "short"}">${o.side === "BUY" ? "ACHAT" : "VENTE"}</span></td><td class="t">${esc(o.type)}${o.isTrigger ? " · déclench. " + esc(fmt.px(o.triggerPx)) : ""}</td><td class="r">${esc(fmt.qty(o.sz))}</td><td class="r">${esc(fmt.px(o.limitPx))}</td><td class="r">${isNum(mark) && isNum(px0) && mark > 0 ? esc(fmt.pct(px0 / mark - 1, 1, true)) : "—"}</td><td class="r" data-private>${esc(fmt.usd(ntl))}</td><td class="r">${isNum(ntl) && isNum(eq) && eq > 0 ? esc(fmt.x(ntl / eq, 1)) : "—"}</td></tr>`; };
    set(el, html`<div class="card"><h3>Ordres en attente ${prov("LIVE")} <span class="tag ${pendNtl > (eq || 0) ? "warn" : ""}">si exécutés : ${fmt.usd(pendNtl)} · ${isNum(eq) && eq > 0 ? fmt.x(pendNtl / eq, 1) + " l'equity" : "—"}</span></h3>
      ${pendNtl > (eq || 0) * 0.5 ? html`<div class="hint warnc">Ces ordres ajouteraient ${fmt.usd(pendNtl)} d'exposition avec ${fmt.usd(s.account.withdrawable)} de marge disponible. La Sentinelle ne les compte pas tant qu'ils ne sont pas remplis, mais ils se remplissent justement quand le marché va contre toi.</div>` : ""}
      ${more(`Voir les ${s.orders.length} ordres`, raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ordre</th><th>Type</th><th class="r">Taille</th><th class="r">Limite</th><th class="r">vs prix</th><th class="r">Notional</th><th class="r">× equity</th></tr></thead><tbody>${pending.map(row).join("")}${closing.length ? `<tr><td colspan="7" class="t dimc">Ordres de sortie : ${closing.map((o) => `${esc(o.coin)} ${o.kind === "SL" ? "stop" : o.kind === "TP" ? "objectif" : esc(o.kind)} ${esc(fmt.px(isNum(o.triggerPx) && o.triggerPx > 0 ? o.triggerPx : o.limitPx))}`).join(" · ")}</td></tr>` : ""}</tbody></table></div>`), !pending.length)}
    </div>`);
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
    set(el, html`<div class="card lift"><h3>${p.coin} ${sideTag(p.side)} ${verdictTag(v?.verdict)}<button class="iconbtn" data-close-detail style="margin-left:auto;min-height:32px">Fermer ✕</button></h3>
      <div style="font-size:13.5px;margin-bottom:8px">${v?.why?.[0] || ""}</div>
      <div class="grid c2">
        <div>
          ${kv("Taille", raw(`<span data-private>${esc(fmt.qty(p.absSize))} ${esc(p.coin)}</span>`))}
          ${kv("Notional", usd(p.notional), { prov: p.prov.notional })}
          ${kv("Entrée → prix", `${fmt.px(p.entry)} → ${fmt.px(p.mark)}`, { prov: p.prov.mark })}
          ${kv("PnL latent · rendement", raw(`${usdS(p.upnl).s} · ${esc(fmt.pct(p.roe, 1, true))}`), { prov: p.prov.upnl })}
          ${kv("Levier · mode", `${fmt.x(p.leverage, 0)} · ${p.marginMode === "cross" ? "croisé" : "isolé"}`)}
          ${kv("Marge mobilisée", usd(p.marginUsed))}
          ${kv("Prix de liquidation", p.noLiqAlone ? raw('<b class="pos">aucune par cet actif seul</b>') : raw(`${esc(fmt.px(p.liq))} <b class="${p.liqDist < 0.1 ? "neg" : p.liqDist < 0.2 ? "warnc" : "pos"}">${esc(fmt.pct(p.liqDist, 1))}</b>`), { prov: p.prov.liq })}
          ${kv("Stop · objectif", `${fmt.px(p.stopLoss)} · ${fmt.px(p.takeProfit)}`, { prov: p.orders ? "LIVE" : "UNKNOWN" })}
        </div>
        <div>
          ${kv("Funding actuel", `${isNum(p.fundingHourly) ? (p.fundingHourly * 100).toFixed(4) + " %/h" : "—"} → ${fmt.usdSigned(p.fundingPerDay)}/j`, { prov: p.prov.funding })}
          ${kv("Funding moyen 24 h · 7 j · 30 j", h ? `${fmt.bp(h.h24 * 24)}/j · ${fmt.bp(h.d7 * 24)}/j · ${fmt.bp(h.d30 * 24)}/j` : "—", { prov: "HISTORICAL" })}
          ${kv("Funding cumulé depuis l'ouverture", usdS(-p.cumFunding.sinceOpen), { prov: isNum(p.cumFunding.sinceOpen) ? "LIVE" : "UNKNOWN" })}
          ${kv("Funding net 90 j (ledger)", usdS(cfUsd), { prov: isNum(cfUsd) ? "HISTORICAL" : "UNKNOWN" })}
          ${kv("Volatilité 30 j · 7 j", `${fmt.pct(f?.vol, 0)} · ${fmt.pct(f?.volShort, 0)}`, { prov: f?.volProv })}
          ${kv("β BTC · corrélation", `${isNum(a.features.corr.betaBTC[coin]) ? a.features.corr.betaBTC[coin].toFixed(2) : "—"} · ${(() => { const i = a.features.corr.coins.indexOf(coin), j = a.features.corr.coins.indexOf("BTC"); return i >= 0 && j >= 0 && isNum(a.features.corr.normal[i][j]) ? a.features.corr.normal[i][j].toFixed(2) : "—"; })()}`)}
          ${kv("Conviction du conseil (long)", `${conv?.long ?? "—"}/100 · désaccord ${fmt.pct(conv?.disagreement, 0)}`)}
          ${kv("Squeeze", h?.squeezeProb ? `${Math.round(h.squeezeProb * 100)} % ${h.squeezeSide}` : "—")}
        </div>
      </div>
      ${sm ? more(`Jusqu'où ${p.coin} seul peut aller contre moi`, raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Seuil</th><th class="r">Prix ${esc(p.coin)}</th><th class="r">Mouvement</th></tr></thead><tbody>${sm.rows.map((r) => `<tr><td class="t lvl-${r.label === "LIQUIDATION" ? "CRITICAL" : r.label}">${esc(T.level(r.label))}${r.threshold !== null ? " (equity " + Math.round(r.threshold * 100) + " %)" : ""}</td><td class="r">${esc(fmt.px(r.px))}</td><td class="r">${esc(fmt.pct(r.move, 0, true))}</td></tr>`).join("")}</tbody></table></div>`)) : ""}
      ${more("Simuler un stop et un objectif (local)", raw(`<div class="form c3"><div class="field"><label>Objectif (prix)</label><input id="d-tp" inputmode="decimal" placeholder="${esc(fmt.px(p.takeProfit))}"/></div><div class="field"><label>Stop (prix)</label><input id="d-sl" inputmode="decimal" placeholder="${esc(fmt.px(p.stopLoss))}"/></div><div class="field"><label>PnL à l'objectif / au stop</label><div id="d-tpsl" class="num" style="min-height:44px;display:flex;align-items:center">—</div></div></div>`), true)}
      ${more("Pourquoi ce verdict ?", list(v?.why || []))}
      ${more("Données brutes Hyperliquid", json({ ...p, prov: p.prov }))}
    </div>`);
    const recalc = () => { const tp = Number($("#d-tp").value), sl = Number($("#d-sl").value); const f2 = (x) => (Number.isFinite(x) && x > 0 ? fmt.usdSigned(p.szi * (x - p.entry)) : "—"); $("#d-tpsl").innerHTML = `<span data-private>${esc(f2(tp))} / ${esc(f2(sl))}</span>`; };
    $("#d-tp").addEventListener("input", recalc); $("#d-sl").addEventListener("input", recalc);
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // ---- SENTINELLE -----------------------------------------------------------------------------------
  V.sentinel = function (a) {
    const rk = a.risk, acc = a.snapshot.account, sv = rk.survival;
    const bandHtml = (rows, label) => {
      const items = rows.filter((r) => isNum(r.btcPx));
      if (!items.length) return html`<div class="hint">${label} : aucun seuil atteint jusqu'à −97 % (positions couvertes ou vides)</div>`;
      const cur = sv.btcPx, down = items[0].dir < 0;
      const seq = [{ label: "SAFE", px: cur }, ...items.map((r) => ({ label: r.label, px: r.btcPx }))];
      const total = Math.abs(seq[seq.length - 1].px - cur) || 1;
      const spans = seq.map((r, i) => { const next = seq[i + 1]; const w = next ? Math.abs(next.px - r.px) / total : 0.06; return { label: r.label, w: Math.max(w, 0.06) }; });
      const s = spans.reduce((x, y) => x + y.w, 0);
      return html`<div class="hint" style="margin-bottom:4px">${label} · BTC ${down ? "en baisse" : "en hausse"} depuis ${fmt.px(cur)}</div>
        <div class="bands">${raw(spans.map((x) => { const w = x.w / s; const lbl = T.level(x.label); return `<span class="b-${x.label === "LIQUIDATION" ? "CRITICAL" : x.label}" style="width:${(w * 100).toFixed(1)}%" title="${esc(lbl)}">${w < 0.16 ? esc(T.levelShort(x.label)) : esc(lbl)}</span>`; }).join(""))}</div>
        <div class="bandlabels">${raw(items.map((r) => `<span>${esc(T.levelShort(r.label))} ${esc(fmt.px(r.btcPx))} (${esc(fmt.pct(r.move, 0, true))})</span>`).join(""))}</div>`;
    };
    const groups = ["BTC", "ETH", "ALTS", "COMBINED"];
    const lossPct = (r) => (isNum(acc.equity) && acc.equity > 0 ? r.equity1 / acc.equity - 1 : NaN);
    set($("#sentinel-body"), html`
      <div class="grid c2">
        <div class="card"><span class="stripe ${rk.level}"></span><h3>Verdict ${lvlTag(rk.level)} ${prov(rk.prov)}</h3>
          ${list(rk.reasons)}
          ${rk.veto ? html`<div class="banner bad" style="margin-top:10px"><b>VETO</b> ${rk.vetoReason}</div>` : ""}
          <div class="mini" style="margin-top:10px">
            <div class="m"><div class="k">Survie au choc simultané</div><div class="v ${rk.survivalCombined ? "pos" : "neg"}">${rk.survivalCombined === null ? "—" : rk.survivalCombined ? "OUI" : "NON"}</div></div>
            <div class="m"><div class="k">Perte estimée</div><div class="v neg" data-private>${fmt.usdSigned(rk.estimatedLossCombined)}</div><div class="hint">${fmt.pct(rk.combinedLossPct, 0)} de l'equity</div></div>
            <div class="m"><div class="k">Marge après choc</div><div class="v">${fmt.pct(rk.marginAfterShock, 0)}</div></div>
            <div class="m"><div class="k">Capital pour survivre</div><div class="v" data-private>${fmt.usd(rk.capitalToSurvive)}</div></div>
          </div>
          ${kv("À réduire en premier", rk.reduceFirst[0] ? `${rk.reduceFirst[0].coin} ${rk.reduceFirst[0].side} (évite ${fmt.usd(rk.reduceFirst[0].stressLossAvoided)} de perte au choc)` : "—")}
          ${more("Détails du diagnostic", raw(`${kv("Sous-niveaux", `coussin ${T.level(rk.levels.buffer)} · liquidation ${T.level(rk.levels.liquidation)} · stress ${T.level(rk.levels.stress)} · levier ${T.level(rk.levels.leverage)}`).s}${kv("Modèle de marge", `maintenance = notional × 0,5/levier max × ${rk.model.scale.toFixed(2)} (calibré sur l'API)`, { prov: rk.model.prov }).s}<div class="hint" style="margin-top:8px"><b>Budget de risque dynamique</b> : ${esc(fmt.pct(rk.budget.riskPerTrade, 2))} du capital de trading par trade (base ${esc(fmt.pct(rk.budget.base, 1))}, plafond ${esc(fmt.pct(rk.budget.cap, 1))})</div>${list(rk.budget.factors.map((f) => `${f.name} : ×${f.factor} (${f.why})`)).s}`))}
        </div>
        <div class="card"><h3>Carte de survie ${prov(sv.prov)}</h3>
          ${bandHtml(sv.beta, "Propagation normale (bêta)")}
          <div style="height:12px"></div>
          ${bandHtml(sv.stress, "Stress (tout corrélé)")}
          <div class="hint" style="margin-top:8px">Seuils : VIGILANCE = −10 % d'equity · TENDU −25 % · DANGER −50 % · CRITIQUE −75 % · LIQ = equity ≤ marge de maintenance.</div>
          <h3 style="margin-top:14px">Gravité de liquidation</h3>
          ${raw(rk.gravity.map((g) => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:12.5px"><span><b class="num">${esc(g.coin)}</b> ${esc(g.side)} <span class="dimc">levier ${esc(fmt.x(g.lev, 0))} · vol ×${g.volR.toFixed(1)} · liq ${esc(fmt.pct(g.liqDist, 0))}</span></span><b class="num">${Math.round(g.share * 100)} %</b></div><div class="bar"><i style="width:${(g.share * 100).toFixed(1)}%;background:${g.side === "LONG" ? "var(--long)" : "var(--short)"}"></i></div></div>`).join("") || '<div class="empty">Aucune position</div>')}
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        ${more(`Voir les ${rk.grid.length} scénarios de stress`, raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Scénario</th><th class="r">Δ PnL</th><th class="r">Equity</th><th class="r">% equity</th><th>Statut</th></tr></thead><tbody>${groups.map((g) => rk.grid.filter((r) => r.group === g).map((r) => `<tr><td class="t">${esc(r.label.replace("(beta)", "(bêta)").replace("(corr→1)", "(tout corrélé)").replace("seul", "seul").replace("Choc simultané", "Choc simultané").replace("Squeeze haussier", "Squeeze haussier"))}</td><td class="r ${r.dPnl < 0 ? "neg" : "pos"}" data-private>${esc(fmt.usdSigned(r.dPnl))}</td><td class="r" data-private>${esc(fmt.usd(r.equity1))}</td><td class="r">${esc(fmt.pct(lossPct(r), 0, true))}</td><td>${lvlTag(r.liquidated ? "CRITICAL" : r.level).s}</td></tr>`).join("")).join("")}</tbody></table></div><div class="hint" style="margin-top:6px">« bêta » : les autres actifs bougent selon leur bêta BTC 30 j. « tout corrélé » : tout bouge dans le même sens, amplifié par le ratio de volatilité. Marge de maintenance recalculée aux prix choqués.</div>`))}
        ${more("Quelle position réduire en premier ?", raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Position</th><th class="r">Δ coussin (choc simultané)</th><th class="r">Perte évitée</th><th class="r">par $ de notional</th><th>Survit après</th></tr></thead><tbody>${rk.reduceFirst.map((r) => `<tr><td class="t">${esc(r.coin)} ${esc(r.side)}</td><td class="r">${esc(fmt.pct(r.dBuffer, 1, true))}</td><td class="r" data-private>${esc(fmt.usdSigned(r.stressLossAvoided))}</td><td class="r">${esc(fmt.pct(r.perNotional, 1, true))}</td><td>${r.survivesAfter ? "OUI" : "NON"}</td></tr>`).join("")}</tbody></table></div>`))}
      </div>`);
    sum("sentinel", `${T.level(rk.level)} · BTC −20 % ⇒ ${fmt.pct(-rk.btc20LossPct, 0, true)}`);
  };

  // ---- MARCHÉ ---------------------------------------------------------------------------------------
  V.market = function (a, prev) {
    const f = a.features, reg = f.regime, fl = a.agents.FLOW;
    const changed = [];
    if (prev?.features?.regime && prev.features.regime.regime !== reg.regime) changed.push(`Régime ${T.regime(prev.features.regime.regime)} → ${T.regime(reg.regime)}`);
    if (prev?.features?.regime && Math.abs(prev.features.regime.confidence - reg.confidence) >= 10) changed.push(`Confiance ${prev.features.regime.confidence} % → ${reg.confidence} %`);
    if (prev?.features?.temperature && isNum(prev.features.temperature.value) && Math.abs(prev.features.temperature.value - f.temperature.value) >= 8) changed.push(`Météo ${prev.features.temperature.value} → ${f.temperature.value}`);
    const btc = f.byCoin.BTC?.d1;
    set($("#market-body"), html`
      <div class="grid c2">
        <div class="card accent"><h3>Régime de marché ${prov(reg.prov)} <span class="tag">incertitude ${T.unc(reg.uncertainty)}</span></h3>
          <div class="big" style="font-size:22px">${T.regime(reg.regime)}</div>
          <div class="sub2">Confiance ${reg.confidence} % · volatilité ${T.vol(reg.expectedVol)} · tendance BTC ${btc ? (btc.trendScore > 0 ? "positive" : btc.trendScore < 0 ? "négative" : "plate") : "—"} · largeur alts ${isNum(f.breadth) ? (f.breadth > 0.6 ? "forte" : f.breadth > 0.4 ? "mitigée" : "faible") + " (" + Math.round(f.breadth * 100) + " %)" : "—"} · changement de régime ${reg.changeProbability} %</div>
          <div style="margin-top:10px"><div class="hint"><b>Ce qui a changé</b></div>${changed.length ? list(changed) : html`<div class="hint">Rien de significatif depuis la dernière analyse${prev ? "" : " (première analyse de la session)"}.</div>`}</div>
          <div style="margin-top:8px"><div class="hint"><b>Ce qui compte</b></div>${list(reg.drivers)}</div>
          ${more("Ce qui invaliderait ce régime", list(reg.invalidation))}
          ${more("Scores de tous les régimes", raw(`<div class="tbl-wrap"><table class="tbl"><tbody>${Object.entries(reg.scores).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<tr><td class="t">${esc(T.regime(k))}</td><td class="r">${(v * 100).toFixed(0)} %</td><td style="width:40%"><div class="bar"><i style="width:${(v * 100).toFixed(0)}%"></i></div></td></tr>`).join("")}</tbody></table></div>`))}
        </div>
        <div class="card"><h3>Météo du marché ${prov(f.temperature.prov)}</h3>
          <div class="rowring">${ring(f.temperature.value, "sur 100", f.temperature.value >= 60 ? "var(--hot)" : f.temperature.value < 40 ? "var(--info)" : "var(--accent)")}<div><div class="big" style="font-size:22px">${T.temp(f.temperature.label)}</div><div class="sub2">0 panique · 40–60 neutre · 100 euphorie</div></div></div>
          ${more("Composantes", raw(f.temperature.components.map((c) => `<div class="kv"><span class="k">${esc(c.name)}</span><span class="v">${Math.round(c.value * 100)} <span class="dimc">×${c.weight}</span></span></div>`).join("")))}
          <h3 style="margin-top:14px">Rotation des narratifs ${prov("HISTORICAL")}</h3>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Secteur</th><th class="r">7 j vs BTC</th><th class="r">30 j vs BTC</th><th>Volume</th></tr></thead><tbody>${raw(f.narratives.map((n) => `<tr><td class="t">${esc(n.sector)} <span class="dimc">${esc(n.coins.join(" "))}</span></td><td class="r ${n.rel7d > 0 ? "pos" : "neg"}">${esc(fmt.pct(n.rel7d, 1, true))}</td><td class="r ${n.rel30d > 0 ? "pos" : "neg"}">${esc(fmt.pct(n.rel30d, 1, true))}</td><td class="t">${n.volumeConfirm === null ? "—" : n.volumeConfirm ? "confirmé" : "non confirmé"}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">Historique insuffisant</td></tr>')}</tbody></table></div>
          <div class="hint">Un narratif ne suffit jamais : il doit être confirmé par les flux, le prix et le volume.</div>
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        ${more("Carte de chaleur du funding", raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Actif</th><th class="r">Maintenant /j</th><th class="r">24 h</th><th class="r">7 j</th><th class="r">30 j</th><th class="r">z</th><th>Squeeze</th></tr></thead><tbody>${fl.heatmap.map((h) => `<tr><td class="t"><b>${esc(h.coin)}</b></td><td class="r"><span class="heat" style="background:${heatColor(h.z)}">${esc(fmt.bp(h.now * 24, 1))}</span></td><td class="r">${esc(fmt.bp(h.h24 * 24, 1))}</td><td class="r">${esc(fmt.bp(h.d7 * 24, 1))}</td><td class="r">${esc(fmt.bp(h.d30 * 24, 1))}</td><td class="r">${isNum(h.z) ? h.z.toFixed(1) : "—"}</td><td class="t">${h.squeezeProb ? Math.round(h.squeezeProb * 100) + " % " + esc(h.squeezeSide) : "—"}</td></tr>`).join("")}</tbody></table></div><div class="hint">Taux par jour (taux horaire Hyperliquid × 24). Positif = les longs paient.</div>`))}
        ${more("Intérêt ouvert et anomalies", raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Actif</th><th class="r">Intérêt ouvert</th><th class="r">Volume 24 h</th><th class="r">IO/Vol</th><th class="r">24 h</th></tr></thead><tbody>${fl.oiStress.map((r) => `<tr><td class="t"><b>${esc(r.coin)}</b></td><td class="r">${esc(fmt.usd(r.oiUsd))}</td><td class="r">${esc(fmt.usd(r.vol24))}</td><td class="r ${r.ratio > 1.2 ? "warnc" : ""}">${r.ratio.toFixed(2)}</td><td class="r ${r.change24h > 0 ? "pos" : "neg"}">${esc(fmt.pct(r.change24h, 1, true))}</td></tr>`).join("")}</tbody></table></div><div style="margin-top:10px">${f.anomalies.length ? list(f.anomalies.map((x) => x.text)).s : '<div class="hint">Aucune anomalie statistique (|z| ≥ 2) sur les actifs suivis.</div>'}</div>`))}
        ${more("Ce que le système ne sait pas (INCONNU)", list(fl.unknown))}
      </div>`);
    sum("market", `${T.regime(reg.regime)} · météo ${isNum(f.temperature.value) ? f.temperature.value : "—"}`);
  };

  AOS.views = Object.assign(AOS.views || {}, V);
})(typeof window !== "undefined" ? window : globalThis);
