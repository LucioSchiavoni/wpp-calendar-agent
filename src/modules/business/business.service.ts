import type { Business, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma.js";

export interface IBusinessService {
  getById(id: string): Promise<Business | null>;
  getByPhone(phone: string): Promise<Business | null>;
  getByWhatsappPhoneNumberId(phoneNumberId: string): Promise<Business | null>;
  create(data: Prisma.BusinessCreateInput): Promise<Business>;
  update(id: string, data: Prisma.BusinessUpdateInput): Promise<Business>;
  seed(): Promise<Business>;
}

export const businessService: IBusinessService = {
  async getById(id) {
    return prisma.business.findUnique({ where: { id } });
  },

  async getByPhone(phone) {
    return prisma.business.findUnique({ where: { phone } });
  },

  async getByWhatsappPhoneNumberId(phoneNumberId) {
    return prisma.business.findUnique({ where: { whatsappPhoneNumberId: phoneNumberId } });
  },

  async create(data) {
    return prisma.business.create({ data });
  },

  async update(id, data) {
    return prisma.business.update({ where: { id }, data });
  },

  async seed() {
    const existing = await prisma.business.findUnique({
      where: { phone: "+59899000000" },
    });

    if (existing) return existing;

    return prisma.business.create({
      data: {
        name: "Clínica Demo",
        phone: "+59899000000",
        whatsappPhoneNumberId: null,
        calendarId: "primary",
        timezone: "America/Montevideo",
        welcomeMessage:
          "¡Hola! Soy el asistente virtual de Clínica Demo. ¿En qué puedo ayudarte hoy?",
        services: [
          { name: "Consulta general", duration_minutes: 30, price: 800 },
          { name: "Control pediátrico", duration_minutes: 45, price: 1000 },
          { name: "Ecografía", duration_minutes: 60, price: 2500 },
        ],
        workingHours: [
          { day: 1, start: "09:00", end: "18:00" },
          { day: 2, start: "09:00", end: "18:00" },
          { day: 3, start: "09:00", end: "18:00" },
          { day: 4, start: "09:00", end: "18:00" },
          { day: 5, start: "09:00", end: "17:00" },
        ],
        escalationPhone: "+59891000000",
        active: true,
      },
    });
  },
};