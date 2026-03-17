import { Queue } from "bullmq";
import { env } from "@/config/env.js";

export interface MessageJobData {
  customerPhone: string;
  businessId: string;
  messageContent: string;
}

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

export const messageQueue = new Queue<MessageJobData, void, string>("messages", {
  connection: parseRedisUrl(env.REDIS_URL),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
