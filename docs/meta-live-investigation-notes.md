# Constats initiaux sur le tracking Meta live

Date de vérification: 2026-04-23

## Domaine publié vérifié

- URL testée: `https://mister-b.club/`
- La landing publiée se charge correctement et affiche la version Mister B en ligne.

## Constats côté navigateur sur le site publié

- La fonction `window.fbq` n'existe pas sur la page live.
- Aucun script Meta/Facebook (`connect.facebook.net`, `fbevents.js`, etc.) n'est chargé dans les scripts de la page.
- Aucune ressource réseau correspondant au pixel navigateur Meta n'a été observée au chargement de la page.

## Première conclusion

- Si l'utilisateur attend un **pixel navigateur visible en live dans Meta**, la version actuellement publiée n'en charge pas.
- Il faut maintenant vérifier si cela est volontaire dans le code actuel, et si seul le tracking serveur CAPI reste actif.

## Vérification après correction dans l’aperçu du projet

- URL d’aperçu testée: `https://3000-itnwh51j4r6px3uvmdfw3-8bb3c279.us2.manus.computer/`
- La fonction `window.fbq` est désormais présente dans la page corrigée.
- Le pixel navigateur Meta est initialisé avec l’identifiant `945883278158292`.
- La ressource `https://connect.facebook.net/en_US/fbevents.js` se charge bien.
- La landing continue aussi d’émettre l’appel applicatif `POST /api/trpc/tracking.record?batch=1`.

## Conclusion technique mise à jour

Le problème live venait du fait que la version publiée ne chargeait plus le pixel navigateur Meta. La correction réactive le pixel navigateur pour le PageView live, tout en conservant le tracking applicatif existant vers le backend.

## Recontrôle du domaine publié après signalement persistant

Sur `https://mister-b.club/`, la version actuellement publiée charge bien `https://connect.facebook.net/en_US/fbevents.js`. La variable `window.__misterbFbPixelId` vaut bien `945883278158292`, et la fonction `window.fbq` existe sur la page live. Le site publié continue également d'émettre l'appel applicatif `POST /api/trpc/tracking.record?batch=1` au chargement. À ce stade, le problème n'est donc plus une absence brute du script pixel dans le HTML live ; il faut maintenant vérifier si l'événement navigateur part réellement vers Meta et si Meta l'affiche comme attendu.

Le recontrôle live montre aussi un indice important : bien que `fbq` et `fbevents.js` soient présents, aucune ressource `facebook.com/tr` n'est visible dans les entrées réseau inspectées, même après un `trackCustom` de sonde. L'objet `fbq` garde une file (`queueLength = 2`) au moment du test, ce qui suggère que le bootstrap existe mais qu'il faut encore vérifier si la bibliothèque Pixel prend correctement la main et vide la file d'événements.

Dans l'aperçu corrigé, le `PageView` est désormais mis en file directement depuis le HTML avec un `eventId` de type `pv_boot_...`, et le même chargement déclenche toujours l'appel serveur `tracking.record`. L'environnement navigateur de test continue toutefois à ne montrer ni `facebook.com/tr` ni `fbq.callMethod`, ce qui peut indiquer une limite de ce navigateur de contrôle ou un blocage externe du runtime Pixel plutôt qu'une simple absence de bootstrap applicatif.

On the currently published domain, the live page is already loading Pixel ID `945883278158292`, and the queued browser calls show `init` plus a `PageView` event with an `eventID`. This means the issue is no longer "missing Pixel ID" on the site. Separately, a direct Graph API check against the same pixel using the configured Conversions API token returns `(#100) Missing Permission`, which confirms that the server-side Meta connection is not authorized for this pixel in its current state.
