# Notes de refonte dashboard Mister B — 2026-04-13

## Référence à reproduire

Le dashboard de référence est un **tableau de bord sombre**, mobile-first, avec une hiérarchie verticale très nette. L’en-tête attendu comprend un **titre serif doré**, un sous-titre discret, un contrôle de langue, un sélecteur de période de type **dropdown** affichant par défaut **Since midnight**, un bouton de rafraîchissement et un bouton de déconnexion rouge. Le premier bloc visible doit être un **AD STATUS** proéminent avec bordure verte lumineuse, statut actif, visites sur 5 minutes, visites sur 4 heures et dernière visite.

La suite de la page doit enchaîner des **cartes métriques simples** dans cet ordre logique : Landing Page Visits, Unique Visitors, WhatsApp Clicks, Telegram Clicks, Conversion Rate, puis Scroll 25/50/75/100. Enfin, la référence se termine par trois blocs structurants : **Daily Traffic** (graphique), **Daily Breakdown** (tableau) et **Recent Events** (liste live).

## Écarts constatés sur le dashboard actuel

Le dashboard actuel n’est pas aligné visuellement avec la référence. Il utilise une identité **claire/verte**, des cartes blanches, une page d’accès séparée très marketing, et un header de type suite analytique moderne, alors que la référence demande un rendu **plus compact, sombre, premium et directement inspiré de Prestige Tracker**.

Le système de filtres actuel repose sur un switch **Aujourd’hui / Période choisie** avec champs date début / fin. Cela ne correspond pas au comportement demandé. Il faut remplacer cela par une logique de **presets temporels** pilotée par un contrôle unique, où le bouton **24 heures** signifie en réalité **depuis minuit jusqu’à maintenant**, et où les autres boutons/presets couvrent au minimum 48 heures, 7 jours, 15 jours et 30 jours.

Le dashboard actuel contient déjà des données utiles : totaux, scrolls, graphique, tableau, événements récents. En revanche, il ne possède pas encore une carte **AD STATUS** au format de la référence, ni les indicateurs live demandés de façon explicite par l’utilisateur pour **5 minutes**, **10 minutes**, **4 heures**, et **dernière visite**. La structure des couleurs n’est pas non plus calée sur la sémantique de la référence.

## Décisions de refonte

La prochaine implémentation doit conserver la base fonctionnelle existante, mais **refaire le rendu du dashboard** selon ces règles :

1. Passer la page authentifiée en **dark mode** avec fond bleu nuit/anthracite.
2. Construire un header fidèle à la référence avec branding Mister B adapté, sans casser la hiérarchie de Prestige Tracker.
3. Remplacer le système actuel de mode par des **presets temporels** :
   - 24h = depuis minuit jusqu’à maintenant
   - 48h
   - 7 jours
   - 15 jours
   - 30 jours
4. Ajouter des métriques live dédiées :
   - visites 5 min
   - visites 10 min
   - visites 4 h
   - dernière visite
   - statut publicitaire actif/inactif selon fraîcheur du trafic
5. Réorganiser les cartes KPI pour retrouver l’ordre visuel de la référence.
6. Garder les sections **Daily Traffic**, **Daily Breakdown** et **Recent Events**, mais les restyler pour coller à la maquette cible.
7. Réappliquer les **couleurs Mister** sur la base sémantique attendue : violet pour visites, cyan pour uniques, vert pour WhatsApp et statut, bleu pour Telegram, or pour conversion et titres complexes.

## Impact serveur à prévoir

La couche serveur devra probablement être élargie pour exposer les indicateurs live nécessaires au bloc AD STATUS et pour gérer les nouveaux presets temporels au lieu du simple couple `today/range`.
