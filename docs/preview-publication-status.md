# Vérification de l’aperçu et de la publication

Date de contrôle : 2026-04-13.

La route d’aperçu `/dashboard` répond correctement sur l’URL de prévisualisation active du projet et affiche bien l’interface **Mister B Tracker** avec le bloc **AD STATUS** en état **Ad active**.

Le bandeau de l’aperçu indique toutefois explicitement : "Preview mode — This page is not live and cannot be shared directly. Please publish to get a public link." Cela confirme que la route fonctionne côté aperçu, mais qu’aucun domaine publié public n’est disponible à vérifier à ce stade.

Conséquence de gestion de backlog :

- le 404 initial ne se reproduit pas sur l’aperçu courant ;
- la validation sur domaine publié ne peut pas être clôturée sans publication effective depuis l’interface ;
- la livraison d’un lien public définitif dépend d’une action de publication par l’utilisateur.
