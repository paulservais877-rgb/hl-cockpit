/* Alpha OS — Simulateur (actif · sens · quantité · entrée facultative) et moteur « Et si… » */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, fmt, num } = AOS.util;
  const T = AOS.i18n, D = AOS.dom;
  const { html, raw, set, sum, $, tag, lvlTag, more, list, esc } = D;

  // deux entrées, un seul moteur : « quantité » (Alpha OS) ou « marge × levier » (Cryptex). La quantité effective est toujours affichée.
  const sim = { mode: "QTY", coin: "BTC", side: "LONG", qty: NaN, margin: NaN, lev: NaN, entry: NaN, inv: { mode: "ACCEPT", value: NaN }, tgt: { mode: "ACCEPT", value: NaN } };
  let analysis = null;

  function markFor(coin) { const a = analysis?.snapshot?.meta?.assets?.[coin] || {}; return isNum(sim.entry) ? sim.entry : isNum(a.markPx) ? a.markPx : num(analysis?.snapshot?.mids?.[coin]); }
  function defaultLev(coin) { const held = analysis?.snapshot?.positions?.find((p) => p.coin === coin); const mx = analysis?.snapshot?.meta?.assets?.[coin]?.maxLeverage || 5; return Math.min(isNum(held?.leverage) && held.leverage > 0 ? held.leverage : 5, mx); }
  /** quantité effective selon le mode ; en mode marge, qty = marge × levier / prix */
  function effectiveQty() {
    if (sim.mode === "QTY") return sim.qty;
    const mark = markFor(sim.coin), lev = isNum(sim.lev) ? sim.lev : defaultLev(sim.coin);
    return isNum(sim.margin) && sim.margin > 0 && isNum(mark) && mark > 0 ? (sim.margin * lev) / mark : NaN;
  }

  function coinsList() {
    const a = analysis?.snapshot?.meta?.assets || {};
    const held = (analysis?.snapshot?.positions || []).map((p) => p.coin);
    const wl = AOS.store.settings.watchlist || [];
    const pref = [...new Set([...held, "BTC", "ETH", "SOL", ...wl])].filter((c) => !Object.keys(a).length || a[c]);
    const rest = Object.keys(a).filter((c) => !pref.includes(c)).sort();
    return [...pref, ...rest];
  }

  function renderForm() {
    const coins = coinsList();
    if (!coins.includes(sim.coin)) sim.coin = coins[0] || "BTC";
    const maxLev = analysis?.snapshot?.meta?.assets?.[sim.coin]?.maxLeverage || 50;
    const lev = isNum(sim.lev) ? sim.lev : defaultLev(sim.coin);
    const levOptions = [1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50].filter((x) => x <= maxLev); if (!levOptions.includes(lev)) levOptions.push(lev); levOptions.sort((a, b) => a - b);
    const q = effectiveQty(), mark = markFor(sim.coin);
    set($("#sim-form"), html`
      <div class="seg mode" style="margin-bottom:10px"><button id="sim-m-qty" aria-pressed="${sim.mode === "QTY"}">QUANTITÉ</button><button id="sim-m-margin" aria-pressed="${sim.mode === "MARGIN"}">MARGE × LEVIER</button></div>
      <div class="form c4">
        <div class="field"><label>Actif</label><select id="sim-coin">${raw(coins.map((c) => `<option ${c === sim.coin ? "selected" : ""}>${esc(c)}</option>`).join(""))}</select></div>
        <div class="field"><label>Sens</label><div class="seg"><button class="l" id="sim-long" aria-pressed="${sim.side === "LONG"}">LONG</button><button class="s" id="sim-short" aria-pressed="${sim.side === "SHORT"}">SHORT</button></div></div>
        ${sim.mode === "QTY"
          ? html`<div class="field"><label>Quantité (${sim.coin})</label><input id="sim-qty" inputmode="decimal" placeholder="ex. 0.25" value="${isNum(sim.qty) ? sim.qty : ""}"/></div>`
          : html`<div class="field"><label>Marge engagée ($)</label><input id="sim-margin" inputmode="decimal" placeholder="ex. 500" value="${isNum(sim.margin) ? sim.margin : ""}"/></div><div class="field"><label>Levier (max ${maxLev}×)</label><select id="sim-lev">${raw(levOptions.map((x) => `<option value="${x}" ${x === lev ? "selected" : ""}>${x}×</option>`).join(""))}</select></div>`}
        <div class="field"><label>Entrée (facultatif)</label><input id="sim-entry" inputmode="decimal" placeholder="prix du marché" value="${isNum(sim.entry) ? sim.entry : ""}"/></div>
        ${sim.mode === "MARGIN" ? html`<div class="field"><label>Quantité déduite</label><div class="calc">${isNum(q) ? `${fmt.qty(q)} ${sim.coin} · notional ${fmt.usd(q * mark)}` : "—"}</div></div>` : ""}
      </div>`);
    $("#sim-m-qty").addEventListener("click", () => { if (sim.mode !== "QTY") { sim.mode = "QTY"; sim.qty = isNum(sim.qty) ? sim.qty : Number((effectiveQty() || NaN).toPrecision(4)); renderForm(); renderResult(); } });
    $("#sim-m-margin").addEventListener("click", () => { if (sim.mode !== "MARGIN") { sim.mode = "MARGIN"; if (!isNum(sim.margin) && isNum(sim.qty) && isNum(mark)) { sim.lev = defaultLev(sim.coin); sim.margin = Math.round((sim.qty * mark) / sim.lev); } renderForm(); renderResult(); } });
    $("#sim-coin").addEventListener("change", (e) => { sim.coin = e.target.value; sim.lev = NaN; sim.inv = { mode: "ACCEPT", value: NaN }; sim.tgt = { mode: "ACCEPT", value: NaN }; renderForm(); renderResult(); });
    $("#sim-long").addEventListener("click", () => { sim.side = "LONG"; sim.inv.mode = "ACCEPT"; sim.tgt.mode = "ACCEPT"; renderForm(); renderResult(); });
    $("#sim-short").addEventListener("click", () => { sim.side = "SHORT"; sim.inv.mode = "ACCEPT"; sim.tgt.mode = "ACCEPT"; renderForm(); renderResult(); });
    $("#sim-qty")?.addEventListener("input", (e) => { sim.qty = num(e.target.value); renderResult(); });
    $("#sim-margin")?.addEventListener("input", (e) => { sim.margin = num(e.target.value); renderCalc(); renderResult(); });
    $("#sim-lev")?.addEventListener("change", (e) => { sim.lev = num(e.target.value); renderCalc(); renderResult(); });
    $("#sim-entry").addEventListener("input", (e) => { sim.entry = num(e.target.value); renderCalc(); renderResult(); });
  }
  function renderCalc() { const el = $("#sim-form .calc"); if (!el) return; const q = effectiveQty(), mark = markFor(sim.coin); el.textContent = isNum(q) ? `${fmt.qty(q)} ${sim.coin} · notional ${fmt.usd(q * mark)}` : "—"; }

  function suggestRow(id, label, sug, why, state) {
    const val = state.mode === "EDIT" && isNum(state.value) ? state.value : state.mode === "IGNORE" ? NaN : sug;
    return { html: html`<div class="suggest" id="${id}"><span class="dimc">${label}</span><span class="v">${state.mode === "IGNORE" ? "—" : fmt.px(val)}</span><span class="hint">${why}</span><span class="acts"><button data-m="ACCEPT" aria-pressed="${state.mode === "ACCEPT"}">ACCEPTER</button><button data-m="EDIT" aria-pressed="${state.mode === "EDIT"}">MODIFIER</button><button data-m="IGNORE" aria-pressed="${state.mode === "IGNORE"}">IGNORER</button></span>${state.mode === "EDIT" ? html`<input class="mono" style="width:100%;margin-top:6px;min-height:38px;padding:6px 10px;border-radius:8px;border:1px solid var(--line-2);background:rgba(0,0,0,.3);color:var(--text)" inputmode="decimal" value="${isNum(state.value) ? state.value : sug.toFixed(2)}" data-edit/>` : ""}</div>`, value: val };
  }

  function renderResult() {
    const out = $("#sim-result");
    const qty = effectiveQty();
    if (!analysis || !isNum(qty) || qty <= 0) { set(out, html`<div class="hint">${sim.mode === "QTY" ? "Choisis un actif, un sens et une quantité." : "Choisis un actif, un sens, une marge et un levier."} Le moteur déduit le reste : frais, funding, marge, liquidation, effet sur le portefeuille.</div>`); sum("simulator", ""); return; }
    const a = analysis;
    const trade = { coin: sim.coin, side: sim.side, qty, entry: isNum(sim.entry) ? sim.entry : undefined, leverage: sim.mode === "MARGIN" ? (isNum(sim.lev) ? sim.lev : defaultLev(sim.coin)) : undefined };
    const asset = a.snapshot.meta.assets[sim.coin] || {};
    const mark = isNum(trade.entry) ? trade.entry : asset.markPx ?? num(a.snapshot.mids[sim.coin]);
    if (!isNum(mark)) { set(out, html`<div class="banner bad">Prix inconnu pour ${sim.coin}.</div>`); return; }
    const sug = AOS.simulate.suggestLevels(trade, a.features, mark);
    const invRow = suggestRow("sim-inv", "Invalidation suggérée", sug.invalidation, sug.invalidationWhy, sim.inv);
    const tgtRow = suggestRow("sim-tgt", "Objectif suggéré", sug.target, sug.targetWhy, sim.tgt);
    const levels = { invalidation: invRow.value, target: tgtRow.value };
    const opp = (a.agents.EDGE.opportunities || []).find((o) => o.coin === sim.coin && o.side === sim.side);
    const imp = AOS.simulate.impact(a.snapshot, a.features, { portfolio: a.portfolio, risk: a.risk }, { ...trade, pWin: opp?.pWin, horizonDays: opp?.horizonDays }, levels, AOS.store.settings);
    if (!imp) { set(out, html`<div class="banner bad">Simulation impossible.</div>`); return; }
    const d = imp.deltas;
    // « position couverte » (Cryptex) : la marge libre actuelle couvre tout le notional → aucune liquidation possible par cet actif seul
    const covered = isNum(a.snapshot.account.availableMargin) && imp.notional <= a.snapshot.account.availableMargin && (!isNum(imp.newLiqDist) || imp.newLiqDist >= 1);
    set(out, html`
      ${covered ? html`<div class="suggest" style="margin-bottom:8px;border-style:solid;border-color:rgba(69,211,154,.4)"><span class="tag ok">POSITION COUVERTE</span><span class="hint">La marge libre (${fmt.usd(a.snapshot.account.availableMargin)}) couvre tout le notional (${fmt.usd(imp.notional)}) : cet actif seul ne peut pas liquider le compte.</span></div>` : ""}
      ${invRow.html}<div style="height:8px"></div>${tgtRow.html}
      <div class="mini" style="margin-top:12px">
        <div class="m"><div class="k">Perte si invalidé</div><div class="v neg" data-private>${isNum(imp.lossIfInvalidated) ? fmt.usdSigned(imp.lossIfInvalidated) : "—"}</div><div class="hint">${isNum(imp.lossIfInvalidated) && isNum(a.snapshot.account.equity) ? fmt.pct(imp.lossIfInvalidated / a.snapshot.account.equity, 2) + " de l'equity" : ""}</div></div>
        <div class="m"><div class="k">Gain à l'objectif</div><div class="v pos" data-private>${isNum(imp.gainAtTarget) ? fmt.usdSigned(imp.gainAtTarget) : "—"}</div></div>
        <div class="m"><div class="k">Risque / gain</div><div class="v">${isNum(imp.rr) ? imp.rr.toFixed(2) : "—"}</div><div class="hint">espérance ${isNum(imp.ev) ? fmt.usdSigned(imp.ev) : "—"} (p ${Math.round(imp.pWin * 100)} %${opp ? ", Chasseur" : ", neutre"})</div></div>
        <div class="m"><div class="k">Nouvelle liquidation</div><div class="v">${fmt.px(imp.newLiq)}</div><div class="hint">distance ${fmt.pct(imp.newLiqDist, 1)}</div></div>
        <div class="m"><div class="k">Nouveau risque portefeuille</div><div class="v lvl-${imp.newLevel}">${T.level(imp.newLevel)}</div><div class="hint">avant : ${T.level(imp.oldLevel)}</div></div>
        <div class="m"><div class="k">Nouvelle marge utilisée</div><div class="v ${imp.marginOk ? "" : "neg"}">${fmt.pct(imp.newMarginUtil, 0)}</div><div class="hint">${imp.marginOk ? "avant " + fmt.pct(imp.oldMarginUtil, 0) : "MARGE INSUFFISANTE"}</div></div>
        <div class="m"><div class="k">Notional · frais</div><div class="v" data-private>${fmt.usd(imp.notional)}</div><div class="hint">frais A/R ${fmt.usd(imp.fees, 2)} · funding ${imp.horizonDays} j ${fmt.usdSigned(-imp.fundingCost, 2)}</div></div>
        <div class="m"><div class="k">Δ perte au choc simultané</div><div class="v ${d.stressLoss < 0 ? "neg" : "pos"}" data-private>${fmt.usdSigned(d.stressLoss)}</div></div>
      </div>
      ${more("PnL selon des scénarios BTC", raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Scénario</th><th class="r">Avant</th><th class="r">Après</th><th>Niveau</th></tr></thead><tbody>${imp.scenarios.map((s) => `<tr><td class="t">${esc(s.label)}</td><td class="r" data-private>${esc(fmt.usdSigned(s.before))}</td><td class="r ${s.after < s.before ? "neg" : "pos"}" data-private>${esc(fmt.usdSigned(s.after))}</td><td>${lvlTag(s.level).s}</td></tr>`).join("")}</tbody></table></div>`))}
      ${more("Ce trade améliore-t-il mon portefeuille ? (avant → après)", raw(`<div class="mini"><div class="m"><div class="k">Δ rendement attendu</div><div class="v" data-private>${esc(fmt.usdSigned(d.expectedReturn))}</div></div><div class="m"><div class="k">Δ CVaR 95 % (1 j)</div><div class="v" data-private>${esc(fmt.usdSigned(d.cvar))}</div></div><div class="m"><div class="k">Δ distance liquidation</div><div class="v">${esc(fmt.pct(d.liqRisk, 1, true))}</div></div><div class="m"><div class="k">Δ funding / jour</div><div class="v" data-private>${esc(fmt.usdSigned(d.funding, 2))}</div></div><div class="m"><div class="k">Δ corrélation</div><div class="v">${d.correlation.toFixed(3)}</div></div><div class="m"><div class="k">Δ exposition nette</div><div class="v" data-private>${esc(fmt.usdSigned(d.netExposure))}</div></div><div class="m"><div class="k">Δ exposition brute</div><div class="v" data-private>${esc(fmt.usdSigned(d.grossExposure))}</div></div><div class="m"><div class="k">Δ bêta BTC</div><div class="v">${d.betaBTC >= 0 ? "+" : ""}${d.betaBTC.toFixed(2)}</div></div></div><div class="hint" style="margin-top:8px">La question n'est pas « est-ce que ça monte ? » mais « est-ce que ce trade améliore mon portefeuille ? ». Levier utilisé : ${esc(fmt.x(imp.after.target?.leverage, 0))}.</div>`))}`);
    for (const [id, st] of [["#sim-inv", sim.inv], ["#sim-tgt", sim.tgt]]) {
      const el = $(id); if (!el) continue;
      el.querySelectorAll("button[data-m]").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.m; if (st.mode === "EDIT" && !isNum(st.value)) st.value = id === "#sim-inv" ? sug.invalidation : sug.target; renderResult(); }));
      const inp = el.querySelector("[data-edit]"); if (inp) { inp.addEventListener("change", () => { st.value = num(inp.value); renderResult(); }); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { st.value = num(inp.value); renderResult(); } }); }
    }
    sum("simulator", `${sim.side} ${fmt.qty(qty)} ${sim.coin}${sim.mode === "MARGIN" ? ` (${fmt.usd(sim.margin)} × ${trade.leverage}×)` : ""} → ${T.level(imp.newLevel)}`);
  }

  // ---- « Et si… » ---------------------------------------------------------------------------------
  const scen = { overrides: {}, text: "" };
  function renderScenario() {
    const a = analysis; if (!a) return;
    const pos = a.snapshot.positions;
    const wrap = $("#scen-body");
    set(wrap, html`
      <div class="field"><label>En français, comme tu veux</label><input id="scen-text" placeholder="BTC baisse de 12 %, ETH monte de 5 % et SOL vaut 150" value="${scen.text}"/></div>
      <div class="form c4" style="margin-top:8px">${raw(pos.map((p) => { const o = scen.overrides[p.coin] || {}; return `<div class="field"><label>${esc(p.coin)} <span class="dimc">${esc(fmt.px(p.mark))}</span></label><input data-scen="${esc(p.coin)}" inputmode="decimal" placeholder="prix ou ±%" value="${isNum(o.price) ? o.price : isNum(o.pct) ? (o.pct * 100).toFixed(1) + "%" : ""}"/></div>`; }).join("") || '<div class="hint">Aucune position à simuler.</div>')}</div>
      <div id="scen-result" style="margin-top:12px"></div>`);
    const apply = () => {
      const r = AOS.simulate.applyScenario(a.snapshot, scen.overrides, a.features);
      set($("#scen-result"), html`
        <div class="mini">
          <div class="m"><div class="k">PnL total</div><div class="v ${r.dPnl >= 0 ? "pos" : "neg"}" data-private>${fmt.usdSigned(r.dPnl)}</div></div>
          <div class="m"><div class="k">Equity</div><div class="v" data-private>${fmt.usd(r.equity1)}</div><div class="hint">${fmt.pct(isNum(r.equity0) && r.equity0 > 0 ? r.equity1 / r.equity0 - 1 : NaN, 1, true)}</div></div>
          <div class="m"><div class="k">Marge utilisée</div><div class="v">${fmt.pct(r.marginUtil1, 0)}</div><div class="hint">maintenance ${fmt.usd(r.mm1)}</div></div>
          <div class="m"><div class="k">Risque portefeuille</div><div class="v lvl-${r.level}">${r.liquidated ? "LIQUIDÉ" : T.level(r.level)}</div><div class="hint">coussin ${fmt.pct(r.bufferRatio, 0)}</div></div>
        </div>
        ${more("Détail par position", raw(`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Position</th><th class="r">Prix</th><th class="r">Mouv.</th><th class="r">Δ PnL</th><th class="r">PnL latent</th><th class="r">Dist. liq.</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td class="t">${esc(x.coin)} ${esc(x.side)}</td><td class="r">${esc(fmt.px(x.px1))}</td><td class="r ${x.move > 0 ? "pos" : x.move < 0 ? "neg" : ""}">${esc(fmt.pct(x.move, 1, true))}</td><td class="r ${x.pnlDelta >= 0 ? "pos" : "neg"}" data-private>${esc(fmt.usdSigned(x.pnlDelta))}</td><td class="r" data-private>${esc(fmt.usdSigned(x.upnl1))}</td><td class="r ${x.liquidatedAlone ? "neg" : x.liqDist1 < 0.1 ? "warnc" : ""}">${x.liquidatedAlone ? "LIQUIDÉE" : esc(fmt.pct(x.liqDist1, 1))}</td></tr>`).join("")}</tbody></table></div><div class="hint">Marge de maintenance recalculée aux nouveaux prix. Les actifs non renseignés restent au prix actuel.</div>`), Object.keys(scen.overrides).length > 0)}`);
      sum("scenario", Object.keys(scen.overrides).length ? `${fmt.usdSigned(r.dPnl)} · ${r.liquidated ? "LIQUIDÉ" : T.level(r.level)}` : "");
    };
    $("#scen-text").addEventListener("input", (e) => { scen.text = e.target.value; const parsed = AOS.simulate.parseScenario(scen.text, pos.map((p) => p.coin)); if (Object.keys(parsed).length) { scen.overrides = parsed; wrap.querySelectorAll("[data-scen]").forEach((i) => { const o = parsed[i.dataset.scen]; i.value = o ? (isNum(o.price) ? o.price : (o.pct * 100).toFixed(1) + "%") : ""; }); apply(); } });
    wrap.querySelectorAll("[data-scen]").forEach((i) => i.addEventListener("input", () => { const v = i.value.trim(); const c = i.dataset.scen; if (!v) delete scen.overrides[c]; else if (/%$/.test(v)) scen.overrides[c] = { pct: num(v.replace(/[%\s]/g, "").replace(",", ".").replace("−", "-")) / 100 }; else if (/^[+-]/.test(v)) scen.overrides[c] = { pct: num(v.replace("−", "-")) / 100 }; else scen.overrides[c] = { price: num(v.replace(",", ".")) }; apply(); }));
    apply();
  }

  function setAnalysis(a) { analysis = a; renderForm(); renderResult(); renderScenario(); }
  function prefill(card) { sim.mode = "QTY"; sim.coin = card.coin; sim.side = card.side; sim.qty = card.sizing ? Number(card.sizing.qty.toPrecision(4)) : sim.qty; sim.entry = NaN; sim.inv = { mode: "EDIT", value: card.invalidation }; sim.tgt = { mode: "EDIT", value: card.target }; renderForm(); renderResult(); const d = document.getElementById("simulator"); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth" }); } }

  AOS.simUI = { setAnalysis, prefill, state: sim };
})(typeof window !== "undefined" ? window : globalThis);
