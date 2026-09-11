/* Alpha OS — aides DOM partagées par les vues (texte en français via AOS.i18n) */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, fmt, escapeHtml, clamp } = AOS.util;
  const T = AOS.i18n;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = escapeHtml;

  const Raw = class { constructor(s) { this.s = s; } toString() { return this.s; } };
  const raw = (s) => new Raw(s);
  function html(strings, ...vals) {
    let out = "";
    strings.forEach((s, i) => { out += s; if (i < vals.length) { const v = vals[i]; out += v instanceof Raw ? v.s : Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.s : esc(x))).join("") : v === null || v === undefined ? "" : esc(v); } });
    return raw(out);
  }
  const set = (el, content) => { if (el) el.innerHTML = String(content); };
  const sum = (id, text) => { const el = document.getElementById("sum-" + id); if (el) el.textContent = text || ""; };

  const priv = (s) => raw(`<span data-private>${s instanceof Raw ? s.s : esc(s)}</span>`);
  const usd = (x, d = 0) => priv(fmt.usd(x, d));
  const usdS = (x, d = 0) => raw(`<span data-private class="${x > 0 ? "pos" : x < 0 ? "neg" : ""}">${esc(fmt.usdSigned(x, d))}</span>`);
  const pct = (x, d = 1, signed = false) => raw(`<span class="${signed ? (x > 0 ? "pos" : x < 0 ? "neg" : "") : ""}">${esc(fmt.pct(x, d, signed))}</span>`);
  const px = (x) => esc(fmt.px(x));
  const tag = (text, kind = "") => raw(`<span class="tag ${esc(kind)}">${esc(text)}</span>`);
  const prov = (p) => raw(`<span class="prov" title="Provenance de la donnée">${esc(T.prov(p || "UNKNOWN"))}</span>`);
  const levelKind = (level) => ({ NORMAL: "ok", WATCH: "warn", STRESSED: "hot", DANGER: "bad", CRITICAL: "crit" }[level] || "");
  const lvlTag = (level) => tag(T.level(level || "UNKNOWN"), levelKind(level));
  const sideTag = (side) => tag(side, side === "LONG" ? "long" : "short");
  const verdictTag = (v) => raw(`<span class="verdict ${esc((v || "").replace(" ", ""))}">${esc(T.verdict(v || "—"))}</span>`);
  const kv = (k, v, opts = {}) => raw(`<div class="kv"><span class="k">${esc(k)}${opts.prov ? prov(opts.prov) : ""}</span><span class="v ${opts.cls || ""}">${v instanceof Raw ? v.s : esc(v)}</span></div>`);
  /** chevron dépliable */
  const more = (title, body, open = false) => raw(`<details class="more"${open ? " open" : ""}><summary>${esc(title)}</summary><div class="body">${body instanceof Raw ? body.s : esc(body)}</div></details>`);
  const list = (items) => raw(`<ul>${(items || []).map((i) => `<li>${i instanceof Raw ? i.s : esc(i)}</li>`).join("")}</ul>`);
  const json = (o) => raw(`<pre class="json">${esc(JSON.stringify(o, (k, v) => (typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null) : v), 2))}</pre>`);
  const num = (x, d = 2) => esc(isNum(x) ? x.toFixed(d) : "—");
  const heatColor = (z) => { if (!isNum(z)) return "rgba(255,255,255,.05)"; const a = Math.min(Math.abs(z) / 3, 1); return z > 0 ? `rgba(240,106,126,${0.12 + 0.5 * a})` : `rgba(69,211,154,${0.12 + 0.5 * a})`; };
  const on = (root, evt, sel, fn) => root.addEventListener(evt, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });
  /** jauge circulaire 0–100 */
  const ring = (value, label, color = "var(--accent)", text) => {
    const v = isNum(value) ? clamp(value, 0, 100) : 0;
    const r = 40, c = 2 * Math.PI * r;
    return raw(`<div class="ring" role="img" aria-label="${esc(label)} ${esc(isNum(value) ? Math.round(value) : "—")}"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="${r}"/><circle class="val" cx="50" cy="50" r="${r}" style="stroke:${esc(color)};stroke-dasharray:${c.toFixed(1)};stroke-dashoffset:${(c * (1 - v / 100)).toFixed(1)}"/></svg><div class="lbl">${esc(text !== undefined ? text : isNum(value) ? Math.round(value) : "—")}<small>${esc(label)}</small></div></div>`);
  };
  const levelColor = (level) => ({ NORMAL: "var(--ok)", WATCH: "var(--warn)", STRESSED: "var(--hot)", DANGER: "var(--bad)", CRITICAL: "var(--crit)" }[level] || "var(--dim)");

  AOS.dom = { $, $$, esc, raw, html, set, sum, priv, usd, usdS, pct, px, tag, prov, lvlTag, levelKind, levelColor, sideTag, verdictTag, kv, more, why: more, list, json, num, heatColor, on, ring, Raw };
})(typeof window !== "undefined" ? window : globalThis);
