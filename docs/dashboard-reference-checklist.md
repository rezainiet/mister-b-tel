# Note de conformité — dashboard Mister B

Cette note cadre la refonte du dashboard par rapport aux références utilisateur disponibles pendant la session, à savoir la vidéo et le PDF explicatif mentionnés dans les échanges précédents. L’objectif n’est pas d’affirmer une identité pixel perfect non démontrée, mais de tracer les correspondances effectivement mises en place dans le projet.

| Axe de référence | Implémentation actuelle | Statut |
| --- | --- | --- |
| Landing séparée du dashboard | La landing Mister B reste sur `/` et le dashboard refait est isolé sur `/dashboard`. | Conforme |
| Ambiance premium et pilotage temps réel | Le dashboard a été reconstruit en interface sombre, dense, mobile-first, avec focus sur lecture live, fraîcheur et statut de campagne. | Conforme avec adaptation stylistique |
| Bloc principal de statut publicitaire | Le dashboard expose un bloc **AD STATUS** avec état, libellé, fenêtre courte, dernière visite et indicateur de fraîcheur. | Conforme |
| Lecture des périodes | Le dashboard propose des presets rapides centrés sur l’exploitation marketing : depuis minuit, 48h, 7 jours, 15 jours et 30 jours. | Conforme avec sélection de presets retenus dans le projet |
| KPI de campagne | Le dashboard affiche pageviews, visiteurs uniques, clics WhatsApp, clics Telegram, conversion et profondeur de scroll. | Conforme |
| Vision trafic détaillée | La page contient une vue journalière, un tableau de répartition et un flux d’événements récents. | Conforme |
| Publicité active visible | Après génération d’un signal réel récent, le bloc **AD STATUS** affiche **Ad active** et **Publicité active maintenant** dans l’aperçu. | Conforme sous condition de données récentes |
| Comportement purement testable | La logique de fraîcheur et de présentation a été sortie dans `shared/dashboard.ts` puis couverte par Vitest. | Conforme |

## Écarts assumés

La conformité recherchée a été traitée comme une **reconstruction fonctionnelle et visuelle orientée usage**, pas comme une copie stricte au pixel près. Les choix de design finaux ont été adaptés au stack existant, à la structure des données disponibles et à l’objectif d’obtenir un dashboard exploitable immédiatement dans le projet actuel.

L’état **Ad active** dépend désormais d’un signal récent réel, ce qui évite un faux état actif permanent. En pratique, l’aperçu montre bien cet état lorsqu’une visite fraîche est enregistrée, comme lors de la vérification effectuée après ouverture de la landing.
