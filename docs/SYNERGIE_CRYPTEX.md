# Synergie Cryptex (ancien dashboard) × Alpha OS (nouveau)

Source analysée : `cryptex_onglet1_complet.html` (18 150 lignes, 1,22 Mo, 4 onglets, 34 widgets dont 17 maquettes vides, backend `localhost:8081`). Périmètre demandé : **hors agents** (Gardien, Orchestrateur, Messaoud).

## 1. Ce qu'est réellement l'ancien dashboard

- **Un front sans intelligence embarquée.** Aucun appel LLM dans le fichier. Les « agents » sont des préfixes de routes d'un proxy Python (`eugene_proxy.py`, ~80 routes) et des tables SQLite (`gardien_alerts`, `orchestrator_decisions`, `trade_analyses`). Toute l'intelligence est côté serveur, sur ta machine.
- **Un bus d'événements de qualité** (`busV2Core`, lignes 11179–11458) : enveloppe à 8 champs (`value, status, source, fetched_at, calibration_status, ttl, confidence, error`), cycle `loading → ok → error → stale`, TTL = 2 × période, et `brancher(clé, {peindre, effacer})` qui **oblige** chaque carte à savoir s'effacer. C'est la meilleure pièce du fichier.
- **Une doctrine écrite dans le code** (§8.9) : levier compte = Σ|taille × prix| / capital net ; bandes **< 2,5× sûr · 2,5–3,0× alerte (« réduction obligatoire sous 24 h ») · ≥ 3,0× violation** ; hystérésis « 1 relevé pour alerter, 3 pour rassurer » ; « un niveau se lit, il ne se commande pas » (aucune consigne d'action au trader) ; « absence = silence » (jamais de constante de repli) ; pas de score composite sans base mesurée (le « taux de capture » a remplacé un score sur 100).
- **Une ambiance pilotée par une vraie donnée** : `body[data-state]` (safe/warn/crit) dérive du levier vs cap 3,0× et commande la scène « Marée » (WebGL : houle fbm, fresnel, traînée de lune, éclairs fractals, baleine, tonnerre opt-in). Pas le PnL.
- **Des calculs validés** : liquidation cross what-if (`liq = mark − side·MA/taille/(1 − l·side)`, avec « position couverte » si la marge disponible couvre le notional), stress MTM β = 1 avec levier post-choc vs mur, cascade avec vérification de conservation, courbe d'equity rebasée avec BTC rebasé et écart d'alignement déclaré, agrégation des liquidations en grille 24 × 12.
- **Sa dette** : 22 copies de `PROXY_BASE`, 8 `fmtK`, 4 `esc`, 3 `pctLev`, le patron data-layer recopié 22 fois (~1 300 lignes), deux systèmes de particules dont un mort, 161 `innerHTML`, 40–50 % de commentaires (excellents, mais ils font le poids), le journal Messaoud de 1,5 Mo toutes les 15 min, et 17 cartes qui n'affichent que des notes de chantier.

## 2. Le conflit à arbitrer (objectivement)

Les deux projets ne partagent pas la même philosophie sur trois points. Il faut trancher, pas fusionner à l'aveugle.

| Sujet | Cryptex | Alpha OS | Recommandation |
|---|---|---|---|
| Consignes d'action | interdites (« un niveau se lit, il ne se commande pas ») | cartes EXÉCUTER / SIMULER / IGNORER, verdicts GARDER / RÉDUIRE / SORTIR, action du jour | **Garder Alpha OS** : c'est l'objet même du prompt maître. Mais chaque consigne doit rester traçable à une mesure (c'est déjà le cas : Pourquoi ? + provenance) et journalisée pour être notée (déjà le cas : décisions résolues). |
| Scores composites | refusés sans base mesurée (taux de capture plutôt que score /100) | conviction /100, météo /100, confiance de régime | **Compromis** : garder les scores mais afficher leur base et leur incertitude (déjà partiel) et **promouvoir le taux de capture** (déjà calculé : « capture moyenne du MFE ») en indicateur principal d'Archive. |
| Levier et seuils | cap doctrinal 3,0× ; alerte 2,5× ; hystérésis | VIGILANCE 3× · TENDU 5× · DANGER 8× (levier brut) | **Adopter la doctrine Cryptex** : 2,5 / 3,0 sur le levier compte unifié, avec l'hystérésis asymétrique. Avec l'equity unifiée (1,16× aujourd'hui) tu es sûr ; à 2,6× le dashboard doit dire « réduction obligatoire sous 24 h ». |

Un point où Cryptex est meilleur sans débat : **le wallet n'apparaît jamais côté client** (le proxy le tient). Alpha OS est une page statique publique avec l'adresse en clair. Tant que le backend local existe, il peut servir de relais.

## 3. Plan de synergie (ordre de valeur / effort)

1. **Doctrine §8.9 + hystérésis dans la Sentinelle** (petit). Remplacer les seuils de levier 3/5/8 par 2,5/3,0 sur l'equity unifiée ; transition de niveau confirmée après 1 relevé à la hausse, 3 à la baisse ; jauge de levier à aiguille (échelle par morceaux 1× → 0 %, 3× → 50 %, 10× → 100 %) dans la tuile Risque.
2. **Scène « Marée » comme ambiance** (moyen, ~800 lignes autonomes à porter : `CryptexWater`, `CryptexScene`, `drawBolt`, `CryptexWhale`). Remplace le champ d'étoiles. Pilotage par le niveau Sentinelle (NORMAL = nuit calme, VIGILANCE/TENDU = crépuscule, DANGER/CRITIQUE = tempête). C'est le « ludique » que tu demandais, et il existe déjà.
3. **Enveloppe du bus V2 pour chaque source** (moyen). Aujourd'hui Alpha OS a une machine d'états globale ; Cryptex la porte **par donnée**. Généraliser `{status, fetched_at, ttl, confidence}` aux bougies, funding, fills, spot, portfolio, et rendre `effacer` obligatoire dans chaque vue.
4. **Courbe d'equity rebasée + BTC rebasé + HWM** (petit). Alpha OS a les chiffres Dietz mais pas la courbe ; Cryptex a la courbe et l'écart d'alignement déclaré.
5. **Simulateur à deux entrées** (petit). Cryptex : marge × levier avec « position couverte » ; Alpha OS : quantité. Offrir les deux, même moteur.
6. **Palette Velvet par actif** (petit) : couleurs canoniques BTC/ETH/ADA/SOL/HYPE/TAO pour la carte orbitale, les puces et les tableaux.
7. **Le proxy local comme fournisseur optionnel de sources externes** (moyen, côté serveur). Routes à garder : `/portfolio/*`, `/market/*`, `/liq/btc`, `/michel/pulse`, `/michel/etf`, `/michel/funding/snapshot`, `/eugene/ratios`, `/eugene/derivatives/open_interest`, `/eugene/calendar/macro`, `/eugene/medias`. Routes à couper : `/gardien/*`, `/orchestrator/*`, `/messaoud/*`. Alpha OS lit `EUGENE_PROXY_URL` si défini et passe FLUX en DÉGRADÉ sinon. Cela comble exactement les INCONNU actuels : liquidations marché, intérêt ouvert multi-exchange, Fear & Greed, calendrier macro, veille RSS.
8. **Grille de liquidations 24 × 12 et quadrant OI** (moyen) : réutiliser `agreger` et `rendreOiStress` sur les données du proxy.

À abandonner : les 17 maquettes, l'onglet Performance (Messaoud), le cockpit d'action (Gardien + Orchestrateur), `snapshotAll`/`registerWidgets` (contrat de sortie vers les agents), le bus V1, les 7 générateurs de particules DOM, les 8 000 lignes de commentaires (à archiver dans un `DECISIONS.md`), et le mono-fichier lui-même.

## 4. Architecture cible

```
Hyperliquid API/WS ─────────┐
                            ├─▶ Alpha OS (front statique, une seule UI)
eugene_proxy.py (optionnel) ┘    · Sentinelle avec doctrine §8.9 + hystérésis
  routes marché conservées       · scène Marée pilotée par le niveau
  routes agents supprimées       · bus V2 par source, effacer obligatoire
                                 · conseil des six + cartes de décision (Alpha OS)
```

Cryptex ne survit pas comme interface : il survit comme **doctrine, scène et fournisseur de sources**. Alpha OS ne survit pas sans ses garde-fous : il les adopte.

## 5. État d'implémentation (synergie **sans la doctrine**, à la demande de Paul)

Arbitrage retenu : la doctrine §8.9 (bandes 2,5×/3,0×, hystérésis, « un niveau se lit, il ne se commande pas ») **n'est pas portée**. Les seuils de la Sentinelle et les cartes de décision d'Alpha OS restent tels quels. Objectivement, c'est un choix de confort de lecture, pas de sécurité : la Sentinelle reste le seul garde-fou.

| Point du plan | État | Où |
|---|---|---|
| 2. Scène « Marée » | **fait** — mer WebGL (même shader fbm/fresnel/traînée de lune), lune, auras, étoiles (155 au lieu de 510 : coût de recalcul de style), étoiles filantes, nuages, pluie, éclairs fractals + éclair d'eau en tempête, baleine par nuit calme. Pilotée par `body[data-state]` que seul `app.js` écrit à partir de `analysis.risk.level` (NORMAL → nuit calme, VIGILANCE/TENDU → crépuscule, DANGER/CRITIQUE → tempête). Sans images (les webp de Cryptex n'existent pas ici) ; pause quand l'onglet est caché ; mouvement réduit respecté ; 30 images/s. | `src/ui/maree.js`, `assets/css/app.css` |
| 3. Enveloppe par source | **fait** — `history.loadAll` renvoie `sources[groupe] = {ok, ts, ttl, n, errors}` avec la vraie date d'obtention (une donnée servie du cache garde sa date) ; bande de fraîcheur sous la barre (compte, websocket, bougies, funding, carnet, fills, funding payé, portfolio, ledger, spot) en vert / orange (périmé > 1,5 × TTL) / rouge. | `src/data/history.js`, `src/app.js` |
| 4. Courbe d'equity | **fait** — `AOS.alpha.equityCurve` : valeur perps rebasée en %, dépôts/retraits neutralisés (ledger), BTC rebasé sur la même fenêtre, plus-haut et repli, écart d'alignement BTC déclaré. Testé. | `src/engine/alpha.js`, `src/ui/views-intel.js` |
| 5. Simulateur à deux entrées | **fait** — mode « marge × levier » (quantité déduite affichée) à côté du mode « quantité », même moteur ; chip « position couverte » quand la marge libre couvre le notional et qu'aucune liquidation n'est atteignable par cet actif seul. | `src/ui/sim.js` |
| 6. Palette Velvet | **fait** — couleur canonique par actif (BTC, ETH, SOL, HYPE, TAO, ADA, WLD + 40 autres, repli déterministe) : corps de la carte orbitale (le sens passe dans l'anneau), pastilles sur positions, décisions, gravité. | `src/ui/palette.js` |
| Design premium | **fait** — cartes en verre (flou 18 px) au-dessus de la scène, titres de section en Instrument Serif, barre du haut flottante, ambiance nommée dans la barre (« Nuit calme », « Crépuscule », « Tempête »). | `assets/css/app.css` |
| 1. Doctrine + hystérésis | **exclu** (demande explicite) | — |
| 7. Proxy local comme fournisseur | **non fait** (côté serveur, hors page statique) | — |
| 8. Grille de liquidations 24 × 12 | **non fait** (dépend du proxy) | — |

Coût à connaître : le flou des cartes au-dessus d'une mer animée se paie en GPU sur mobile. Mesures prises : mer à 30 images/s, résolution 0,9× sous 700 px, arrêt complet onglet caché, scène figée en mouvement réduit. Si un appareil chauffe, l'option suivante est de couper le flou (`backdrop-filter`) plutôt que la mer.
