import "dotenv/config";
import path from "node:path";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql2";
import { migrate as mysqlMigrate } from "drizzle-orm/mysql2/migrator";
import mysql2 from "mysql2/promise";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { log } from "./logger";
import { serveStatic, setupVite } from "./vite";
import { startBroadcastWorker } from "../broadcastWorker";
import { startMetaRetryWorker } from "../metaWorker";
import { startTelegramAdminReportWorker } from "../telegramAdminReports";
import { setupTelegramWebhook } from "../telegramWebhook";
import { startTelegramReminderWorker } from "../telegramReminders";

async function runPendingMigrations() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.warn("startup", "skip_migrations_no_database_url");
    return;
  }
  // Skip when explicitly opted out (e.g., a separate ops process owns
  // migrations and we don't want each instance racing to apply them, or the
  // operator has historically applied SQL manually and the
  // `__drizzle_migrations` ledger isn't in sync — in which case auto-migrate
  // would try to re-create existing tables and noisy-fail every boot).
  if (process.env.AUTO_MIGRATE?.toLowerCase() === "false") {
    log.info("startup", "skip_migrations_auto_migrate_disabled");
    return;
  }
  // Use a dedicated short-lived connection so a transient migration error
  // doesn't poison the long-lived app connection pool.
  const connection = await mysql2.createConnection(url);
  try {
    const db = mysqlDrizzle(connection);
    const migrationsFolder = path.resolve(process.cwd(), "drizzle");
    await mysqlMigrate(db, { migrationsFolder });
    log.info("startup", "migrations_applied");
  } catch (error) {
    // Don't crash the server if the migration ledger is out of sync — the
    // app must still come up so the operator can read logs and intervene.
    // The broadcast UI degrades gracefully (recipient count works without
    // the new tables; the send button errors with a clear message).
    log.error("startup", "migrations_failed_non_fatal", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await connection.end().catch(() => {});
  }
}

function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") {
    // Even in dev we refuse to start with a Telegram bot token but no webhook
    // secret — the webhook would then be a public endpoint that anyone can
    // forge bot starts through.
    if (process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_WEBHOOK_SECRET) {
      log.error("startup", "bot_token_without_webhook_secret");
      throw new Error("TELEGRAM_BOT_TOKEN is set but TELEGRAM_WEBHOOK_SECRET is missing — refusing to start.");
    }
    return;
  }
  const required: Record<string, string | undefined> = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    log.error("startup", "missing_required_env_in_production", { missing });
    throw new Error(`Missing required env vars in production: ${missing.join(", ")}`);
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  assertProductionEnv();
  // Apply any pending Drizzle migrations BEFORE accepting traffic. This keeps
  // the schema in lock-step with the deployed code and removes the manual
  // `drizzle-kit migrate` step that's easy to forget on Railway. Set
  // AUTO_MIGRATE=false to opt out (e.g., when a separate process owns
  // migrations).
  await runPendingMigrations();
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  setupTelegramWebhook(app);
  if (process.env.WORKERS_ENABLED?.toLowerCase() !== "false") {
    startTelegramReminderWorker();
    startTelegramAdminReportWorker();
    startMetaRetryWorker();
    startBroadcastWorker();
  } else {
    log.info("startup", "workers_disabled_by_env");
  }
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // const preferredPort = parseInt(process.env.PORT || "3000");
  // const port = await findAvailablePort(preferredPort);

  // if (port !== preferredPort) {
  //   console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  // }

  // server.listen(port, () => {
  //   console.log(`Server running on http://localhost:${port}/`);
  // });

  const port = parseInt(process.env.PORT || "3000");

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
