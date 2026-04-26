# Synthèse de compréhension du guide dashboard Mister B

Date de formalisation : 2026-04-13.

Cette note formalise la compréhension de travail qui a guidé la refonte du dashboard Mister B à partir de la vidéo et du PDF fournis précédemment par l’utilisateur. Elle ne remplace pas les sources d’origine, mais elle explicite de manière traçable les éléments fonctionnels et visuels qui ont été retenus pour l’implémentation.

| Axe | Compréhension retenue | Traduction dans le projet |
| --- | --- | --- |
| Structure générale | Le dashboard doit reprendre une hiérarchie très lisible, avec un en-tête sombre, des cartes de lecture rapide, un bloc de statut publicitaire fortement visible, puis les sections de détail. | La page `/dashboard` affiche un header compact, des indicateurs live, un bloc **AD STATUS**, puis les blocs KPI, graphique, tableau journalier et événements récents. |
| Fenêtres temporelles | L’utilisateur attend des filtres fixes : depuis minuit, 48h, 7 jours, 15 jours et 30 jours. | Les filtres présents dans le dashboard reflètent exactement ces plages. |
| Lecture “24h” | La logique voulue n’est pas une fenêtre glissante, mais une lecture depuis minuit jusqu’au moment présent. | Le libellé et la logique ont été alignés sur « depuis minuit ». |
| Priorité métier | Le dashboard doit permettre de savoir rapidement si la publicité est active et si l’acquisition est fraîche. | Le bloc **AD STATUS** affiche un état actif visible, la dernière visite et un indicateur de fraîcheur. |
| Détail analytique | Après la lecture synthétique, le dashboard doit montrer les volumes de visites, clics, conversions et événements récents. | Les cartes KPI, le graphique, le tableau **Daily Breakdown** et la section **Recent Events** remplissent ce rôle. |
| Landing page | La landing restaurée ne doit pas être dégradée par la refonte du dashboard. | La route `/` a été conservée et revalidée séparément. |

En pratique, cette compréhension a suffi pour exécuter la refonte sans clarification bloquante supplémentaire. Les éventuels écarts résiduels ne concernent pas la structure du dashboard livrée, mais des validations externes comme la configuration Meta/CAPI ou la publication du projet sur un domaine public définitif.
