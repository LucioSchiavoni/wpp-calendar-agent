import type { FastifyInstance } from "fastify";
import { whatsappService } from "@/modules/whatsapp/whatsapp.service.js";
import { businessService } from "@/modules/business/business.service.js";
import { messageQueue } from "@/queue/queue.js";
import { logger } from "@/lib/logger.js";

const phoneBuckets = new Map<string, number[]>();

function checkPhoneRateLimit(phone: string): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;
  const timestamps = (phoneBuckets.get(phone) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= 30) return false;
  timestamps.push(now);
  phoneBuckets.set(phone, timestamps);
  return true;
}

interface WhatsappMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  messages?: WhatsappMessage[];
  statuses?: unknown[];
}

interface WebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: WebhookValue;
      field: string;
    }>;
  }>;
}

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  app.get("/webhook/whatsapp", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const challenge = whatsappService.verifyWebhook(
      query["hub.mode"] ?? "",
      query["hub.verify_token"] ?? "",
      query["hub.challenge"] ?? ""
    );

    if (challenge !== null) {
      return reply.header("Content-Type", "text/plain").send(challenge);
    }

    return reply.status(403).send({ error: "Forbidden" });
  });

  app.post<{ Body: WebhookPayload }>("/webhook/whatsapp", async (request, reply) => {
    const signature = (request.headers["x-hub-signature-256"] as string) ?? "";

    if (!whatsappService.verifySignature(request.rawBody, signature)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { object, entry } = request.body;

    if (object !== "whatsapp_business_account") {
      return reply.send({ status: "ignored" });
    }

    for (const e of entry) {
      for (const change of e.changes) {
        if (change.field !== "messages") continue;

        const { value } = change;
        if (!value.messages?.length) continue;

        const phoneNumberId = value.metadata.phone_number_id;
        const business = await businessService.getByWhatsappPhoneNumberId(phoneNumberId);

        if (!business || !business.active) {
          logger.warn("no business found for phone_number_id", { phoneNumberId });
          continue;
        }

        for (const msg of value.messages) {
          if (msg.type !== "text" || !msg.text?.body) continue;
          if (!checkPhoneRateLimit(msg.from)) continue;

          const content = msg.text.body.trim().slice(0, 4096);

          await messageQueue.add("incoming", {
            customerPhone: msg.from,
            businessId: business.id,
            messageContent: content,
          });
        }
      }
    }

    return reply.send({ status: "ok" });
  });
}