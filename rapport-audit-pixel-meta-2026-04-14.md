# Audit du pixel Meta et du tracking — Mister B

## Conclusion exécutive

Le test mené sur la landing publique **Mister B** montre que le **pixel navigateur est bien chargé**, que la fonction `fbq` est disponible dans la page et que le **backend de tracking enregistre bien les événements** avec des réponses HTTP `200` sur l’endpoint applicatif. En revanche, la **Conversions API côté serveur n’est pas valide en production à cet instant**, car Meta rejette toujours les envois avec une erreur `400` de type `GraphMethodException`, code `100`, sous-code `33`, sur l’objet `945883278158292`. La documentation officielle Meta rappelle que la Conversions API sert à envoyer les événements serveur vers les systèmes Meta via un endpoint associé au jeu de données / pixel configuré, puis à vérifier la bonne réception et le dépannage des erreurs Graph API [1].

En pratique, cela signifie que le système de suivi est **partiellement opérationnel**. La chaîne **landing → pixel navigateur** fonctionne, la chaîne **landing → backend de tracking → base / logs** fonctionne aussi, mais la chaîne **backend → Meta Conversions API** reste bloquée par un problème d’identifiant d’objet ou de permissions côté Meta. Un second point de qualité a été identifié pendant l’audit : la landing tenant sur un seul écran, l’implémentation actuelle du calcul de scroll envoie immédiatement plusieurs événements `scroll_25`, `scroll_50`, `scroll_75` et `scroll_100`, ce qui fausse l’interprétation métier de la profondeur de scroll.

## Résultats détaillés

| Zone testée | État constaté | Impact métier |
| --- | --- | --- |
| Chargement du pixel navigateur | Le script Meta est chargé et `window.fbq` est bien présent dans la page | Les événements navigateur peuvent être déclenchés côté landing |
| Initialisation HTML du pixel | Le pixel `945883278158292` est initialisé dans `client/index.html` | La landing tente bien de parler au pixel configuré |
| Endpoint backend de tracking | Les appels `POST /api/trpc/tracking.record?batch=1` répondent bien en `200` | Les événements sont correctement reçus par l’application |
| Remontée Conversions API | Rejet Meta `400` récurrent sur le Pixel ID / objet `945883278158292` | Les événements serveur ne sont pas acceptés par Meta |
| Événements de scroll | Les seuils de scroll partent immédiatement sur une page quasi non scrollable | Les statistiques scroll sont actuellement sur-déclarées |
| Dashboard / serveur | Le serveur tourne, TypeScript est sans erreur, la landing reste fonctionnelle | Le problème est ciblé sur la couche Meta CAPI, pas sur le site lui-même |

## Ce qui fonctionne réellement aujourd’hui

Le contrôle direct de la landing a confirmé que la page publique se charge correctement avec sa version visuelle finale. Dans le contexte navigateur, `fbq` est bien défini comme une fonction et la ressource `fbevents.js` est bien chargée. Cela valide la présence du pixel côté navigateur.

Les journaux du projet montrent aussi que les visites de test déclenchent bien des requêtes `tracking.record` acceptées par le serveur. Des événements de type `pageview`, `unique_visitor` et des événements de clics existent déjà dans les traces système. Autrement dit, le mécanisme applicatif de collecte n’est pas cassé.

## Ce qui est encore en erreur

Le point bloquant reste la **Conversions API**. Les journaux serveur affichent encore des erreurs répétées du type suivant : objet `945883278158292` introuvable, inaccessible avec les permissions actuelles, ou non compatible avec l’opération demandée. Au regard du fonctionnement normal de la Conversions API décrit par Meta, ce symptôme est cohérent avec l’un des cas suivants : soit le **Pixel ID / dataset ID configuré n’est pas le bon**, soit le **token CAPI ne possède pas l’accès à cette source de données**, soit le pixel est rattaché à un autre compte Business / autre contexte d’autorisations [1].

> En d’autres termes, le serveur envoie bien les conversions, mais Meta refuse encore de les accepter.

## Point de qualité détecté pendant l’audit

L’implémentation actuelle du calcul de profondeur de scroll considère qu’une page sans hauteur scrollable équivaut à `100 %` de scroll. Comme la landing tient quasiment dans un seul écran, cela déclenche immédiatement plusieurs événements `scroll_*` dès le chargement. Ce comportement ne casse pas la landing, mais il **dégrade la qualité analytique** du tracking, car il transforme une simple visite statique en scroll complet artificiel.

## Recommandation opérationnelle

| Priorité | Action recommandée | Effet attendu |
| --- | --- | --- |
| Haute | Vérifier dans Meta Events Manager que le Pixel ID `945883278158292` est bien la bonne source de données pour ce business | S’assurer que l’objet ciblé par la CAPI existe réellement dans le bon compte |
| Haute | Régénérer ou remplacer le token Conversions API depuis la source de données réellement associée à ce pixel | Supprimer le blocage de permissions côté Graph API |
| Haute | Refaire un test serveur après mise à jour du couple Pixel ID / token | Vérifier que Meta reçoit enfin les événements serveur |
| Moyenne | Corriger la logique de scroll pour ne pas émettre `scroll_25` à `scroll_100` quand la page n’est pas réellement scrollée | Assainir les statistiques de profondeur de scroll |
| Moyenne | Contrôler dans Events Manager la déduplication navigateur / serveur via `event_id` | Valider proprement le cycle Pixel + CAPI [1] |

## Verdict final

L’audit ne montre pas une panne totale du tracking. Il montre un système **fonctionnel côté site et côté collecte interne**, mais **encore non conforme côté Meta serveur** à cause d’un rejet de permissions / objet sur la Conversions API. Si vous voulez, je peux maintenant effectuer la **correction technique du faux scroll**, puis préparer le terrain pour une **revalidation Meta CAPI** dès que le bon couple **Pixel ID + token autorisé** est confirmé.

## References

[1]: https://developers.facebook.com/docs/marketing-api/conversions-api/ "Meta for Developers — Conversions API"
