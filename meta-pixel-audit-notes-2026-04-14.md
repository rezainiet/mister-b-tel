# Audit pixel Meta Mister B — notes intermédiaires

La landing publique `https://mister-b.club/` s’est chargée correctement au moment du contrôle. Le rendu visuel observé correspond bien à la version compacte attendue avec fond vert vif `#1BD51C`, logo centré, deux CTA principaux et lien discret vers l’accès suivi privé.

Le contrôle direct dans le contexte navigateur confirme que `window.fbq` est bien défini comme une fonction sur la page chargée. La ressource `https://connect.facebook.net/en_US/fbevents.js` est également présente dans les ressources réellement chargées, ce qui confirme que le script Pixel Meta navigateur est bien injecté et téléchargé au runtime.

À ce stade de l’audit, aucune erreur JavaScript n’est visible dans la console du navigateur après chargement de la landing. Un contrôle complémentaire reste nécessaire côté réseau serveur et remontée Conversions API afin de déterminer si les événements sont seulement déclenchés dans le navigateur, ou également acceptés par Meta côté serveur.

## Constats réseau et serveur après tests réels

Les journaux réseau du projet montrent qu’une visite réelle de test déclenche bien des appels `POST /api/trpc/tracking.record?batch=1` avec des réponses HTTP `200`, ce qui confirme que la chaîne **landing → backend de tracking** est active. Les événements observés dans les journaux récents incluent au minimum `pageview`, ainsi que des événements `scroll_25`, `scroll_50`, `scroll_75` et `scroll_100` envoyés presque immédiatement après chargement de la page.

Ce point révèle un comportement important de l’implémentation actuelle : comme la landing tient pratiquement sur un seul écran mobile, le calcul de profondeur de scroll considère l’absence de zone scrollable comme un scroll déjà complété, puis envoie directement plusieurs seuils `scroll_*`. Techniquement, les événements remontent bien, mais sémantiquement cela signifie que les événements de profondeur de scroll sont **sur-déclarés dès l’arrivée**, même sans véritable défilement utilisateur.

Côté Conversions API, les journaux serveur affichent encore des erreurs `400` répétées pour l’objet Meta `945883278158292`, avec le message indiquant que l’objet n’existe pas, n’est pas accessible avec les permissions actuelles, ou ne supporte pas l’opération. En pratique, cela confirme que la chaîne **backend → Meta CAPI** tente bien d’envoyer les événements, mais que Meta les rejette toujours à cause d’un problème de configuration ou d’autorisations sur le Pixel ID et/ou le token utilisés.

Les derniers tests de clics ont confirmé que les deux CTA principaux existent bien dans le DOM, avec des liens sortants vers `https://whatsapp.com/channel/0029Vb7Gsop1XquZ5XHDOl2W` et `https://t.me/MisterBNMB`. Après déclenchement de ces interactions de test, les journaux serveur continuent d’afficher de nouvelles erreurs `400` côté Meta CAPI au même Pixel ID `945883278158292`, ce qui confirme que le backend tente toujours d’envoyer les conversions mais que Meta les refuse systématiquement.

Les journaux historiques disponibles confirment également la présence d’événements `whatsapp_click` déjà remontés dans le système de tracking. Les traces extraites pendant cet audit n’ont pas affiché de nouvelle entrée `telegram_click` lisible dans l’extrait de logs obtenu, mais l’implémentation de la landing et du routeur serveur montre que ce clic suit exactement la même chaîne applicative que WhatsApp, en remplaçant seulement le type d’événement et la conversion Meta cible.

## Référence officielle Meta consultée

La documentation officielle Meta sur la Conversions API précise que cette API sert à établir une connexion entre les données marketing de l’annonceur et les systèmes Meta, et qu’en intégration directe les événements serveur sont envoyés vers l’endpoint de la Conversions API puis liés à un identifiant de dataset/pixel côté Meta. Elle rappelle aussi que la vérification de l’installation et le dépannage des erreurs Graph API font partie du flux normal de validation.
