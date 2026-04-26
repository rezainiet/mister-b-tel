# Recontrôle live Meta du 2026-04-24

## Domaine publié

Le HTML servi par `https://mister-b.club/` contient bien les éléments suivants après publication : génération du cookie `_fbp`, stockage du `PageView event ID` dans `sessionStorage`, chargement de `https://connect.facebook.net/en_US/fbevents.js`, initialisation `fbq("init", "945883278158292")`, envoi `fbq("track", "PageView", {}, { eventID: _pvEventId })`, et balise `noscript` pointant vers `https://www.facebook.com/tr?id=945883278158292&ev=PageView&noscript=1`.

## Validation directe de l’endpoint Meta `/events`

Un appel `POST https://graph.facebook.com/v21.0/945883278158292/events` avec le secret `META_CONVERSIONS_TOKEN` courant et un payload complet contenant `client_ip_address`, `client_user_agent`, `fbp`, `fbc` et `external_id` a retourné la réponse suivante :

```json
{"events_received":1,"messages":[],"fbtrace_id":"A0zbQ5zu1Ex_YF_wpTMD7P-"}
```

## Conclusion

Le blocage n’est plus un problème d’autorisation du token sur le pixel ni une absence de bootstrap Pixel dans le HTML publié. Les contrôles live montrent que le domaine publié sert bien le code attendu et que Meta accepte un événement CAPI conforme quand les `user_data` requis sont présents.
