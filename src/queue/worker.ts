import { Worker } from "bullmq";
import { env } from "@/config/env.js";
import { agentService } from "@/modules/agent/agent.service.js";
import { whatsappService } from "@/modules/whatsapp/whatsapp.service.js";
import { logger } from "@/lib/logger.js";
import type { MessageJobData } from "@/queue/queue.js";

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
    password: u.password || undefined,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null as null,
  };
}

export const messageWorker = new Worker<MessageJobData, void, string>(
  "messages",
  async (job) => {
    const { customerPhone, businessId, messageContent } = job.data;
    const response = await agentService.processMessage({
      customerPhone,
      businessId,
      messageContent,
    });
    await whatsappService.sendMessage(customerPhone, response);
  },
  { connection: parseRedisUrl(env.REDIS_URL) }
);

messageWorker.on("completed", (job) => {
  logger.info("job completed", { jobId: job.id, phone: job.data.customerPhone });
});

messageWorker.on("failed", (job, err) => {
  logger.error("job failed", {
    jobId: job?.id,
    attempts: job?.attemptsMade,
    phone: job?.data.customerPhone,
    error: err.message,
  });
});
