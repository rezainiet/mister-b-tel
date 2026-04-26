# Notes de vérification

La prévisualisation de la landing page affiche désormais un toast social en haut à gauche avec le prénom **Lucas** et le message **« a rejoint le groupe privé »**. L’ensemble du contenu principal tient encore dans un seul écran mobile, sans défilement visible.

La vérification côté navigateur confirme que `window.fbq` est bien chargé et initialisé comme une fonction sur la page **Mister B**. Le fallback `noscript` n’apparaît pas dans le DOM inspecté côté navigateur actif, ce qui est cohérent avec le fait qu’il ne sert qu’en cas de JavaScript désactivé.
