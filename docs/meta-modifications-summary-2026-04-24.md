# Synthèse des modifications Meta — Mister B

**Auteur : Manus AI**  
**Date : 24 avril 2026**

## Objet du document

Ce document récapitule les **modifications effectivement réalisées** sur le projet Mister B pour remettre en état le tracking Meta sur `mister-b.club`, puis sécuriser l’envoi serveur vers la Conversions API. Il est destiné à une revue rapide du travail effectué avant analyse détaillée du code joint.[1] [2] [3] [4] [5] [6] [7]

## Résumé exécutif

Le travail effectué a porté sur deux couches distinctes du suivi Meta. D’un côté, le **Pixel navigateur** a été réamorcé dès le HTML afin que le `PageView` existe réellement sur le domaine publié avec un `eventID` partagé. De l’autre, le **tracking serveur CAPI** a été consolidé pour que les événements utilisent les bonnes variables d’environnement, transportent les données utilisateur utiles (`ip`, `user-agent`, `fbc`, `fbp`, `external_id`) et ne soient plus lancés en arrière-plan sans attente explicite côté routeur.[1] [2] [3] [4]

La situation finale est plus nette qu’au début du diagnostic. Le domaine publié sert maintenant bien le bootstrap Pixel attendu, le nouveau token `META_CONVERSIONS_TOKEN` répond correctement sur l’API Graph via le test léger existant, et un appel direct à l’endpoint Meta `/events` avec des `user_data` conformes est accepté avec `events_received: 1`.[5] [6] [7]

## Tableau des changements réalisés

| Zone | Fichier | Modification réalisée | Effet recherché |
| --- | --- | --- | --- |
| Bootstrap navigateur | `client/index.html` | Pré-génération de `_fbp`, création synchrone d’un `PageView event ID`, stockage en `sessionStorage`, chargement explicite de `fbevents.js`, envoi immédiat du `PageView` navigateur | Garantir un `PageView` navigateur visible dès le chargement de la landing et partager le même `eventID` avec le serveur [1] |
| Tracking client | `client/src/lib/tracking.ts` | Persistance de `_fbc` si `fbclid` est présent, lecture prioritaire du `PageView event ID` bootstrappé, envoi de `fbc` et `fbp` dans `tracking.record` | Renforcer la qualité de correspondance Meta et la déduplication browser/CAPI [2] |
| CAPI principal | `server/facebookCapi.ts` | Utilisation exclusive de `META_PIXEL_ID` et `META_CONVERSIONS_TOKEN`, payload `user_data` avec `client_ip_address`, `client_user_agent`, `external_id`, `fbc`, `fbp` | Normaliser le backend Meta et éviter les secrets divergents [3] |
| CAPI bot Telegram | `server/metaCapi.ts` | Même unification des variables d’environnement et maintien d’un payload `Subscribe` enrichi | Conserver la cohérence entre le flux landing et le flux Telegram bot [4] |
| Routeur de tracking | `server/routers.ts` | Extraction serveur de l’IP et du user-agent, transmission de `fbc`/`fbp`, remplacement du `void sendPageView(...)` par `await sendPageView(...)` | Éviter les pertes silencieuses d’envoi CAPI en runtime live [5] |
| Validation | `server/meta.conversions-api-token.test.ts`, `server/misterb.dashboard.test.ts` | Revalidation du nouveau token via Graph API et ajout d’un test prouvant que `tracking.record` attend bien l’appel Meta PageView | Sécuriser le correctif et éviter les régressions [6] |
| Contrôle live | `docs/meta-live-recheck-2026-04-24.md` | Vérification du HTML publié et test direct `/events` avec payload conforme | Confirmer que le pixel publié et l’endpoint CAPI sont maintenant opérationnels [7] |

## Détail des modifications appliquées

### 1. Réactivation propre du Pixel navigateur

Le HTML de la landing initialise désormais le suivi Meta **avant même le chargement complet de la bibliothèque Pixel**. Le fichier `client/index.html` crée un cookie `_fbp` si besoin, fabrique un identifiant `PageView` synchronement, le stocke dans `sessionStorage`, charge `fbevents.js`, puis appelle `fbq("init", ...)` et `fbq("track", "PageView", ..., { eventID })` sans attendre le reste de l’application.[1]

Ce point est important car il réduit le risque d’avoir une page servie sans véritable `PageView` navigateur au tout premier chargement. Il permet aussi de garder un identifiant commun entre l’événement navigateur et l’événement serveur, ce qui améliore la **déduplication** côté Meta.[1] [2]

### 2. Renforcement de la couche de tracking côté client

Le fichier `client/src/lib/tracking.ts` a été ajusté pour ne plus dépendre uniquement d’un flux navigateur partiel. Lorsqu’un `fbclid` est présent dans l’URL, le code reconstruit et persiste `_fbc` en cookie. La même librairie relit ensuite prioritairement l’`eventID` de `PageView` déjà injecté dans `sessionStorage`, ce qui évite de créer deux identifiants indépendants pour une même visite.[2]

Le même module envoie aussi `fbc` et `fbp` vers la mutation `tracking.record`. Autrement dit, le backend reçoit désormais les éléments nécessaires pour composer un payload CAPI utile au matching Meta, au lieu de compter sur des hypothèses implicites.[2] [5]

### 3. Unification des secrets Meta côté serveur

Les deux modules serveur dédiés à Meta utilisent maintenant **une seule convention de secrets** : `META_PIXEL_ID` et `META_CONVERSIONS_TOKEN`. Les anciennes lectures concurrentes de `FB_PIXEL_ID`, `FB_CONVERSIONS_API_TOKEN` ou `META_CAPI_TOKEN` ont été retirées du flux actif, ce qui supprime une source classique d’écart entre la configuration réelle et la configuration supposée.[3] [4]

Cette unification réduit les ambiguïtés lors des diagnostics. Quand un événement part maintenant vers Meta, il le fait contre le pixel `945883278158292` et avec le token courant injecté dans `META_CONVERSIONS_TOKEN`, ce qui simplifie fortement la vérification opérationnelle.[3] [4] [6]

### 4. Vérification du transport réel des données utiles vers CAPI

Le routeur `tracking.record` extrait bien le `user-agent` et l’IP client depuis la requête serveur, puis les transmet au payload CAPI avec `fbc`, `fbp`, `visitorId`, `eventId` et `sourceUrl`. Ce point était critique parce que l’erreur Meta observée sur un test manuel minimal n’indiquait pas un manque de permission, mais un manque de **customer information parameters**.[5]

En clair, le projet dispose bien maintenant de la chaîne complète qui remonte les éléments nécessaires à Meta lorsque la visite réelle passe par la landing. Le test manuel minimal qui échouait auparavant ne faisait que démontrer qu’un payload sans `user_data` suffisants est refusé ; il ne contredisait pas le code de production enrichi.[3] [4] [5] [7]

### 5. Correction de fiabilité : suppression du fire-and-forget sur `sendPageView`

Le dernier défaut purement côté projet se situait dans `server/routers.ts`. La mutation `tracking.record` déclenchait `sendPageView(capiPayload)` en mode **fire-and-forget** via `void sendPageView(...)`. Dans ce mode, la mutation pouvait se résoudre avant la fin de l’appel Meta, ce qui exposait le flux live à des pertes silencieuses ou à des comportements plus difficiles à diagnostiquer en production.[5]

Ce point a été corrigé en remplaçant cet appel par `await sendPageView(capiPayload)`. Un test ciblé a été ajouté dans `server/misterb.dashboard.test.ts` pour prouver que la mutation attend désormais effectivement la fin de l’appel Meta `PageView` avant de se résoudre.[5] [6]

> En pratique, cette correction ne change pas le design de la landing, mais elle rend le flux serveur **plus déterministe** et plus fiable lorsque Meta doit réellement recevoir le `PageView` CAPI.[5] [6]

## Validation effectuée

Les validations réalisées après correction sont résumées ci-dessous.

| Contrôle | Résultat | Lecture |
| --- | --- | --- |
| Test léger du secret Meta (`/me?fields=id,name`) | OK | Le nouveau `META_CONVERSIONS_TOKEN` répond bien sur l’API Graph [6] |
| Suite Vitest complète | OK | `15` fichiers de test passés, `1` suite sautée, `46` tests passés, `2` sautés | 
| Recontrôle HTML publié `mister-b.club` | OK | Le domaine publié sert bien le bootstrap Pixel attendu [7] |
| Test direct `/events` avec payload minimal sans `user_data` suffisants | Refus attendu | Meta demande des `customer information parameters`, ce qui est cohérent avec sa validation [7] |
| Test direct `/events` avec payload complet conforme | OK | Réponse `events_received: 1` [7] |

Ces contrôles montrent que le problème n’est plus le même qu’au début de l’enquête. La chaîne actuelle est cohérente : **Pixel navigateur publié présent**, **token actif**, **endpoint `/events` acceptant un payload conforme**, et **routeur serveur sécurisé contre le fire-and-forget**.[5] [6] [7]

## Fichiers de code à analyser en priorité

Si vous souhaitez contrôler rapidement le code, les fichiers les plus importants à ouvrir sont les suivants.

| Priorité | Fichier | Pourquoi le lire |
| --- | --- | --- |
| 1 | `client/index.html` | Vérifier le bootstrap Pixel et l’envoi initial du `PageView` [1] |
| 2 | `client/src/lib/tracking.ts` | Vérifier la persistance `_fbc`, la lecture de l’`eventID` bootstrappé et l’envoi de `fbc`/`fbp` [2] |
| 3 | `server/routers.ts` | Vérifier l’extraction IP/user-agent et le `await sendPageView(...)` [5] |
| 4 | `server/facebookCapi.ts` | Vérifier la composition du payload `PageView` CAPI et l’unification des secrets [3] |
| 5 | `server/metaCapi.ts` | Vérifier le flux `Subscribe` côté bot Telegram [4] |
| 6 | `server/meta.conversions-api-token.test.ts` | Vérifier la revalidation du nouveau token [6] |
| 7 | `server/misterb.dashboard.test.ts` | Vérifier le test de non-régression ajouté pour l’attente explicite du `PageView` Meta [6] |

## Conclusion

Les modifications apportées ne sont pas cosmétiques. Elles portent sur le **bootstrap Pixel live**, la **qualité des paramètres de matching**, l’**unification des secrets Meta**, et la **fiabilité d’exécution** de l’appel serveur `PageView`. À ce stade, le projet sert le bon code sur le domaine publié et Meta accepte un événement `/events` conforme, ce qui confirme que les corrections récentes ont bien traité la partie projet du problème.[1] [3] [5] [7]

La pièce jointe de code fournie séparément correspond au checkpoint du projet afin que vous puissiez relire l’implémentation directement dans son état sauvegardé.

## References

[1]: file:///home/ubuntu/landing-page/client/index.html "client/index.html"
[2]: file:///home/ubuntu/landing-page/client/src/lib/tracking.ts "client/src/lib/tracking.ts"
[3]: file:///home/ubuntu/landing-page/server/facebookCapi.ts "server/facebookCapi.ts"
[4]: file:///home/ubuntu/landing-page/server/metaCapi.ts "server/metaCapi.ts"
[5]: file:///home/ubuntu/landing-page/server/routers.ts "server/routers.ts"
[6]: file:///home/ubuntu/landing-page/server/meta.conversions-api-token.test.ts "server/meta.conversions-api-token.test.ts"
[7]: file:///home/ubuntu/landing-page/docs/meta-live-recheck-2026-04-24.md "docs/meta-live-recheck-2026-04-24.md"
