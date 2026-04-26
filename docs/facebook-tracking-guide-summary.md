# Synthèse sourcée du guide Facebook / dashboard utilisé pour Mister B

## Source

Document lu directement : `file:///home/ubuntu/upload/GuidecompletReproduireleDashboardPrestigesurunautrebusiness.pdf`.

## Constats confirmés à la lecture directe du PDF

Les premières pages du guide confirment explicitement que le document décrit la reproduction complète du système **tracking + dashboard** de Prestige sur une autre landing, avec une architecture en **trois couches** :

1. **Client — Tracking** : envoi des événements navigateur vers le backend et le pixel Facebook.
2. **Serveur — API** : réception des événements, stockage en base, puis envoi à Facebook CAPI.
3. **Client — Dashboard** : lecture des statistiques stockées pour affichage dans le dashboard.

Le sommaire du PDF confirme aussi les étapes structurantes attendues pour cette implémentation :

| Élément confirmé dans le PDF | Observation directe |
| --- | --- |
| Base de données | Étape dédiée au schéma et aux tables de tracking |
| Helpers serveur | Étape dédiée aux fonctions de stockage et d’agrégation |
| Facebook CAPI | Étape dédiée au serveur Meta / Conversions API |
| Routes API | Étape dédiée aux routes tRPC |
| Tracking client | Étape dédiée au tracking côté landing |
| Pixel Facebook HTML | Étape dédiée au snippet Pixel dans `client/index.html` |
| Dashboard frontend | Étape dédiée à la page dashboard |
| Initialisation sur la landing | Étape dédiée au branchement du tracking sur la page d’accueil |
| Variables d’environnement | Étape dédiée aux secrets et variables Meta |

## Points utiles pour la conformité Mister B

Le PDF confirme que la landing doit suivre un flux cohérent :

> Un visiteur arrive sur la landing, le tracking client envoie un `pageview` au backend, le backend stocke l’événement en base puis l’envoie à Facebook CAPI, et le dashboard lit ensuite ces données pour les afficher.

Cela valide bien la logique de conformité recherchée sur Mister B : **pixel navigateur + backend CAPI + dashboard branché sur la base**.

## Portée de cette note

Cette note sécurise la preuve que le PDF source a bien été relu directement dans ce projet. La matrice détaillée de conformité entre le guide et le code Mister B reste à compléter séparément.
