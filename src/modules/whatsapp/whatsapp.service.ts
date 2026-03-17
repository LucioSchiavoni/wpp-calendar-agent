import crypto from "crypto";
import { env } from "@/config/env.js";

const GRAPH_API_URL = `https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

export interface IWhatsappService {
  sendMessage(to: string, text: string): Promise<void>;
  verifyWebhook(mode: string, token: string, challenge: string): string | null;
  verifySignature(rawBody: string, signature: string): boolean;
}

export const whatsappService: IWhatsappService = {
  async sendMessage(to, text) {
    const res = await fetch(GRAPH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WhatsApp API error ${res.status}: ${err}`);
    }
  },

  verifyWebhook(mode, token, challenge) {
    if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  },

  verifySignature(rawBody, signature) {
    if (!env.WHATSAPP_APP_SECRET) return true;
    const expected = `sha256=${crypto
      .createHmac("sha256", env.WHATSAPP_APP_SECRET)
      .update(rawBody)
      .digest("hex")}`;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  },
};
