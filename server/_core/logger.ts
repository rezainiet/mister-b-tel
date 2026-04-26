type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function emit(level: LogLevel, scope: string, message: string, context?: LogContext) {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(context || {}),
  };
  const channel = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  try {
    channel(JSON.stringify(line));
  } catch {
    channel(`[${level}] ${scope}: ${message}`);
  }
}

export const log = {
  info: (scope: string, message: string, context?: LogContext) => emit("info", scope, message, context),
  warn: (scope: string, message: string, context?: LogContext) => emit("warn", scope, message, context),
  error: (scope: string, message: string, context?: LogContext) => emit("error", scope, message, context),
};
