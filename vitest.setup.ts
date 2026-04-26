// Sane defaults so individual test files don't have to set env explicitly.
// Real values are still provided by tests that need to override them.

if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret-do-not-use-in-prod";
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-jwt-secret-do-not-use-in-prod";
}

if (!process.env.DASHBOARD_PASSWORD) {
  process.env.DASHBOARD_PASSWORD = "1234";
}
