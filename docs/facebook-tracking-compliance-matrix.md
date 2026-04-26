# Matrice de conformité — guide Facebook / dashboard vs implémentation Mister B

## Références

- Source relue directement : `file:///home/ubuntu/upload/GuidecompletReproduireleDashboardPrestigesurunautrebusiness.pdf`
- Synthèse de lecture directe : `docs/facebook-tracking-guide-summary.md`
- Mapping projet déjà préparé : `dashboard-guide-requirements.md`

## Matrice

| Exigence du guide | Fichier(s) Mister B concernés | État constaté | Commentaire |
| --- | --- | --- | --- |
| Tracking client relié à la landing | `client/src/lib/tracking.ts`, `client/src/pages/Home.tsx` | Conforme | Le tracking applicatif envoie les événements clés sans modifier le design de la landing. |
| Pixel navigateur présent côté HTML | `client/index.html` | Conforme avec ajustement | Le `PageView` automatique du snippet HTML a été retiré pour éviter le double déclenchement navigateur maintenant que l’application pilote l’`event_id` partagé. |
| Déduplication navigateur + serveur par `event_id` | `client/src/lib/tracking.ts`, `server/facebookCapi.ts`, `server/routers.ts` | Conforme | Les événements importants partagent désormais l’`event_id` entre navigateur et backend. |
| Facebook CAPI serveur | `server/facebookCapi.ts` | Conforme côté code | La couche serveur gère les événements standards et custom utiles au guide, y compris les scrolls et la déduplication. |
| Routage API du tracking | `server/routers.ts` | Conforme | Les événements sont stockés puis routés vers Meta CAPI sans casser les événements existants. |
| Scroll depth remonté côté guide | `client/src/lib/tracking.ts`, `server/routers.ts`, `server/facebookCapi.ts` | Conforme | Les paliers de scroll sont transmis au backend puis vers Meta avec métadonnées custom. |
| Dashboard alimenté par la base | `server/db.ts`, `client/src/pages/Dashboard.tsx` | Conforme | Le dashboard lit bien les événements persistés pour construire ses vues. |
| Fenêtres live cohérentes pour validation tracking | `server/db.ts` | Conforme après correctif | Les fenêtres temps réel reposent maintenant sur l’horloge SQL, ce qui corrige le décalage observé entre application et base. |
| Validation par tests | `server/misterb.dashboard.test.ts`, `server/meta.conversions-api-token.test.ts` | Conforme | Les tests ciblés passent, dont la couverture du routage scroll vers Meta. |
| Appel Meta réellement accepté en production | Secret / compte Meta externe | Bloqué hors code | Les logs montrent encore une erreur Graph API 400 (`code 100`, `subcode 33`) indiquant un problème d’objet Pixel ou de permissions Meta externes. |

## Conclusion opérationnelle

Le projet Mister B est désormais **aligné côté code** avec la logique du guide : tracking client, pixel navigateur piloté proprement, envoi serveur CAPI, déduplication par `event_id`, et dashboard recollé à la vraie horloge de la base.

Le blocage restant n’est plus dans l’implémentation du projet mais dans l’environnement Meta externe. Les journaux d’exécution montrent que Meta refuse encore les requêtes CAPI avec une erreur de type :

> Unsupported post request. Object with ID `945883278158292` does not exist, cannot be loaded due to missing permissions, or does not support this operation.

En conséquence, la conformité technique du projet est atteinte **jusqu’à la frontière Meta**, mais la validation finale dans Events Manager dépend encore de la correction du Pixel/compte/permissions côté Meta.
