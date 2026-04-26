# Notes de test navigateur — nouveau flux Telegram

La prévisualisation du projet charge correctement la landing Mister B et affiche le bouton **GROUPE TELEGRAM**.

Les vérifications DOM montrent actuellement que le bouton garde comme `href` visible le lien web d’invitation `https://t.me/+sdIa7KNoIbNjMTg0`, avec `target="_self"` et l’attribut `data-direct-open="telegram-bot"`.

Le comportement direct vers le bot/session est donc piloté par le gestionnaire `onClick`, et non par l’attribut `href` lui-même. Lors du clic dans le navigateur de test, aucune erreur JavaScript n’est apparue dans la console. En revanche, le navigateur de contrôle est resté sur la landing, ce qui suggère qu’un deep link `tg://` peut être ignoré ou bloqué dans cet environnement de test sans application Telegram installée.

Conclusion provisoire : le DOM est cohérent avec une stratégie « interception du clic + tentative d’ouverture Telegram + fallback », mais il faut encore vérifier côté réseau et éventuellement ajuster le fallback ou l’URL visible si l’on veut un comportement plus observable dans les tests navigateur automatisés.
