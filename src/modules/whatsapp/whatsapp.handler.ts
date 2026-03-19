import type { FastifyInstance } from "fastify";
import { whatsappService } from "@/modules/whatsapp/whatsapp.service.js";
import { businessService } from "@/modules/business/business.service.js";
import { transcriptionService } from "@/modules/transcription/transcription.service.js";
import { messageQueue } from "@/queue/queue.js";
import { logger } from "@/lib/logger.js";

const phoneBuckets = new Map<string, number[]>();
const processedMessageIds = new Map<string, number>();
const MESSAGE_DEDUP_TTL_MS = 5 * 60 * 1000;

function checkPhoneRateLimit(phone: string): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;
  const timestamps = (phoneBuckets.get(phone) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= 30) return false;
  timestamps.push(now);
  phoneBuckets.set(phone, timestamps);
  return true;
}

function isDuplicateMessage(msgId: string): boolean {
  const now = Date.now();
  const cutoff = now - MESSAGE_DEDUP_TTL_MS;
  for (const [id, ts] of processedMessageIds) {
    if (ts < cutoff) processedMessageIds.delete(id);
  }
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.set(msgId, now);
  return false;
}

interface WhatsappMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type: string };
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

        if (value.statuses?.length && !value.messages?.length) {
          logger.debug("webhook ignored: status-only payload", {
            statusCount: value.statuses.length,
            phoneNumberId: value.metadata.phone_number_id,
          });
          continue;
        }

        if (!value.messages?.length) {
          logger.debug("webhook ignored: no messages in payload", {
            phoneNumberId: value.metadata.phone_number_id,
          });
          continue;
        }

        const phoneNumberId = value.metadata.phone_number_id;
        const business = await businessService.getByWhatsappPhoneNumberId(phoneNumberId);

        if (!business || !business.active) {
          logger.warn("no business found for phone_number_id", { phoneNumberId });
          continue;
        }

        for (const msg of value.messages) {
          if (isDuplicateMessage(msg.id)) {
            logger.warn("webhook ignored: duplicate message id", { msgId: msg.id, from: msg.from });
            continue;
          }

          if (!checkPhoneRateLimit(msg.from)) {
            logger.warn("webhook ignored: rate limit exceeded", { from: msg.from });
            continue;
          }

          let content: string;

          if (msg.type === "text" && msg.text?.body) {
            content = msg.text.body.trim().slice(0, 4096);
          } else if (msg.type === "audio" && msg.audio?.id) {
            if (!transcriptionService.isConfigured()) {
              logger.debug("audio message received but transcription not configured, sending fallback", { msgId: msg.id });
              await whatsappService.sendMessage(msg.from, "Por ahora solo puedo leer mensajes de texto. ¿Podrías escribirme?");
              continue;
            }
            const transcription = await transcriptionService.transcribeWhatsappAudio(
              msg.audio.id,
              msg.audio.mime_type
            );
            if (!transcription) {
              logger.warn("webhook ignored: audio transcription returned empty", { msgId: msg.id, from: msg.from });
              continue;
            }
            content = transcription.slice(0, 4096);
            logger.info("audio transcribed", { msgId: msg.id, from: msg.from, chars: content.length });
          } else {
            logger.debug("webhook ignored: unsupported message type", { msgId: msg.id, type: msg.type });
            continue;
          }

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