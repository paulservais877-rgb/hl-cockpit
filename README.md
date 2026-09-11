# Alpha OS — Hyperliquid Terminal (v2)

Personal Alpha Operating System pour un compte Hyperliquid : six agents spécialisés, un agent risque avec veto absolu, un Risk Gate à sept portes, un simulateur minimal, un moteur de scénarios, un cône de probabilité et une mémoire quantitative (alpha vs BTC/ETH, calibration, réputation des agents).

- **Page statique, sans backend, sans build.** `index.html` + `src/**` en scripts classiques (fonctionne sur GitHub Pages, un serveur local, ou en `file://` avec limites).
- **Source de vérité : Hyperliquid** (info API + WebSocket). Aucune position n'est codée en dur. Tout ordre s'exécute dans l'interface Hyperliquid, jamais depuis cette page.
- **Anti-hallucination :** chaque donnée est étiquetée `LIVE`, `CALCULATED`, `HISTORICAL`, `ESTIMATED` ou `UNKNOWN`.

## Lancer

```bash
python3 -m http.server 8000      # puis http://localhost:8000/
node tests/run.js                # suite de tests (100 assertions, sans dépendance)
```

Mode démo (données synthétiques, aucune connexion) : `http://localhost:8000/?demo=1` ou `demo.html`.

Le wallet par défaut est celui présent historiquement dans ce dépôt ; il se change dans **Settings**. Les données personnelles (firewall de capital) restent dans le `localStorage` du navigateur et ne sont jamais commitées.

## Structure

```
index.html            page principale        demo.html   page démo (fixtures)
assets/css/app.css    système visuel (observatoire, DM Sans + JetBrains Mono)
src/core              util (stats, formats, provenance), store (état, persistance)
src/data              hl-rest, hl-ws, normalize (parsers tolérants), history (cache TTL), sync (machine d'états LIVE/SYNCING/STALE/DEGRADED/ERROR), fixtures
src/engine            features (indicateurs, régime, température, anomalies), portfolio, risk (SENTINEL), simulate (+ scénarios NL), cone, alpha (ARCHIVE), alerts, pipeline
src/agents            oracle, flow, edge, allocator, sentinel, archive, gates (Risk Gate + sizing Kelly fractionnaire), reputation (calibration, edge decay), orchestrator
src/ui                dom, starfield, orbital (carte orbitale), views-core, views-intel, sim, app.js
tests/run.js          tests Node
docs/ARCHITECTURE.md  architecture, limites, plan par phases, top 10
legacy/               ancien HL Cockpit v5 (référence)
```

Voir `docs/ARCHITECTURE.md` pour le détail des modèles (marge de maintenance, stress, cône, Dietz, réputation) et pour ce qui n'est **pas** faisable dans une page statique.
