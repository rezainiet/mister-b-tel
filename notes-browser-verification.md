# Vérification visuelle Mister B

## Landing

- La landing Mister B se charge correctement sur `/` avec le logo, le titre principal, les deux CTA et le lien discret vers le dashboard.
- Les imports cassés introduits par l’upgrade ont été corrigés : la page n’affiche plus le contenu d’exemple du template.

## Dashboard

- La page `/dashboard` affiche correctement l’écran de connexion privé avec le formulaire de mot de passe.
- La connexion avec le mot de passe de démonstration `misterb-dashboard-demo` fonctionne.
- Une fois connecté, le dashboard affiche les cartes KPI, les boutons de mode (`Aujourd’hui`, `Période choisie`), le bouton de rafraîchissement et le bouton de verrouillage.
- Les statistiques live depuis minuit remontent déjà des événements de test (pageviews, visiteurs uniques, scroll depth), ce qui confirme le bon câblage général entre tracking frontend et backend.
