# Inventaire des publications de l'adresse dpo.caps@ca-ps.com

Date d'exécution : 10 septembre 2026
Périmètre demandé : recensement des pages web publiques où figure l'adresse `dpo.caps@ca-ps.com`.

---

## 1. Synthèse (résultat principal : mission non aboutie)

1. **Occurrences confirmées : 0.** Aucune page n'a pu être récupérée pendant cette session.
2. Cause unique : l'environnement d'exécution bloque **toute** sortie HTTPS vers des domaines externes (réponse 403 du proxy d'egress sur chaque hôte testé).
3. Les étapes 3 (vérification de chaque URL) et 4 (qualification) sont donc **impossibles** ici ; l'étape 2 (téléchargement du jeu CNIL sur data.gouv.fr) l'est également.
4. Fait établi : l'outil de recherche web a fonctionné et a produit **3 URL candidates récurrentes** (§4), retournées de façon stable sur 4 requêtes distinctes portant sur la chaîne exacte.
5. Fait établi : ces 3 candidates sont `ca-moncommerce.com` (2 pages) et `agorapay.com` (1 page) — deux sites de services d'encaissement, pas des sites de Caisse régionale ni de LCL.
6. **Hypothèse (non vérifiée)** : le canal le plus probable par lequel un client trouve l'adresse serait les mentions légales / politique de données de sites de services de paiement édités par CAPS elle-même (catégorie C présumée), et non un document de Caisse régionale.
7. **Hypothèse (non vérifiée)** : l'absence de candidate sur `credit-agricole.fr` ou `lcl.fr` dans les résultats ne prouve pas l'absence d'occurrence — l'opérateur `site:` n'est pas pris en charge (§5) et le moteur est orienté résultats US.
8. Aucune occurrence de catégorie A n'a pu être établie ; aucune ne peut être exclue non plus.
9. Aucune donnée du jeu CNIL n'a pu être consultée : impossible de dire si l'entrée CAPS y expose une adresse e-mail.
10. **Conclusion opérationnelle** : la mission doit être relancée depuis un environnement disposant d'un accès réseau sortant ouvert. Le §4 fournit la liste de vérification prête à l'emploi.

---

## 2. Occurrences de catégorie A

**Néant.** Aucune occurrence, toutes catégories confondues, n'a été confirmée. Aucune citation ne peut être produite : conformément à la règle « n'invente aucune citation », rien n'est rapporté ici faute de page effectivement récupérée.

---

## 3. Journal des requêtes

Outil : `WebSearch` (index orienté résultats US). « Résultats pertinents » = liens dont l'intitulé ou le domaine renvoie plausiblement à Crédit Agricole / CAPS ; ce comptage **ne préjuge pas** de la présence effective de l'adresse dans la page, aucune n'ayant été ouverte.

| # | Requête | Outil | Résultats pertinents | Domaines pertinents retournés |
|---|---------|-------|----------------------|-------------------------------|
| 1 | `"dpo.caps@ca-ps.com"` | WebSearch | 3 / 8 | ca-moncommerce.com (×2), agorapay.com |
| 2 | `"dpo.caps" "ca-ps.com"` | WebSearch | 2 / 9 | ca-moncommerce.com (×2) |
| 3 | `"dpo.caps [at] ca-ps.com" OR "dpo.caps (at) ca-ps.com" OR "dpo.caps arobase ca-ps"` (variantes masquées) | WebSearch | 3 / 10 | ca-moncommerce.com (×2), agorapay.com |
| 4 | `"ca-ps.com" DPO` | WebSearch | 0 / 10 | aucun (bruit : DPO en Californie, cabinets de conseil) |
| 5 | `"Crédit Agricole Payment Services" "délégué à la protection des données"` | WebSearch | 7 / 8 | credit-agricole.fr (×4 dont 2 PDF), credit-agricole.com, ca-moncommerce.com, ca-centrest.com |
| 6 | `"Crédit Agricole Payment Services" DPO contact` | WebSearch | 6 / 8 | credit-agricole.com (×3), ca-moncommerce.com, verif.com, linkedin.com |
| 7 | `"ca-ps.com" site:credit-agricole.fr` | WebSearch | 0 / 10 | opérateur `site:` non pris en charge (§5) — pages d'accueil génériques |
| 8 | `"ca-ps.com" site:lcl.fr` | WebSearch | 0 / 7 | opérateur `site:` non pris en charge — pages génériques LCL |
| 9 | `"ca-ps.com" site:credit-agricole.com` | WebSearch | 0 / 10 | opérateur `site:` non pris en charge — pages presse/marques |
| 10 | `"dpo.caps@ca-ps.com" filetype:pdf` | WebSearch | 0 / 10 | opérateur `filetype:` non pris en charge — PDF américains sans rapport |
| 11 | `"Crédit Agricole Payment Services" politique de protection des données` | WebSearch | 8 / 8 | credit-agricole.fr (×3), credit-agricole.com (×2), ca-moncommerce.com, ca-centrest.com (×2) |
| 12 | `"Crédit Agricole Payment Services" Paylib OR Wero OR "Apple Pay" OR "Click to Pay"` | WebSearch | 3 / 7 | credit-agricole.fr (×3) ; `OR` non fiable (§5) |
| 13 | `"dpo.caps" ca-ps arobase délégué protection données` (reformulation sans opérateur) | WebSearch | 0 / 8 | aucun (bruit : pages pédagogiques CNIL/EDPB) |
| 14 | `data.gouv.fr CNIL jeu de données organismes ayant désigné un délégué à la protection des données` | WebSearch | 1 / 9 | data.gouv.fr — jeu identifié (§6) |
| 15 | `"ca-ps.com" mentions légales Crédit Agricole Payment Services Guyancourt` | WebSearch | 6 / 7 | ca-moncommerce.com, agorapay.com, credit-agricole.fr, credit-agricole.com (×2), societe.com |
| 16 | `"Click to Pay" Crédit Agricole "responsable conjoint" OR "coresponsable" données personnelles DPO` | WebSearch | 8 / 8 | credit-agricole.fr (×4), credit-agricole.com (×3), e-immobilier.credit-agricole.fr |

Aucune requête n'a retourné d'occurrence hors Groupe Crédit Agricole (ni forum, ni générateur de courrier, ni annuaire tiers) parmi les résultats pertinents.

---

## 4. URL non confirmées

Toutes les URL ci-dessous sont **non confirmées**, avec la **même raison** : `EGRESS_BLOCKED` — la récupération du contenu a été refusée par le proxy réseau de la session (403 sur le CONNECT), aussi bien via `curl` que via l'outil de récupération de page. La présence de l'adresse dans ces documents n'est donc **ni établie ni infirmée**.

### 4.1 Candidates directes (retournées sur la chaîne exacte `dpo.caps@ca-ps.com`)

| URL | Requêtes l'ayant retournée | Raison de non-confirmation |
|-----|----------------------------|----------------------------|
| https://www.ca-moncommerce.com/politique-de-protection-des-donnees/ | 1, 2, 3, 5, 6, 11, 15 | EGRESS_BLOCKED (403 proxy) |
| https://www.ca-moncommerce.com/cgu-mentions-legales/ | 1, 2, 3, 15 | EGRESS_BLOCKED (403 proxy) |
| https://www.agorapay.com/en/legal-notice-terms-of-use/ | 1, 3, 15 | EGRESS_BLOCKED (403 proxy) |

### 4.2 Candidates secondaires (à contrôler lors d'une reprise)

Retournées sur les requêtes CAPS + protection des données, sans correspondance sur la chaîne exacte. À ouvrir et à passer au `grep` sur `ca-ps.com`.

| URL | Raison de non-confirmation |
|-----|----------------------------|
| https://www.credit-agricole.fr/content/dam/assetsca/cr878/npc/documents/informations-et-reglementaire/politique-de-protection-des-donnees-cr-/POLITIQUE-DE-PROTECTION-DES-DONNEES-PERSO-2021.pdf | EGRESS_BLOCKED (403 proxy) |
| https://www.credit-agricole.fr/content/dam/assetsca/cr847/npc/documents/rgpd/caav-politique-de-protection-des-donnees-MAJ042020.pdf | EGRESS_BLOCKED (403 proxy) |
| https://ca-centrest.com/wp-content/uploads/2023/02/POLITIQUE-DE-PROTECTION-DES-DONNEES-PERSO-2021.pdf | EGRESS_BLOCKED (403 proxy) |
| https://ca-centrest.com/politique-de-protection-des-donnees/ | EGRESS_BLOCKED (403 proxy) |
| https://www.credit-agricole.fr/particulier/informations/politique-de-protection-des-donnees-personnelles-de-la-caisse-regionale.html | EGRESS_BLOCKED (403 proxy) |
| https://www.credit-agricole.fr/particulier/informations/nos-engagements/charte-des-donnees-personnelles.html | EGRESS_BLOCKED (403 proxy) |
| https://www.credit-agricole.fr/particulier/informations/politique-de-confidentialite.html | EGRESS_BLOCKED (403 proxy) |
| https://www.credit-agricole.fr/particulier/informations/mentions-legales.html | EGRESS_BLOCKED (403 proxy) |
| https://www.credit-agricole.com/en/footer/protection-of-personal-data | EGRESS_BLOCKED (403 proxy) |
| https://www.credit-agricole.com/en/footer/credit-agricole-sa-personal-data-protection-policy | EGRESS_BLOCKED (403 proxy) |
| https://www.credit-agricole.com/pdfPreview/192431 | EGRESS_BLOCKED (403 proxy) |
| https://e-immobilier.credit-agricole.fr/politique-de-protection-des-donnees-a-caractere-personnel | EGRESS_BLOCKED (403 proxy) |
| https://www.ca-personalfinancemobility.com/accueil/mentions-legales/ | EGRESS_BLOCKED (403 proxy) |

---

## 5. Étape 2 — Jeu de données CNIL : non réalisée

- Jeu identifié par recherche : **« Organismes ayant désigné un(e) délégué(e) à la protection des données (DPD/DPO) »**, publié par la CNIL sur data.gouv.fr — https://www.data.gouv.fr/datasets/organismes-ayant-designe-un-e-delegue-e-a-la-protection-des-donnees-dpd-dpo
- **Téléchargement impossible** : `www.data.gouv.fr:443` et `data.gouv.fr:443` refusés par le proxy (403 sur le CONNECT), y compris via l'API `/api/1/datasets/`.
- Par conséquent, les recherches insensibles à la casse sur `ca-ps`, `dpo.caps` et `Payment Services` n'ont **pas** pu être effectuées.
- **Il n'est donc pas possible d'indiquer quelles colonnes contiennent le contact du DPO, ni ce qui figure pour l'entrée CAPS, ni si le fichier expose ou non une adresse e-mail.** Toute affirmation sur ce point serait une invention.

---

## 6. Limites de la recherche

### 6.1 Blocage réseau (limite déterminante)

L'environnement d'exécution route toute sortie HTTPS via un proxy appliquant une politique d'egress restrictive. Hôtes testés, tous refusés (`connect_rejected` — 403 du gateway) :

`www.ca-moncommerce.com`, `www.agorapay.com`, `www.data.gouv.fr`, `data.gouv.fr`, `www.cnil.fr`, `www.credit-agricole.fr`, `www.credit-agricole.com`, `www.ca-ps.com`, `ca-centrest.com`, `www.lcl.fr`

Le blocage est confirmé côté proxy (journal `recentRelayFailures`) et vaut pour `curl` comme pour l'outil de récupération de page. Conformément aux consignes de l'environnement, aucun contournement n'a été tenté.

**Conséquence directe** : étapes 3 et 4 non exécutables ; le fichier `inventaire_dpo_caps.csv` ne contient que son en-tête.

### 6.2 Opérateurs de recherche non pris en charge

- `site:` — **non pris en charge**. Les requêtes 7, 8 et 9 ont renvoyé des pages d'accueil génériques sans lien avec la chaîne recherchée, signe que l'opérateur a été ignoré. Reformulation sans opérateur effectuée (requête 15).
- `filetype:` — **non pris en charge** (requête 10 : PDF américains sans rapport). Reformulation : requêtes 11 et 12.
- `OR` — comportement non fiable (requêtes 3, 12, 16 : les résultats ne couvrent pas systématiquement chaque terme de l'alternative).

### 6.3 Couverture du moteur

- Le moteur utilisé est **orienté résultats US** : sur une chaîne française très spécifique, le bruit est massif (USPS, Wikipédia, agences californiennes). Le rappel sur les pages françaises est probablement faible.
- Les résultats sont retournés sans nombre total ni pagination : le comptage du §3 porte sur la seule première page de résultats.
- Un moteur unique a été employé ; aucune recherche croisée (Bing, Qwant, Startpage) n'a pu être menée, les moteurs eux-mêmes étant hors du périmètre réseau autorisé.

### 6.4 Angles morts non couverts, indépendants du blocage

- **Pages sous authentification** (espaces client Crédit Agricole en ligne, applications mobiles) : hors périmètre par consigne, et non indexées. Or c'est un canal plausible de diffusion de l'adresse.
- **Documents contractuels non publiés sur le web** (conditions générales remises en agence, courriers, notices PDF envoyées au client) : non atteignables par un moteur.
- **PDF illisibles / non indexés** : les politiques de protection des données des Caisses régionales sont majoritairement des PDF hébergés sous `/content/dam/` ; leur indexation est inégale, et `filetype:` n'étant pas disponible, aucun balayage systématique n'a pu être fait.
- **Pages supprimées ou modifiées** : aucune consultation d'archive (Wayback Machine) n'a été possible, le domaine étant lui aussi hors périmètre réseau.
- **39 Caisses régionales** : chacune publie ses propres mentions et politiques. Un inventaire exhaustif suppose un balayage site par site, non réalisable ici.

### 6.5 Indices non vérifiés

Le composant de synthèse de l'outil de recherche a produit, à partir d'extraits, des affirmations concernant CAPS (adresse à Guyancourt, qualité de responsable de traitement sur un site d'encaissement). **Ces affirmations ne proviennent d'aucune page récupérée pendant cette session** et ne sont donc reprises ni dans le CSV, ni comme citations. Elles ne doivent pas être utilisées comme constat.

---

## 7. Reprise recommandée

Depuis un environnement à accès réseau ouvert, la séquence suivante suffit à conclure :

```bash
# 1. Candidates directes : confirmation de la chaîne exacte
for u in \
  "https://www.ca-moncommerce.com/politique-de-protection-des-donnees/" \
  "https://www.ca-moncommerce.com/cgu-mentions-legales/" \
  "https://www.agorapay.com/en/legal-notice-terms-of-use/"
do
  echo "== $u"
  curl -sSL "$u" | sed 's/<[^>]*>/ /g' | grep -io -C1 "dpo[.a-z0-9_-]*@ca-ps\.com"
done

# 2. Jeu CNIL
curl -sSL -o dpo_cnil.csv \
  "https://www.data.gouv.fr/api/1/datasets/organismes-ayant-designe-un-e-delegue-e-a-la-protection-des-donnees-dpd-dpo/"
grep -i -E "ca-ps|dpo\.caps|payment services" dpo_cnil.csv

# 3. PDF des Caisses régionales
curl -sSL -o pol.pdf "<url du PDF>" && pdftotext pol.pdf - | grep -i "ca-ps.com"
```

Points de vigilance pour la qualification (étape 4) : la catégorie **A** ne doit être retenue que si le document lui-même désigne une autre entité comme responsable de traitement tout en renvoyant vers le DPO de CAPS. Le rôle de CAPS doit être recopié tel qu'énoncé, sans inférence.
