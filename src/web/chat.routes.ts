import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { agentService } from "@/modules/agent/agent.service.js";
import { businessService } from "@/modules/business/business.service.js";
import { env } from "@/config/env.js";

function requireAdminKey(request: FastifyRequest, reply: FastifyReply): boolean {
  const auth = request.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== env.ADMIN_API_KEY) {
    reply.status(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

const chatBodySchema = z.object({
  businessId: z.string().uuid(),
  sessionId: z.string().min(1).max(64),
  message: z.string().min(1).max(4096),
});

const businessParamsSchema = z.object({
  id: z.string().uuid(),
});

const createBusinessSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  calendarId: z.string().min(1),
  timezone: z.string().min(1),
  welcomeMessage: z.string().min(1),
  services: z.array(
    z.object({
      name: z.string(),
      duration_minutes: z.number().int().positive(),
      price: z.number().nonnegative(),
    })
  ),
  workingHours: z.array(
    z.object({
      day: z.number().int().min(0).max(6),
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    })
  ),
  escalationPhone: z.string().optional(),
});

export async function chatRoutes(app: FastifyInstance) {
  app.post("/api/chat", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: 60_000,
        keyGenerator(request) {
          const body = request.body as { sessionId?: string } | null;
          return body?.sessionId ?? request.ip ?? "unknown";
        },
      },
    },
  }, async (request, reply) => {
    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { businessId, sessionId, message } = parsed.data;

    const business = await businessService.getById(businessId);
    if (!business || !business.active) {
      return reply.status(404).send({ error: "Business not found" });
    }

    const sanitized = message.trim().slice(0, 4096);

    const response = await agentService.processMessage({
      customerPhone: sessionId,
      businessId,
      messageContent: sanitized,
    });

    return reply.send({ response });
  });

  app.get("/api/business/:id", async (request, reply) => {
    const parsed = businessParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const business = await businessService.getById(parsed.data.id);
    if (!business || !business.active) {
      return reply.status(404).send({ error: "Business not found" });
    }

    return reply.send({
      id: business.id,
      name: business.name,
      welcomeMessage: business.welcomeMessage,
      services: business.services,
      workingHours: business.workingHours,
      timezone: business.timezone,
    });
  });

  app.get("/api/business/:id/services", async (request, reply) => {
    const parsed = businessParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const business = await businessService.getById(parsed.data.id);
    if (!business || !business.active) {
      return reply.status(404).send({ error: "Business not found" });
    }

    return reply.send({ services: business.services });
  });

  app.post("/api/business", async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;

    const parsed = createBusinessSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const business = await businessService.create(parsed.data);
    return reply.status(201).send({ id: business.id });
  });

  app.put("/api/business/:id", async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;

    const paramsParsed = businessParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.status(400).send({ error: paramsParsed.error.flatten() });
    }

    const bodyParsed = createBusinessSchema.partial().safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({ error: bodyParsed.error.flatten() });
    }

    const existing = await businessService.getById(paramsParsed.data.id);
    if (!existing) {
      return reply.status(404).send({ error: "Business not found" });
    }

    const updated = await businessService.update(
      paramsParsed.data.id,
      bodyParsed.data
    );
    return reply.send({ id: updated.id });
  });

  app.post("/api/business/seed", async (request, reply) => {
    if (!requireAdminKey(request, reply)) return;

    const business = await businessService.seed();
    return reply.send({ id: business.id, name: business.name });
  });
}
