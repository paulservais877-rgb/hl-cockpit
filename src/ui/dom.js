/* Personal Alpha OS — DOM helpers shared by UI modules */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const { isNum, fmt, escapeHtml } = AOS.util;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = escapeHtml;

  /** html tagged template: values are escaped unless wrapped in raw() */
  const Raw = class { constructor(s) { this.s = s; } toString() { return this.s; } };
  const raw = (s) => new Raw(s);
  function html(strings, ...vals) {
    let out = "";
    strings.forEach((s, i) => { out += s; if (i < vals.length) { const v = vals[i]; out += v instanceof Raw ? v.s : Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.s : esc(x))).join("") : v === null || v === undefined ? "" : esc(v); } });
    return raw(out);
  }
  const set = (el, content) => { if (el) el.innerHTML = String(content); };

  // formatting helpers with provenance & privacy
  const priv = (s) => raw(`<span data-private>${s instanceof Raw ? s.s : esc(s)}</span>`);
  const usd = (x, d = 0) => priv(fmt.usd(x, d));
  const usdS = (x, d = 0) => raw(`<span data-private class="${x > 0 ? "pos" : x < 0 ? "neg" : ""}">${esc(fmt.usdSigned(x, d))}</span>`);
  const pct = (x, d = 1, signed = false) => raw(`<span class="${signed ? (x > 0 ? "pos" : x < 0 ? "neg" : "") : ""}">${esc(fmt.pct(x, d, signed))}</span>`);
  const px = (x) => esc(fmt.px(x));
  const tag = (text, kind = "") => raw(`<span class="tag ${esc(kind)}">${esc(text)}</span>`);
  const prov = (p) => raw(`<span class="prov" title="Provenance de la donnée">${esc(p || "UNKNOWN")}</span>`);
  const lvlTag = (level) => tag(level || "UNKNOWN", { NORMAL: "ok", WATCH: "warn", STRESSED: "warn", DANGER: "bad", CRITICAL: "crit" }[level] || "");
  const sideTag = (side) => tag(side, side === "LONG" ? "long" : "short");
  const kv = (k, v, opts = {}) => raw(`<div class="kv"><span class="k">${esc(k)}${opts.prov ? prov(opts.prov) : ""}</span><span class="v ${opts.cls || ""}">${v instanceof Raw ? v.s : esc(v)}</span></div>`);
  const why = (title, body, open = false) => raw(`<details class="why"${open ? " open" : ""}><summary>${esc(title)}</summary><div class="body">${body instanceof Raw ? body.s : esc(body)}</div></details>`);
  const list = (items) => raw(`<ul>${(items || []).map((i) => `<li>${i instanceof Raw ? i.s : esc(i)}</li>`).join("")}</ul>`);
  const json = (o) => raw(`<pre class="json">${esc(JSON.stringify(o, (k, v) => (typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null) : v), 2))}</pre>`);
  const num = (x, d = 2) => esc(isNum(x) ? x.toFixed(d) : "—");
  const heatColor = (z) => { if (!isNum(z)) return "rgba(255,255,255,.05)"; const a = Math.min(Math.abs(z) / 3, 1); return z > 0 ? `rgba(240,106,126,${0.12 + 0.5 * a})` : `rgba(69,211,154,${0.12 + 0.5 * a})`; };
  const on = (root, evt, sel, fn) => root.addEventListener(evt, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });

  AOS.dom = { $, $$, esc, raw, html, set, priv, usd, usdS, pct, px, tag, prov, lvlTag, sideTag, kv, why, list, json, num, heatColor, on, Raw };
})(typeof window !== "undefined" ? window : globalThis);
