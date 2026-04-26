# Notes de vérification Telegram

Le lien actuel `https://t.me/+sdIa7KNoIbNjMTg0` ouvre une page intermédiaire Telegram « Join Group Chat / Join Channel » avec un bouton de confirmation supplémentaire.

La documentation officielle Telegram sur les deep links indique que les liens d’invitation de chat existent en deux formes pertinentes pour ce cas : `t.me/+<hash>` et `tg://join?invite=<hash>`.

Conclusion de travail : pour réduire l’étape intermédiaire quand l’application Telegram est installée, la landing peut tenter d’ouvrir directement `tg://join?invite=sdIa7KNoIbNjMTg0`, puis prévoir un fallback web vers `https://t.me/+sdIa7KNoIbNjMTg0` si l’ouverture directe n’aboutit pas.
