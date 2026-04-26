# Livraison finale — Mister B

Date de préparation : 2026-04-13.

Ce document récapitule les informations d’accès utiles pour la version actuellement sauvegardée du projet **Mister B** ainsi que les limites connues observées au moment de la vérification finale.

| Élément | Valeur actuelle | Commentaire |
| --- | --- | --- |
| Checkpoint recommandé | `180c176a` | Dernier état sauvegardé après mise à jour du mot de passe dashboard et clarification du backlog. |
| Checkpoint précédent utile | `e4a85e90` | Version sauvegardée juste après la refonte principale du dashboard et les validations initiales. |
| URL d’aperçu | `https://3000-itnwh51j4r6px3uvmdfw3-8bb3c279.us2.manus.computer/` | Sert à vérifier le projet dans l’environnement de prévisualisation actuel. |
| Route dashboard en aperçu | `/dashboard` | La page s’ouvre correctement en aperçu sur cette route. |
| Mot de passe dashboard | `167842` | Mot de passe configuré côté projet pour l’accès au dashboard. |
| Statut de publication | Non publié à ce stade | L’aperçu affiche un bandeau indiquant que la page n’est pas encore live ni partageable directement. |

L’état actuellement recommandé à utiliser est donc le **checkpoint `180c176a`**, qui contient la landing conservée, le dashboard refait, le mot de passe dashboard mis à jour et les validations automatisées déjà exécutées.

## Étapes d’accès conseillées

Pour consulter la landing, il faut ouvrir l’URL d’aperçu racine. Pour consulter le dashboard, il faut ouvrir l’URL d’aperçu puis aller sur la route `/dashboard`. Si un écran de connexion dashboard apparaît, le mot de passe actuellement configuré est `167842`.

## Limites connues

| Sujet | Constat actuel | Conséquence pratique |
| --- | --- | --- |
| Publication publique | Le projet n’est pas publié au moment de ce document. | Il n’existe pas encore de lien public définitif à partager. |
| Vérification domaine publié | Impossible à finaliser sans publication effective. | Une vérification supplémentaire sera nécessaire après publication. |
| Tracking Meta / CAPI | Des erreurs 400 de permissions ou d’objet Meta restent visibles dans les logs du projet. | Le tracking existant ne bloque pas le rendu, mais la validation Meta finale dépend d’un correctif côté configuration Meta. |

En pratique, si vous voulez un lien public définitif, il faudra **publier** le projet depuis l’interface de gestion. Une fois cette publication effectuée, une dernière vérification du comportement de `/dashboard` sur le domaine publié sera recommandée.
