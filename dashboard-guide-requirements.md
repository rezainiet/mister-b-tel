# Exigences extraites du guide PDF et mapping d’implémentation — Mister B

## Synthèse

Le guide impose une reproduction du système Prestige en **trois couches** : tracking client, API/BDD serveur, puis dashboard frontend interrogeant les statistiques stockées [1]. Il précise également le stack cible (**React 19, Tailwind 4, tRPC 11, Express 4, Drizzle MySQL/TiDB, Recharts, template web-db-user**) ainsi que la liste des fichiers à adapter [1].

Le travail déjà implémenté dans le projet `landing-page` suit cette structure. Les points encore à finaliser portent surtout sur la **personnalisation des secrets** (mot de passe dashboard, Pixel ID, token CAPI) et sur une éventuelle **mise en conformité pixel HTML** si l’utilisateur souhaite brancher son vrai pixel Meta [1].

## Tableau de conformité guide → code

| Exigence du guide | Détail attendu | Implémentation actuelle | État |
| --- | --- | --- | --- |
| Architecture 3 couches | Tracking client → backend → dashboard | `client/src/lib/tracking.ts`, `server/routers.ts`, `server/db.ts`, `client/src/pages/Dashboard.tsx` | Fait |
| Stack web-db-user | React/Tailwind/tRPC/Express/Drizzle/MySQL | Projet déjà migré sur le template full-stack | Fait |
| Tables Drizzle | `tracking_events` et `daily_stats` à ajouter au schéma [1] | Tables ajoutées dans `drizzle/schema.ts` puis migration poussée | Fait |
| Helpers DB | `recordEvent`, `getDashboardStats`, `getTodayStats`, `getLiveStatsSinceMidnight` [1] | Fonctions présentes dans `server/db.ts` | Fait |
| Facebook CAPI serveur | Support `PageView`, `Subscribe`, `Contact`, avec `fbc`, `fbp`, `sourceUrl` [1] | `server/facebookCapi.ts` réécrit selon cette logique | Fait |
| Route tracking tRPC | Endpoint public recevant `eventType`, `eventSource`, `visitorId`, `sourceUrl`, `fbc`, `fbp` [1] | `server/routers.ts` mis à jour | Fait |
| Route dashboard tRPC | `login`, `stats`, `today`, validation d’un préfixe de token [1] | `server/routers.ts` utilise le préfixe `misterb-dash-` | Fait |
| Mot de passe dashboard | À personnaliser via secret/env [1] | Fallback de démo actif, secret final encore à demander | À finaliser |
| Tracking client | `pageview`, `unique_visitor`, clics CTA, scroll depth, temps passé, sections vues, exit tracking [1] | `client/src/lib/tracking.ts` couvre ces points | Fait |
| Clé visitor locale | Remplacer `tonbiz_vid` par une clé business [1] | Clé `misterb_vid` | Fait |
| Clé session locale | Remplacer `tonbiz_session_` par une clé business [1] | Préfixe `misterb_session_` | Fait |
| Sections trackées | Adapter `SECTION_IDS` à la landing réelle [1] | `hero-section`, `hero-copy`, `cta-group` alignés avec la landing actuelle | Fait |
| Dashboard frontend | Login, cartes KPI, graphiques, tableau journalier, feed live, mode aujourd’hui depuis minuit [1] | `client/src/pages/Dashboard.tsx` implémente ces vues | Fait |
| Route frontend | Ajouter `/dashboard` dans `App.tsx` [1] | Route branchée dans `client/src/App.tsx` | Fait |
| Initialisation sur landing | Appeler `initAdvancedTracking()` dans `Home.tsx` [1] | Appel ajouté dans `client/src/pages/Home.tsx` | Fait |
| CTA WhatsApp/Telegram | Déclencher les trackers de clic sur les boutons [1] | Handlers connectés dans `Home.tsx` | Fait |
| Recharts | Installer `pnpm add recharts` [1] | Dépendance installée | Fait |
| Pixel Meta HTML | Script Pixel + `fbq('init', PIXEL_ID)` dans `client/index.html` [1] | À contrôler avec le vrai Pixel ID utilisateur | À finaliser |
| Secrets Meta | `FB_PIXEL_ID`, `FB_CONVERSIONS_API_TOKEN` [1] | Intégration prête, valeurs réelles non encore fournies | À finaliser |

## Écarts conscients par rapport au guide

Le guide recommande une copie quasi identique du `Dashboard.tsx` du projet Prestige, puis un simple rebranding [1]. Comme ce fichier source Prestige n’était pas disponible dans ce projet, l’interface dashboard Mister B a été **reconstruite dans la même logique fonctionnelle** plutôt que copiée à l’identique. Le résultat respecte les blocs attendus : authentification, KPI, graphiques, tableau journalier, vue live et période personnalisée.

Le guide prévoit aussi l’ajout du Pixel Meta directement dans `client/index.html` [1]. L’intégration backend CAPI est prête et le tracking client déclenche déjà les événements côté navigateur si `fbq` est présent, mais le branchement final du **vrai pixel de production** reste conditionné à la fourniture du `FB_PIXEL_ID`.

## Prochaines actions restantes

| Priorité | Action | Pourquoi |
| --- | --- | --- |
| Haute | Renseigner `DASHBOARD_PASSWORD` | Remplacer le mot de passe de démonstration par le secret réel |
| Haute | Renseigner `FB_PIXEL_ID` | Activer le vrai Pixel Meta sur la landing |
| Haute | Renseigner `FB_CONVERSIONS_API_TOKEN` | Activer l’envoi serveur CAPI vers Meta |
| Moyenne | Refaire une validation navigateur avec les vrais secrets | Vérifier le cycle complet landing → tracking → dashboard → Meta |
| Moyenne | Sauvegarder un checkpoint web final | Permettre la revue et la publication côté interface |

## Références

[1]: file:///home/ubuntu/upload/GuidecompletReproduireleDashboardPrestigesurunautrebusiness.pdf "Guide complet : Reproduire le Dashboard Prestige sur un autre business"
