/* Alpha OS — palette « Velvet » par actif (héritée de Cryptex) : une couleur canonique par monnaie,
   un repli déterministe (teinte dérivée du symbole) pour tout le reste. Le sens LONG/SHORT garde ses propres couleurs. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});
  const VELVET = {
    BTC: "#F5A623", ETH: "#627EEA", ADA: "#C77DFF", SOL: "#7B8FE0", HYPE: "#AFA9EC", TAO: "#FFB347", WLD: "#B0B7C3",
    DOGE: "#C2A633", XRP: "#3FB4E6", AVAX: "#E84142", LINK: "#2A5ADA", SUI: "#4DA2FF", ARB: "#12AAFF", OP: "#FF4A3D", BNB: "#F3BA2F",
    LTC: "#BFBBBB", DOT: "#E6007A", NEAR: "#00EC97", APT: "#2DD8A3", TIA: "#7B2BF9", PEPE: "#3E8F3A", kPEPE: "#3E8F3A", WIF: "#C48A5A",
    AAVE: "#B6509E", UNI: "#FF007A", ATOM: "#6F7390", INJ: "#00C2FF", SEI: "#9E1F63", TRX: "#EF0027", TON: "#0098EA", FIL: "#0090FF", ENA: "#7DD3FC", ONDO: "#8FA3FF", PENDLE: "#4F8CFF", JUP: "#C7F284", RENDER: "#E33B3B", LDO: "#F69988", CRV: "#F5D257", MKR: "#1AAB9B", FET: "#4B6EAF", AR: "#222326", STX: "#5546FF", ORDI: "#F7931A", kBONK: "#F5A623", kSHIB: "#F1A62A",
  };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const hslToHex = (h, s, l) => { const f = (n) => { const k = (n + h / 30) % 12; const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, "0"); }; return "#" + f(0) + f(8) + f(4); };
  const color = (coin) => { const c = String(coin || "").toUpperCase(); if (VELVET[coin]) return VELVET[coin]; if (VELVET[c]) return VELVET[c]; return hslToHex(hash(c) % 360, 0.55, 0.68); };
  const rgb = (coin) => { const h = color(coin); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; };
  const rgba = (coin, a) => `rgba(${rgb(coin).join(",")},${a})`;
  const dot = (coin) => `<i class="cdot" style="background:${color(coin)}" aria-hidden="true"></i>`;
  AOS.palette = { VELVET, color, rgb, rgba, dot };
})(typeof window !== "undefined" ? window : globalThis);
