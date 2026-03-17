import { env } from "@/config/env.js";

type LogLevel = "debug" | "info" | "warn" | "error";

function write(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const entry = JSON.stringify({ level, time: Date.now(), msg, ...ctx });
  if (level === "error" || level === "warn") {
    process.stderr.write(entry + "\n");
  } else {
    process.stdout.write(entry + "\n");
  }
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => {
    if (env.NODE_ENV !== "production") write("debug", msg, ctx);
  },
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
};
