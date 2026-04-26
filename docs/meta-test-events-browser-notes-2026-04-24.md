# Browser notes on Meta Test Events visibility (2026-04-24)

Direct navigation to Meta Events Manager from the sandbox browser redirected to the Meta business login page rather than an authenticated Test Events view. That means I could not independently verify the user’s specific Test Events panel or dataset selection from this browser session.

A Stack Overflow troubleshooting thread describing the same symptom reported that Meta returned `events_received: 1` while no server event appeared in Test Events until `client_ip_address` and a realistic `client_user_agent` were included in `user_data`. A follow-up answer on the same page added that the user agent should be a proper browser user agent string rather than arbitrary placeholder text.

This does not prove the current Mister B issue by itself, but it creates a concrete payload-level difference worth testing against the latest manual send, which used the reserved documentation IP `203.0.113.10` and the synthetic user agent string `MetaTest/1.0`.
