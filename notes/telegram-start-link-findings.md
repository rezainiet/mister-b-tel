# Telegram start-link findings

- Live landing inspection shows the **GROUPE TELEGRAM** button currently uses an exact bot URL in the form `https://t.me/Misternb_bot?start=...`.
- The live DOM href inspected in the preview was an exact `https://t.me/Misternb_bot?start=Z3JvdXA6...` link, not a plain bot URL.
- Telegram Bot Features documentation says the `start` parameter passes a value to the bot when the user opens the chat via the link, using links like `https://t.me/your_bot?start=airplane`.
- A Telegram Desktop issue reports that some Telegram clients still show a **START** button and require an additional user click before the `/start` command is actually sent, even when the deep link contains the correct `?start=` payload.
- Conclusion: the website can guarantee the correct deep link format, but it cannot force every Telegram client to auto-send `/start` without Telegram's own client behavior allowing it.
