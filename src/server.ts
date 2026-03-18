import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { Readable } from "stream";
import { env } from "@/config/env.js";
import { chatRoutes } from "@/web/chat.routes.js";
import { whatsappRoutes } from "@/modules/whatsapp/whatsapp.handler.js";
import { authRoutes } from "@/web/auth.routes.js";
import "@/queue/worker.js";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  app.addHook("preParsing", async (request, _reply, payload) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const raw = Buffer.concat(chunks);
    request.rawBody = raw.toString("utf-8");
    return Readable.from(raw);
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE"],
  });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });

  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    app.log.error(
      { err, method: request.method, url: request.url },
      err.message
    );
    const message =
      statusCode >= 500 && env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err.message;
    return reply.status(statusCode).send({ error: message });
  });

  app.get("/health", async () => ({ status: "ok" }));
  await app.register(chatRoutes);
  await app.register(whatsappRoutes);
  await app.register(authRoutes);

  return app;
}

async function main() {
  const app = await buildServer();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
