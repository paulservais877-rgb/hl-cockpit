/* Personal Alpha OS — couche de traduction : les moteurs parlent en clés (anglais), l'interface parle français. */
(function (root) {
  "use strict";
  const AOS = (root.AOS = root.AOS || {});

  const LEVEL = { NORMAL: "NORMAL", WATCH: "VIGILANCE", STRESSED: "TENDU", DANGER: "DANGER", CRITICAL: "CRITIQUE", UNKNOWN: "INCONNU", LIQUIDATION: "LIQUIDATION", SAFE: "SÛR" };
  const LEVEL_SHORT = { SAFE: "S", WATCH: "V", STRESSED: "T", DANGER: "D", CRITICAL: "C", LIQUIDATION: "LIQ" };
  const VERDICT = { KEEP: "GARDER", INCREASE: "RENFORCER", REDUCE: "RÉDUIRE", EXIT: "SORTIR", HEDGE: "COUVRIR", "NO EDGE": "SANS AVANTAGE" };
  const REGIME = { "Bull Expansion": "Expansion haussière", "Bull Exhaustion": "Épuisement haussier", "Distribution": "Distribution", "Panic Deleveraging": "Panique / désendettement", "Compression": "Compression", "Re-Accumulation": "Ré-accumulation", "Bear Expansion": "Expansion baissière", "Short Squeeze": "Squeeze des vendeurs", "Mean-Reversion Regime": "Retour à la moyenne", UNKNOWN: "Inconnu" };
  const TEMP = { PANIC: "PANIQUE", FEAR: "PEUR", NEUTRAL: "NEUTRE", "RISK-ON": "APPÉTIT", EUPHORIA: "EUPHORIE", UNKNOWN: "INCONNU" };
  const GATE = { EDGE: "AVANTAGE", PORTFOLIO: "PORTEFEUILLE", LIQUIDITY: "LIQUIDITÉ", FUNDING: "FUNDING", CORRELATION: "CORRÉLATION", LIQUIDATION: "LIQUIDATION", SENTINEL: "SENTINELLE" };
  const PROV = { LIVE: "DIRECT", CALCULATED: "CALCULÉ", HISTORICAL: "HISTORIQUE", ESTIMATED: "ESTIMÉ", UNKNOWN: "INCONNU", "LIVE+CALCULATED": "DIRECT+CALCULÉ", "LIVE+HISTORICAL": "DIRECT+HISTORIQUE", DEGRADED: "DÉGRADÉ", PARTIAL: "PARTIEL" };
  const SYNC = { LIVE: "EN DIRECT", SYNCING: "SYNCHRO", STALE: "PÉRIMÉ", DEGRADED: "DÉGRADÉ", ERROR: "ERREUR", IDLE: "EN ATTENTE" };
  const DIR = { bullish: "HAUSSIER", bearish: "BAISSIER", neutral: "NEUTRE", "n/a": "—" };
  const BIAS = { BULL: "haussier", BEAR: "baissier", NEUTRAL: "neutre" };
  const VOL = { HIGH: "élevée", MODERATE: "modérée", LOW: "faible", UNKNOWN: "inconnue" };
  const UNC = { LOW: "faible", MEDIUM: "moyenne", HIGH: "forte" };
  const SETUP = { trendPullback: "Repli dans la tendance", breakout: "Cassure", failedBreakout: "Fausse cassure / balayage", meanReversion: "Retour à la moyenne", fundingSqueeze: "Squeeze de funding" };
  const STATUS = { APPROVED: "APPROUVÉ", REJECTED: "REFUSÉ", VETO: "VETO" };
  const AGENT = {
    ORACLE: { name: "ORACLE", glyph: "◉", role: "Régime de marché", color: "#8fb3ff", short: "Lit le régime : tendance, volatilité, momentum." },
    FLOW: { name: "FLUX", glyph: "≈", role: "Positionnement & funding", color: "#6fd3b0", short: "Regarde où est le capital : funding, intérêt ouvert, carnet." },
    EDGE: { name: "CHASSEUR", glyph: "◆", role: "Chercheur de configurations", color: "#c8b283", short: "Cherche les asymétries et calcule l'espérance après coûts." },
    ALLOCATOR: { name: "ALLOCATEUR", glyph: "⚖", role: "Portefeuille", color: "#b39ddb", short: "Juge chaque trade par son effet sur tout le livre." },
    SENTINEL: { name: "SENTINELLE", glyph: "▲", role: "Risque · veto absolu", color: "#f06a7e", short: "Cherche à prouver que le trade est mauvais. Peut tout bloquer." },
    ARCHIVE: { name: "ARCHIVE", glyph: "▤", role: "Mémoire & apprentissage", color: "#e6b450", short: "Mesure si tes décisions créent vraiment de l'alpha." },
  };
  const REC = {
    "LONG BIAS": "Biais haussier", "SHORT BIAS / REDUCE": "Biais baissier · réduire", NEUTRAL: "Neutre", "LONG TILT": "Penchant haussier", "SHORT TILT": "Penchant baissier",
    "NO TRADE": "Aucun trade", REBALANCE: "Rééquilibrer", "HOLD STRUCTURE": "Garder la structure", "VETO — NO RISK INCREASE": "VETO · aucune hausse de risque", "REDUCE ONLY": "Réduction seulement",
    "SMALL SIZE ONLY": "Petite taille seulement", CLEARED: "Feu vert", "REDUCE ACTIVITY (espérance négative)": "Réduire l'activité (espérance négative)", "CONTINUE MEASURING": "Continuer à mesurer",
  };
  const ACTION_KIND = { RISK: "Risque", REBALANCE: "Rééquilibrage", TRADE: "Opportunité", NO_TRADE: "Aucun trade" };

  const pick = (m, k, fallback) => (k in m ? m[k] : fallback !== undefined ? fallback : k);
  const rec = (s) => { if (!s) return "—"; if (REC[s]) return REC[s]; const m = s.match(/^(LONG|SHORT) (\w+)$/); if (m) return `${m[1]} ${m[2]}`; return s; };

  AOS.i18n = {
    level: (k) => pick(LEVEL, k), levelShort: (k) => pick(LEVEL_SHORT, k, pick(LEVEL, k)), verdict: (k) => pick(VERDICT, k), regime: (k) => pick(REGIME, k), temp: (k) => pick(TEMP, k), gate: (k) => pick(GATE, k),
    prov: (k) => pick(PROV, k || "UNKNOWN"), sync: (k) => pick(SYNC, k), dir: (k) => pick(DIR, k), bias: (k) => pick(BIAS, k), vol: (k) => pick(VOL, k), unc: (k) => pick(UNC, k), setup: (k) => pick(SETUP, k), status: (k) => pick(STATUS, k),
    agent: (k) => AGENT[k] || { name: k, glyph: "•", role: "", color: "#8b93a7", short: "" }, rec, actionKind: (k) => pick(ACTION_KIND, k),
    side: (s) => (s === "LONG" ? "LONG" : s === "SHORT" ? "SHORT" : s), // jargon conservé volontairement
    tables: { LEVEL, VERDICT, REGIME, TEMP, GATE, PROV, SYNC, AGENT, SETUP },
  };
})(typeof window !== "undefined" ? window : globalThis);
