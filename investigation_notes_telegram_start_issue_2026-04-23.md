# Telegram START Investigation Notes

On the public `https://mister-b.club` page, the visible Telegram Group CTA is currently published as an active anchor rather than a loading placeholder.

The live DOM inspection returned the following relevant values:

| Element | Text | href | target | aria-disabled |
|---|---|---|---|---|
| Telegram Group CTA | Groupe Telegram | `https://t.me/Misternb_bot?start=Z3JvdXA6NThiOTE2NTI1YWEwOTQ5M2RhMzFmMTEyN2QyMDM0ZmY1NDc2ZDE1ZDEwODc3OTUz` | `_self` | `null` |
| Telegram Contact CTA | Me contacter | `https://t.me/MisterBNMB` | `_blank` | `null` |

This confirms that the public site is serving an exact `https://t.me/... ?start=...` link on the Telegram Group button at the time of inspection.
