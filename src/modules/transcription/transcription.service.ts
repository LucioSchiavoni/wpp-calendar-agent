import { env } from "@/config/env.js";
import { logger } from "@/lib/logger.js";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";

export interface ITranscriptionService {
  isConfigured(): boolean;
  transcribeWhatsappAudio(mediaId: string, mimeType: string): Promise<string | null>;
}

export const transcriptionService: ITranscriptionService = {
  isConfigured(): boolean {
    return !!env.OPENAI_API_KEY;
  },

  async transcribeWhatsappAudio(mediaId: string, mimeType: string): Promise<string | null> {
    const mediaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    });

    if (!mediaRes.ok) {
      logger.error("failed to get media URL from Meta", { mediaId, status: mediaRes.status });
      return null;
    }

    const { url } = (await mediaRes.json()) as { url: string };

    const audioRes = await fetch(url, {
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
    });

    if (!audioRes.ok) {
      logger.error("failed to download audio from Meta", { mediaId, status: audioRes.status });
      return null;
    }

    const audioBuffer = await audioRes.arrayBuffer();
    const baseType = mimeType.split(";")[0].trim();
    const ext = baseType === "audio/mp4" ? "m4a" : "ogg";

    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: baseType }), `audio.${ext}`);
    formData.append("model", "whisper-1");
    formData.append("language", "es");

    const whisperRes = await fetch(WHISPER_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY!}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      logger.error("whisper transcription failed", { mediaId, status: whisperRes.status, err });
      return null;
    }

    const { text } = (await whisperRes.json()) as { text: string };
    return text.trim() || null;
  },
};
