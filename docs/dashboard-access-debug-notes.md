# Notes de diagnostic accès dashboard

Le 14 avril 2026, la page publiée `https://mister-b.club/dashboard` affiche bien le formulaire d’accès privé du dashboard Mister B.

Le champ mot de passe et le bouton `Ouvrir le dashboard` sont visibles sur le domaine publié. Une tentative de saisie avec la valeur `152647` a été reproduite sur la page réelle. Après saisie et clic sur le bouton, l’interface est restée sur l’écran de connexion, sans transition visible vers le dashboard dans la session de test navigateur.

Constat intermédiaire : il faut maintenant vérifier si le clic ne déclenche pas l’action attendue, si la requête de login échoue côté client, ou si le domaine publié ne reflète pas encore la valeur de secret active dans l’environnement courant.

## Revalidation finale après décision utilisateur

Après clarification avec l’utilisateur, la tentative de changement vers `152647` a été abandonnée.

Une nouvelle connexion a ensuite été retestée en navigateur sur `https://mister-b.club/dashboard` avec le mot de passe historique `167842`. Cette fois, la connexion a abouti et l’interface authentifiée du dashboard s’est affichée correctement, avec le sélecteur de période, le bouton `Refresh`, le bouton `Logout` et les cartes statistiques visibles.

Conclusion opérationnelle : le mot de passe réellement actif et conservé côté domaine publié est **167842**.

## Vérification des variantes d’URL avec user-agent mobile

Une vérification HTTP a été relancée avec un user-agent iPhone sur plusieurs variantes plausibles de l’accès dashboard.

| URL testée | Résultat |
|---|---|
| `https://mister-b.club/dashboard` | `200` |
| `https://www.mister-b.club/dashboard` | `200`, redirigé/normalisé vers `https://mister-b.club/dashboard` |
| `http://mister-b.club/dashboard` | `200` |
| `https://mister-b.club/dashboard/` | `200` |
| `https://mister-b.club/#/dashboard` | `200` |

Constat : la 404 mobile n’est pas reproductible à ce stade sur les variantes d’URL les plus probables. Le lien fiable à renvoyer reste `https://mister-b.club/dashboard`.
