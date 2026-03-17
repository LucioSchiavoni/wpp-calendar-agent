import { ConversationStatus, MessageRole, type Conversation, type Message } from "@prisma/client";
import { prisma } from "@/lib/prisma.js";

export interface IConversationService {
  findOrCreateConversation(businessId: string, customerPhone: string): Promise<Conversation>;
  addMessage(conversationId: string, role: MessageRole, content: string): Promise<Message>;
  getHistory(conversationId: string, limit: number): Promise<Message[]>;
  updateStatus(conversationId: string, status: ConversationStatus): Promise<Conversation>;
}

export const conversationService: IConversationService = {
  async findOrCreateConversation(businessId, customerPhone) {
    const existing = await prisma.conversation.findFirst({
      where: { businessId, customerPhone, status: ConversationStatus.ACTIVE },
    });

    if (existing) return existing;

    return prisma.conversation.create({
      data: { businessId, customerPhone, status: ConversationStatus.ACTIVE },
    });
  },

  async addMessage(conversationId, role, content) {
    return prisma.message.create({
      data: { conversationId, role, content },
    });
  },

  async getHistory(conversationId, limit) {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return messages.reverse();
  },

  async updateStatus(conversationId, status) {
    return prisma.conversation.update({
      where: { id: conversationId },
      data: { status },
    });
  },
};
