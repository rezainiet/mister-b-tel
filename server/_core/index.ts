import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { log } from "./logger";
import { serveStatic, setupVite } from "./vite";
import { startMetaRetryWorker } from "../metaWorker";
import { startTelegramAdminReportWorker } from "../telegramAdminReports";
import { setupTelegramWebhook } from "../telegramWebhook";
import { startTelegramReminderWorker } from "../telegramReminders";

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
