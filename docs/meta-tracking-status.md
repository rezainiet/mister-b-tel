# État actuel du tracking Meta / CAPI

Date de rédaction : 2026-04-13.

Le projet conserve le tracking Meta déjà intégré, mais la validation finale côté Meta n’est pas complètement démontrable depuis le projet seul, car les logs récents montrent encore des réponses **400** provenant de l’API Meta côté conversions.

| Point observé | État actuel | Impact |
| --- | --- | --- |
| Pixel / logique de tracking intégrée dans le projet | Présente dans le code existant | Le suivi côté projet reste branché et ne bloque pas l’affichage du site. |
| Erreurs CAPI dans les logs | Présentes | Le backend reçoit des réponses d’échec Meta liées aux permissions ou à l’objet visé. |
| Effet sur le rendu | Non bloquant | La landing et le dashboard continuent à fonctionner malgré ces erreurs. |
| Correctif nécessaire | Externe au code applicatif | Une correction des permissions, de l’identifiant Meta ciblé ou de la configuration du compte est nécessaire. |

Les messages d’erreur observés dans les logs du projet prennent la forme suivante : une requête non prise en charge vers l’objet `945883278158292`, accompagnée d’un message indiquant que l’objet n’existe pas, n’est pas accessible avec les permissions actuelles, ou ne supporte pas l’opération demandée.

## Conclusion opérationnelle

À ce stade, aucune consigne de tracking supplémentaire n’a été fournie par l’utilisateur. En conséquence, aucun nouveau changement structurel n’a été appliqué au tracking existant. La prochaine action utile ne consiste pas à modifier l’interface ou le dashboard, mais à vérifier côté Meta :

1. que l’identifiant cible utilisé par la configuration est correct ;
2. que le token dispose bien des permissions attendues ;
3. que la ressource visée accepte effectivement les appels CAPI envoyés par le projet.

Tant que ce point externe n’est pas corrigé, il est honnête de considérer le tracking comme **implémenté côté projet mais non entièrement validé côté plateforme Meta**.
