# PERSONAL ALPHA OS — ARCHITECTURE V2

Repo : `paulservais877-rgb/hl-cockpit` · branche `claude/personal-alpha-os-design-7t5ga4`
Ce document remplace l'« audit » demandé dans le prompt maître : l'ancien dashboard n'est pas dans ce dépôt, et la consigne a été de repartir de zéro. Le seul héritage est `legacy/hl-cockpit-v5.html` (940 lignes, vanilla JS), conservé comme référence de la couche API.

---

## 0. Ce qu'il faut savoir avant de lire la suite (objectivement)

1. **Une page statique ne peut pas tout faire.** Sans serveur, il n'y a ni watcher fiable en arrière-plan sur mobile, ni flux news (X, Journal du Coin, Coin Academy sont inaccessibles depuis un navigateur : CORS), ni agents LLM (une clé API dans une page publique serait exposée), ni cohortes de traders Hyperliquid (il faut indexer des milliers de comptes). Tout cela est listé en §9 avec la voie de migration.
2. **Les six agents sont déterministes (règles + statistiques), pas des LLM.** C'est un choix : un agent LLM qui annonce « Re-Accumulation, 74 % » sans calcul sous-jacent est du théâtre. Ici chaque score est reproductible, testé (100 assertions Node), et étiqueté `CALCULATED` / `ESTIMATED`. Une couche LLM (explications narratives, filtrage de news) est prévue en phase 3, derrière un backend.
3. **Les probabilités d'EDGE sont des priors** (ex. breakout 42 %, mean reversion 52 %) ajustés par régime et flow. Elles sont affichées comme intervalle avec « HIGH uncertainty » tant que moins de 30 décisions par type de setup ne sont pas résolues. Le système se recalibre tout seul ensuite (§6). À ta fréquence de trading (≈ 1–3 trades/semaine), la calibration statistique met **des mois** à devenir significative. C'est une limite réelle, pas un défaut d'implémentation.
4. **Le dépôt est public et contient ton adresse wallet** (depuis la v5). Toute personne peut voir tes positions on-chain. Je n'ai donc mis **aucune donnée financière personnelle** dans le code : le « capital firewall » (salaire, crédits, capital core) se saisit dans Settings et reste dans le `localStorage` du navigateur.
5. **Vérification API : faite sur le wallet réel** via GitHub Actions (`tests/diagnostic.js`, exécuté à chaque push par la CI). Les 14 endpoints répondent en 120–210 ms ; le modèle de marge de maintenance tombe exactement sur `crossMaintenanceMarginUsed` (facteur 1.000). Voir §11 pour ce que les données réelles ont changé.

---

## 1. Principe : LIVE DATA FIRST

`src/data/sync.js` implémente une machine d'états visible dans la barre supérieure et dans la ligne `LAST SYNC · DATA FRESHNESS · API STATUS · DEGRADED MODE · NEXT` :

| État | Signification |
|---|---|
| `SYNCING` | requêtes en cours |
| `LIVE` | dernier snapshot complet < `staleAfterMs` (90 s) |
| `DEGRADED` | `clearinghouseState` OK mais un endpoint auxiliaire a échoué (lequel est affiché) |
| `STALE` | snapshot plus ancien que le seuil, ou snapshot restauré du cache au démarrage |
| `ERROR` | échec du cœur et aucun cache |

Garanties :
- **Sequence guard** : une réponse lente ne peut pas écraser un snapshot plus récent.
- **Cache par wallet** : un snapshot d'un autre wallet n'est jamais affiché ; un cache est toujours marqué `STALE`.
- **Polling 30 s avec backoff** sur erreurs (30 → 60 → 120 → 240 → 300 s), resynchronisation immédiate au retour d'onglet si > 15 s.
- **WebSocket** (`allMids` + `webData2`) comme accélérateur : marks mis à jour entre deux polls, heartbeat 45 s, watchdog 90 s, reconnexion exponentielle. Le REST reste la source de vérité.
- **Positions dynamiques** : tout actif présent dans `assetPositions` apparaît (BNB, HYPE… sans changement de code). Les ordres TP/SL sont rattachés à la position.

Données récupérées : positions (taille, sens, prix moyen, mark, notional, levier, mode, marge, liquidation, distance %, PnL latent, ROE, funding courant/24h/7j/30j, funding cumulé), equity, marge disponible/utilisée, maintenance, `withdrawable`, ordres ouverts, exposition nette/brute/par actif, concentration, fills (≤ 2000), funding ledger 90 j, historique de valeur du compte, dépôts/retraits, bougies 1h (30 j) et 1d (220 j) pour BTC/ETH/SOL + actifs détenus, carnet (10 niveaux) des actifs détenus, funding history 30 j.

---

## 2. Architecture

```
Hyperliquid REST /info  ──┐
Hyperliquid WS           ─┼─▶ normalize.js ─▶ Snapshot (provenance par champ)
localStorage cache       ──┘                     │
history.js (bougies, funding, fills, ledger, portfolio, l2 — cache TTL)
                                                  ▼
                                    features.js  (indicateurs, vol, corr, beta, régime, température, anomalies, narratives)
                                                  ▼
                                    portfolio.js (expositions, betas, HHI, vol normale/stress/corr→1, faux hedges)
                                                  ▼
                                    risk.js      (SENTINEL : modèle de marge, stress grid, survival map, gravité, reduce-first, risk budget, veto)
                                                  ▼
                        ORACLE · FLOW · EDGE · ALLOCATOR · SENTINEL · ARCHIVE   (JSON structuré, votes par actif)
                                                  ▼
                                    gates.js     (7 portes + sizing Kelly fractionnaire)
                                                  ▼
                                    orchestrator.js (conviction pondérée par réputation, désaccord, cartes, verdicts, action)
                                                  ▼
                                    cone.js · alpha.js · alerts.js · reputation.js
                                                  ▼
                                    UI (command center → progressive disclosure)
```

Chaque module est un IIFE qui s'enregistre sur `window.AOS.<module>` ; les moteurs n'ont aucune dépendance DOM et tournent tels quels dans Node (`tests/run.js`). Remplacer un module = remplacer un fichier.

---

## 3. Les six agents (sorties JSON structurées)

Tous produisent `{agent, seat, direction, confidence, expected_return, expected_loss, time_horizon, signals[], risks[], invalidation[], recommendation, position_size_modifier, votes:{coin:{dir, confidence, reasons[]}}, prov}`.

| Siège | Ce qu'il calcule réellement | Ce qu'il déclare `UNKNOWN` |
|---|---|---|
| **01 ORACLE** | Régime parmi 9 classes par scores de conditions (EMA 50/200, momentum 3/7/20 j, RSI, MACD, ratio vol 7/30 j, rang ATR, drawdown 30/90 j, OBV, breadth, funding). Confiance = force du score + écart avec le second. Probabilité de changement, volatilité attendue, invalidations chiffrées. | rien |
| **02 FLOW** | Funding courant vs distribution 30 j (z-score), moyennes 24h/7j/30j, basis mark/oracle, OI en $ et OI/volume (crowdedness), déséquilibre du carnet (10 niveaux) sur actifs détenus, probabilité de squeeze (foule contre la tendance), Leverage Stress Index. | cohortes Hyperliquid, whales, clusters de liquidation marché, flux stablecoins, Coinbase premium, taker ratio |
| **03 EDGE** | Scan de 5 setups (pullback de tendance, breakout volume, faux breakout/sweep, mean reversion, funding squeeze) sur 4h/1d ; invalidation structurelle (swing 12×4h ± 0.3 ATR, garde-fous 0.4–2.5 ATR), cibles (plus-haut/bas 20 j sinon 2R, T2 3R, T3 4.5R), EV en R après frais (0.07 % A/R) et funding sur l'horizon, MFE/MAE estimés, intervalle de probabilité. Rejette EV < 0.15 R. | probabilités réelles avant calibration |
| **04 ALLOCATOR** | Net/brut, β BTC/ETH, delta BTC, HHI, levier, vol portefeuille (corr normale / stress 0.95 / corr→1), ratio de diversification (réelle vs apparente), nombre de paris indépendants, **faux hedges** (sens opposés, corr > 0.6), tagging de stratégies. Pénalise les ajouts corrélés au risque dominant. | — |
| **05 SENTINEL** | Voir §4. Ne vote pas. **Veto absolu** si niveau DANGER/CRITICAL ou si le choc simultané liquide. Red team à 8 tests (régime, foule, liquidité, corrélation cachée, funding, faux breakout, macro=UNKNOWN, cascade) durci quand la conviction > 75. Pre-mortem : 3 causes plausibles. | calendrier macro |
| **06 ARCHIVE** | Voir §6. Vote par actif/sens uniquement si ≥ 5 trades. | tout ce qui a < 5 échantillons |

**Orchestrateur** : score = Σ poids × multiplicateur de réputation × direction × confiance. Poids de base 40/35/25 (ORACLE 20 + EDGE 20 / FLOW 35 / ALLOCATOR 15 + ARCHIVE 10), modifiables. **Disagreement index** = 1 − |Σ w·dir| / Σ w·|dir| (0 = unanimité) ; il réduit le sizing (×(1 − 0.6·DI)) et le risk budget.

---

## 4. SENTINEL — modèle de risque

- **Marge de maintenance** : `MM_i = notional_i × 0.5/maxLeverage_i` (règle Hyperliquid), calibrée par un facteur `apiMM / ΣMM_i` (borné 0.5–2.5) pour coller au `crossMaintenanceMarginUsed` LIVE. Liquidation cross quand `equity < ΣMM` ; positions isolées traitées séparément.
- **Stress grid** : BTC −5/−10/−15/−20/−30 % en deux propagations (« beta » : chaque actif bouge de β_i × choc ; « corr→1 » : tous dans le même sens, amplifiés par vol_i/vol_BTC borné 1–3), ETH ±10/20/30 % seul, alts −10…−50 %, **choc simultané** BTC −20 / ETH −25 / SOL −40 / alts −50, squeeze haussier. MM recalculée aux prix choqués.
- **Sorties** : SURVIVAL, MARGIN AFTER SHOCK, ESTIMATED LOSS, CAPITAL REQUIRED TO SURVIVE, POSITION TO REDUCE FIRST (celle dont la clôture améliore le plus le buffer au choc simultané).
- **Niveau** = pire de {buffer, distance liq, stress BTC −20 % corr→1 (perte d'equity > 15/30/50 %), levier brut}. `NORMAL · WATCH · STRESSED · DANGER · CRITICAL`.
- **Survival map** : bissection sur le mouvement BTC qui produit −10 / −25 / −50 / −75 % d'equity et la liquidation, en propagation beta et corr→1 ; carte par actif (l'actif seul bouge).
- **Liquidation gravity** : masse = (notional/equity) × √levier × (vol/vol_BTC) × (1 + corr même sens) / distance liq.
- **Risk budget dynamique** : base 1 % × facteurs (drawdown 30 j, ratio vol, corrélation moyenne, désaccord, niveau de risque, edge) plafonné 2 %.

---

## 5. Risk Gate & sizing

Sept portes, toutes obligatoires : **EDGE** (EV ≥ 0.15 R après coûts) · **PORTFOLIO** (Δ perte stress ≥ −2 % equity ou réduction du net ; concentration ≤ 60 %) · **LIQUIDITY** (notional ≤ 0.5 % du volume 24h et ≤ 2 % de l'OI) · **FUNDING** (funding sur l'horizon ≤ 30 % du gain attendu) · **CORRELATION** (corr pondérée au livre dans le sens du trade ≤ 0.75) · **LIQUIDATION** (pire distance ≥ 15 %, buffer ≥ 25 %, marge suffisante, après le trade) · **SENTINEL** (pas de veto, red team ≠ REJECT).

Sizing : risque $ = min(risk budget × capital de trading × modificateurs agents × (1 − 0.6·DI), **0.25 Kelly**). 0.10 / 0.25 / 0.50 Kelly sont affichés à titre de comparaison ; Kelly plein n'est jamais utilisé. Capital de trading = valeur saisie dans le firewall, sinon equity.

---

## 6. Apprentissage (tout en local, dans le navigateur)

- **Calls d'agents** : ORACLE/FLOW/EDGE enregistrent une direction + probabilité par actif (max 1 par 4 h), résolus sur la clôture 1h à leur horizon (7 j / 2 j / 4 j). Précision, Brier, faux positifs → multiplicateur de réputation 0.5–1.5 avec shrinkage (n/20). Un agent mauvais pèse moins, mécaniquement.
- **Décisions** : chaque carte est journalisée (AUTO / EXECUTE / SIMULATE / IGNORE / VETO / GATE) et résolue : cible touchée avant invalidation ? (bougie ambiguë = perte). → **calibration** par type de setup (p prédite vs réalisée, bins), **edge decay** (R moyen glissant 30/90, 6 m/12 m, poids ×0.3–1.2), **pertes évitées / gains manqués** des IGNORE et vetos (« combien SENTINEL t'a économisé »).
- **ARCHIVE** : reconstruction des allers-retours depuis les fills, win rate, gain/perte moyens, profit factor, espérance, durée, PnL par actif / sens / **régime au moment de l'entrée** (classifieur rejoué sur l'historique BTC), funding payé/reçu (ledger), frais, **alpha vs BTC / ETH / mix / ne rien faire** (rendement Dietz modifié sur la valeur du compte, flux neutralisés), avant et après coûts, max drawdown, Sharpe/Sortino (`ESTIMATED`), décomposition beta / sélection+timing / funding / frais / jambes courtes, contrefactuels (hold, MFE, MAE, BTC même durée), patterns (n ≥ 5 uniquement).
- **Journal** manuel (thèse, sortie, erreur) tagué régime + niveau.

---

## 7. UI

Command center (5 tuiles : Portfolio, Risk, Market, Alpha, Action) → carte orbitale → Watch (alertes WHAT/WHY/ACTION) → Positions (verdict KEEP/INCREASE/REDUCE/EXIT/HEDGE/NO EDGE, détail au tap) → Sentinel → Market → Council → Decision cards (EXECUTE ouvre Hyperliquid, SIMULATE préremplit, IGNORE journalise) → Simulator (asset · sens · quantité · entrée optionnelle ; invalidation et cible suggérées ACCEPT/EDIT/IGNORE ; LOSS / GAIN / R:R / nouvelle liquidation / nouveau risque / nouvelle marge / PnL par scénario / impact marginal) → Scenario (prix, %, ou phrase : « BTC baisse de 12 %, ETH monte de 5 % et SOL = 150 ») → Cone (P10–P90 à 1/7/30/90 j, P(liquidation)) → Archive → Settings.

Chaque carte cache sa complexité derrière `WHY?` / `DETAILS`. Privacy mode floute tout ce qui est marqué `data-private` (montants, tailles), les % restent. Mobile-first (une colonne, gros boutons, tableaux en défilement horizontal propre). Fond quasi noir, étoiles discrètes, DM Sans / JetBrains Mono, une seule teinte d'accent (laiton), les couleurs sémantiques réservées au risque.

---

## 8. Tests (`node tests/run.js`, 100 assertions)

Normalisation (positions dynamiques, TP/SL rattachés, dégradation partielle, funding normalisé en horaire), indicateurs, régime borné, corrélations, portefeuille, modèle de marge (formule de liquidation vérifiée analytiquement pour une position seule long et short), grille de stress, survival map monotone, gravité, veto sur equity minuscule, suggestions de niveaux, parseur de scénarios (fr/en, %, absolu, k), cône (quantiles ordonnés, élargissement, déterminisme), reconstruction des trades, Dietz avec dépôt, sorties structurées des six agents, conviction bornée, gates ×7, journalisation et résolution des calls/décisions, alertes.

Non testé automatiquement : le rendu (vérifié manuellement en Chromium headless, desktop et mobile) et les vrais appels API (proxy bloqué).

---

## 9. Ce qui n'est pas dans cette version, et pourquoi

| Demande du prompt | Statut | Voie |
|---|---|---|
| Cohortes / whales / smart money Hyperliquid | `UNKNOWN` affiché | indexeur (backend) ou source tierce payante |
| Clusters de liquidation marché, flux stablecoins, Coinbase premium, taker ratio | `UNKNOWN` | sources externes (Coinglass, exchanges) via backend |
| News X / Journal du Coin / Coin Academy filtrées par IA | absent | backend : RSS + X API + LLM de filtrage, poussé au dashboard |
| Watcher 07h30–20h30 | présent **si l'onglet est ouvert** (notifications navigateur) | backend cron/Worker + push ; sur iOS Safari, une page fermée ne peut pas alerter |
| Explications narratives LLM | absent | backend avec clé API (jamais dans une page publique) |
| Calendrier macro | `UNKNOWN` dans le red team | API calendrier économique |
| Persistance multi-appareils de la mémoire (calls, décisions, journal) | localStorage uniquement (export JSON) | petite base (KV) derrière auth |

---

## 10. Plan par phases

1. **Phase 1 — mise en service (toi)** : héberger sur GitHub Pages, ouvrir avec ton wallet, vérifier que positions/ordres/funding correspondent à l'UI Hyperliquid, corriger d'éventuels écarts de champs (`frontendOpenOrders`, `portfolio`). Remplir le firewall de capital en local.
2. **Phase 2 — accumulation** : laisser tourner (calls, décisions). Après ~20 calls par agent les poids bougent ; après 30 décisions par setup les probabilités se recalibrent.
3. **Phase 3 — backend léger** (Cloudflare Worker ou petit serveur) : watcher réel + push, news filtrées, narratif LLM, persistance de la mémoire, sources externes de positionnement.
4. **Phase 4 — validation** : mesurer sur 3–6 mois net PnL, alpha vs BTC, Sharpe, drawdown, leakage, trades évités, calibration. Si ces métriques ne s'améliorent pas, le système n'est pas performant, quelle que soit sa sophistication.

---

## 11. Validation sur données réelles (wallet `0x35f0…ab07`, 11/09/2026)

Constats et adaptations :

| Constat sur l'API réelle | Adaptation |
|---|---|
| `liquidationPx` est `null` sur les longs quand l'actif seul ne peut pas liquider le compte cross | le pipeline calcule la valeur modèle (`CALCULATED`) ou affiche « ∞ seul » |
| `userFills` : 2 000 fills max par réponse, soit 19 jours sur ce compte ; premier fill en milieu de position (`startPosition ≠ 0`) | pagination par temps (`userFillsByTime`, 30 j, 5 pages) ; les trades commencés avant la fenêtre sont marqués `truncated` et exclus des statistiques |
| `userFunding` : 500 entrées max (≈ 6 jours) | pagination avant (12 pages) |
| `portfolio` expose `perpDay/perpWeek/perpMonth/perpAllTime` en plus des séries du compte total (29 424 $ total vs 7 733 $ perps) | l'alpha du trading utilise les séries perps ; le compte total est affiché à part ; `perpAllTime` PnL affiché tel quel |
| `userNonFundingLedgerUpdates` : types `deposit`, `send`, `cStakingTransfer` (+ `accountClassTransfer`, `withdraw`) | flux signés séparément pour perps et total (Dietz) |
| `metaAndAssetCtxs` : `marginTables` par paliers de notional, `marginTableId` par actif | taux de maintenance par palier |
| `frontendOpenOrders` : `triggerPx: "0.0"` sur les limites, `orderType: "Stop Market"`, `isPositionTpsl` | parser confirmé ; ordres non reduce-only affichés avec leur **exposition conditionnelle** (ici 0,5 BTC @ 60 000 = 4× l'equity perps) |
| `withdrawable` = 27 $ pour 7 444 $ d'equity | affiché dans la tuile Portfolio (marge disponible) |
| Fills sur des perps HIP-3 (`xyz:SP500`, `io:ANTH`) | supportés tels quels (pas de contexte d'actif → `UNKNOWN`) |

Ce que les chiffres réels disent, sans enrobage : 5 positions cross pour un levier effectif de 5×, net short, 27 $ de marge disponible, 2 000 fills en 19 jours, et un PnL perps cumulé de **−62 678 $** depuis janvier d'après l'API `portfolio`. Le dashboard n'est utile que s'il fait baisser l'activité et le levier, pas s'il les justifie.

## TOP 10 HIGHEST-IMPACT IMPROVEMENTS (classés)

| # | Amélioration | Alpha | Risque ↓ | Complexité | Priorité |
|---|---|---|---|---|---|
| 1 | ~~Valider les parsers sur ton wallet réel~~ fait (§11) → merger dans `main` pour publier sur GitHub Pages | — | ★★★ | faible | **maintenant** |
| 2 | Renseigner le capital firewall (sizing plafonné au capital de trading, pas à l'equity) | ★ | ★★★ | nulle | **maintenant** |
| 3 | Backend watcher + notifications push (alertes liquidation/régime hors onglet) | ★ | ★★★ | moyenne | haute |
| 4 | Persistance serveur de la mémoire (calls, décisions, journal) pour ne rien perdre entre appareils | ★★ | ★ | moyenne | haute |
| 5 | Positionnement externe (OI multi-exchange, liquidation map) pour FLOW | ★★ | ★★ | moyenne | moyenne |
| 6 | Backtest hors-ligne des 5 setups EDGE sur 2 ans de bougies (priors mesurés, pas supposés) | ★★★ | ★ | moyenne | haute |
| 7 | Régime : ajouter dominance BTC et ETH/BTC (données spot externes) | ★ | ★ | faible | moyenne |
| 8 | Attribution timing/levier séparés (nécessite l'historique intrajournalier des tailles) | ★ | ★ | élevée | basse |
| 9 | News filtrées par LLM (backend) — seulement ce qui touche un actif détenu | ★ | ★ | élevée | basse |
| 10 | Mode « paper » : exécuter les cartes en simulation continue pour accélérer la calibration | ★★ | — | moyenne | moyenne |
