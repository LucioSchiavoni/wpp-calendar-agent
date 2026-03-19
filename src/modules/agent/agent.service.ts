import {
  AppointmentStatus,
  ConversationStatus,
  MessageRole,
  type Business,
} from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { prisma } from "@/lib/prisma.js";
import { env } from "@/config/env.js";
import { conversationService } from "@/modules/conversation/conversation.service.js";
import { businessService } from "@/modules/business/business.service.js";
import { agentTools } from "@/modules/agent/agent.tools.js";
import { buildSystemPrompt } from "@/modules/agent/agent.prompt.js";
import { calendarService } from "@/modules/calendar/calendar.service.js";
import { logger } from "@/lib/logger.js";
import { z } from "zod";

const customerPhoneSchema = z
  .string()
  .regex(/^09\d{7}$/, "El número de teléfono debe tener 9 dígitos (ej: 099123456)");

function sanitizeUserInput(content: string): string {
  return content
    .replace(/\x00/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .slice(0, 4096);
}

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const ANTHROPIC_TIMEOUT_MS = 30_000;
const FALLBACK_MESSAGE =
  "Lo siento, estoy teniendo problemas técnicos. Por favor intentá de nuevo en unos segundos.";

class AnthropicTimeoutError extends Error {
  constructor() {
    super("Anthropic request timed out");
    this.name = "AnthropicTimeoutError";
  }
}

async function callAnthropic(
  systemPrompt: string,
  messages: MessageParam[]
): Promise<Anthropic.Message> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  try {
    return await anthropic.messages.create(
      {
        model: env.AI_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: agentTools,
        messages,
      },
      { signal: controller.signal }
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.error("anthropic timeout", { timeout_ms: ANTHROPIC_TIMEOUT_MS });
      throw new AnthropicTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface ProcessMessageInput {
  customerPhone: string;
  businessId: string;
  messageContent: string;
}

interface Service {
  name: string;
  duration_minutes: number;
  price: number;
}

interface WorkingHour {
  day: number;
  start: string;
  end: string;
}

interface ToolContext {
  business: Business;
  conversationId: string;
  customerPhone: string;
}

export interface IAgentService {
  processMessage(input: ProcessMessageInput): Promise<string>;
}


async function executeCheckAvailability(
  input: { date: string; service_name?: string },
  ctx: ToolContext
): Promise<string> {
  logger.info("tool called", { tool: "check_availability", input_date: input.date, service_name: input.service_name ?? null });
  const services = ctx.business.services as unknown as Service[];
  const workingHours = ctx.business.workingHours as unknown as WorkingHour[];

  const service = input.service_name
    ? services.find(
        (s) => s.name.toLowerCase() === input.service_name!.toLowerCase()
      )
    : null;
  const duration = service?.duration_minutes ?? 30;

  let slots: string[];

  const useCalendar =
    calendarService.isConfigured() && !!ctx.business.calendarId;

  if (useCalendar) {
    try {
      const calendarSlots = await calendarService.getAvailableSlots(
        ctx.business.calendarId,
        input.date,
        duration,
        workingHours
      );
      slots = await filterCalendarSlotsAgainstDb(calendarSlots, input.date, duration, ctx);
       } catch (err) {
      logger.error("calendar fetch failed, using db fallback", { error: err instanceof Error ? err.message : String(err) });
      slots = await getAvailableSlotsFromDb(input.date, duration, workingHours, ctx);
    }
  } else {
    slots = await getAvailableSlotsFromDb(input.date, duration, workingHours, ctx);
  }

  if (slots.length === 0) {
    return JSON.stringify({
      available: false,
      message: "No hay turnos disponibles para ese día.",
    });
  }

  return JSON.stringify({
    available: true,
    date: input.date,
    slots,
    duration_minutes: duration,
  });
}

async function fetchDayAppointments(date: string, ctx: ToolContext) {
  const [year, month, day] = date.split("-").map(Number);
  const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
  const startOfNextDay = new Date(year, month - 1, day + 1, 0, 0, 0);

  return prisma.appointment.findMany({
    where: {
      businessId: ctx.business.id,
      startTime: { gte: startOfDay, lt: startOfNextDay },
      status: { notIn: [AppointmentStatus.CANCELLED] },
    },
  });
}

function slotIsOccupied(
  slotStart: Date,
  duration: number,
  appointments: Awaited<ReturnType<typeof fetchDayAppointments>>
): boolean {
  const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
  return appointments.some(
    (apt) => slotStart < apt.endTime && slotEnd > apt.startTime
  );
}

async function getAvailableSlotsFromDb(
  date: string,
  duration: number,
  workingHours: WorkingHour[],
  ctx: ToolContext
): Promise<string[]> {
  const [year, month, day] = date.split("-").map(Number);
  const dayOfWeek = new Date(year, month - 1, day).getDay();

  const schedule = workingHours.find((h) => h.day === dayOfWeek);
  logger.info("date resolution", { fn: "getAvailableSlotsFromDb", date, parsed: { year, month, day }, dayOfWeek, scheduleFound: schedule ?? null });
  if (!schedule) return [];

  const appointments = await fetchDayAppointments(date, ctx);

  const [startHour, startMin] = schedule.start.split(":").map(Number);
  const [endHour, endMin] = schedule.end.split(":").map(Number);

  const slots: string[] = [];
  let current = new Date(year, month - 1, day, startHour, startMin, 0);
  const workEnd = new Date(year, month - 1, day, endHour, endMin, 0);

  while (current < workEnd) {
    const slotEnd = new Date(current.getTime() + duration * 60 * 1000);
    if (slotEnd > workEnd) break;

    if (!slotIsOccupied(current, duration, appointments)) {
      const hh = current.getHours().toString().padStart(2, "0");
      const mm = current.getMinutes().toString().padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }

    current = new Date(current.getTime() + duration * 60 * 1000);
  }

  return slots;
}

async function filterCalendarSlotsAgainstDb(
  calendarSlots: string[],
  date: string,
  duration: number,
  ctx: ToolContext
): Promise<string[]> {
  const appointments = await fetchDayAppointments(date, ctx);
  if (appointments.length === 0) return calendarSlots;

  const [year, month, day] = date.split("-").map(Number);

  return calendarSlots.filter((slot) => {
    const [hh, mm] = slot.split(":").map(Number);
    const slotStart = new Date(year, month - 1, day, hh, mm, 0);
    return !slotIsOccupied(slotStart, duration, appointments);
  });
}

async function executeCreateAppointment(
  input: {
    customer_name: string;
    customer_phone: string;
    service_name: string;
    start_time: string;
  },
  ctx: ToolContext
): Promise<string> {
  const rawPhone = input.customer_phone;
  const phoneAsString = String(rawPhone).trim();
  console.log("[executeCreateAppointment] customer_phone recibido:", JSON.stringify(rawPhone), "| tipo:", typeof rawPhone, "| como string:", phoneAsString);
  console.log("[executeCreateAppointment] regex test:", /^09\d{7}$/.test(phoneAsString), "| length:", phoneAsString.length);
  const phoneValidation = customerPhoneSchema.safeParse(phoneAsString);
  console.log("[executeCreateAppointment] validación Zod:", phoneValidation.success ? "OK" : phoneValidation.error.issues[0].message);
  if (!phoneValidation.success) {
    return JSON.stringify({
      success: false,
      error: phoneValidation.error.issues[0].message,
      instruction: "DEBES informar al usuario que el teléfono es inválido y pedirle que lo corrija. NO confirmes el turno.",
    });
  }

  const normalizedPhone = phoneAsString;

  const services = ctx.business.services as unknown as Service[];

  const service = services.find(
    (s) => s.name.toLowerCase() === input.service_name.toLowerCase()
  );
  if (!service) {
    return JSON.stringify({
      success: false,
      error: `Servicio "${input.service_name}" no encontrado.`,
    });
  }

  const startTime = new Date(input.start_time);
  const endTime = new Date(
    startTime.getTime() + service.duration_minutes * 60 * 1000
  );

  let googleEventId: string | undefined;

  if (calendarService.isConfigured() && ctx.business.calendarId) {
    try {
      googleEventId = await calendarService.createEvent(ctx.business.calendarId, {
        title: `${service.name} - ${input.customer_name}`,
        start: startTime,
        end: endTime,
        description: `Turno agendado por WhatsApp. Teléfono: ${normalizedPhone}`,
        timezone: ctx.business.timezone,
      });
    } catch {
      // Calendar event creation failed — appointment is still saved in DB
    }
  }

  const appointment = await prisma.appointment.create({
    data: {
      businessId: ctx.business.id,
      conversationId: ctx.conversationId,
      customerPhone: normalizedPhone,
      customerName: input.customer_name,
      service: service.name,
      startTime,
      endTime,
      status: AppointmentStatus.CONFIRMED,
      googleEventId: googleEventId ?? null,
    },
  });

  return JSON.stringify({
    success: true,
    appointment_id: appointment.id,
    customer_name: appointment.customerName,
    service: appointment.service,
    start_time: appointment.startTime.toISOString(),
    end_time: appointment.endTime.toISOString(),
  });
}

async function executeCancelAppointment(
  input: { appointment_id: string },
  ctx: ToolContext
): Promise<string> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointment_id },
  });

  if (!appointment) {
    return JSON.stringify({ success: false, error: "Turno no encontrado." });
  }

  if (appointment.businessId !== ctx.business.id) {
    return JSON.stringify({ success: false, error: "Turno no encontrado." });
  }

  if (appointment.customerPhone !== ctx.customerPhone) {
    return JSON.stringify({ success: false, error: "Turno no encontrado." });
  }

  if (appointment.status === AppointmentStatus.CANCELLED) {
    return JSON.stringify({
      success: false,
      error: "El turno ya estaba cancelado.",
    });
  }

  await prisma.appointment.update({
    where: { id: input.appointment_id },
    data: { status: AppointmentStatus.CANCELLED },
  });

  if (
    appointment.googleEventId &&
    calendarService.isConfigured() &&
    ctx.business.calendarId
  ) {
    try {
      await calendarService.deleteEvent(ctx.business.calendarId, appointment.googleEventId);
    } catch {
      // Calendar event deletion failed — appointment is still cancelled in DB
    }
  }

  return JSON.stringify({
    success: true,
    message: "Turno cancelado correctamente.",
    appointment_id: input.appointment_id,
  });
}

async function executeGetAppointments(
  input: { customer_phone: string },
  ctx: ToolContext
): Promise<string> {
  const appointments = await prisma.appointment.findMany({
    where: {
      businessId: ctx.business.id,
      customerPhone: input.customer_phone,
      startTime: { gte: new Date() },
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED] },
    },
    orderBy: { startTime: "asc" },
    take: 10,
  });

  if (appointments.length === 0) {
    return JSON.stringify({
      appointments: [],
      message: "No hay turnos próximos para este cliente.",
    });
  }

  return JSON.stringify({
    appointments: appointments.map((a) => ({
      id: a.id,
      service: a.service,
      start_time: a.startTime.toISOString(),
      end_time: a.endTime.toISOString(),
      status: a.status,
    })),
  });
}

async function executeEscalateToHuman(
  input: { reason: string },
  ctx: ToolContext
): Promise<string> {
  await conversationService.updateStatus(
    ctx.conversationId,
    ConversationStatus.ESCALATED
  );

  return JSON.stringify({
    escalated: true,
    reason: input.reason,
    escalation_phone: ctx.business.escalationPhone ?? null,
    message: "Conversación escalada a agente humano.",
  });
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  try {
    switch (name) {
      case "check_availability":
        return await executeCheckAvailability(
          input as { date: string; service_name?: string },
          ctx
        );
      case "create_appointment":
        return await executeCreateAppointment(
          input as {
            customer_name: string;
            customer_phone: string;
            service_name: string;
            start_time: string;
          },
          ctx
        );
      case "cancel_appointment":
        return await executeCancelAppointment(
          input as { appointment_id: string },
          ctx
        );
      case "get_appointments":
        return await executeGetAppointments(
          input as { customer_phone: string },
          ctx
        );
      case "escalate_to_human":
        return await executeEscalateToHuman(
          input as { reason: string },
          ctx
        );
      default:
        return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return JSON.stringify({ error: message });
  }
}

function parseCells(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function isTableRow(line: string): boolean {
  return /^\s*\|.+/.test(line) && line.split("|").length >= 3;
}

function stripMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isTableRow(lines[i])) {
      result.push(lines[i]);
      i++;
      continue;
    }

    const headers = parseCells(lines[i]);
    const nextLine = lines[i + 1] ?? "";

    if (isSeparatorRow(nextLine)) {
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && !isSeparatorRow(lines[i])) {
        const cells = parseCells(lines[i]);
        const parts = headers.map((h, idx) => `**${h}:** ${cells[idx] ?? ""}`);
        result.push(`• ${parts.join(" - ")}`);
        i++;
      }
    } else {
      const cells = parseCells(lines[i]);
      result.push(`• ${cells.join(" - ")}`);
      i++;
    }
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const agentService: IAgentService = {
  async processMessage({ customerPhone, businessId, messageContent }) {
    const business = await businessService.getById(businessId);
    if (!business || !business.active) {
      throw new Error(`Business ${businessId} not found or inactive`);
    }

    const conversation = await conversationService.findOrCreateConversation(
      businessId,
      customerPhone
    );

    const sanitizedContent = sanitizeUserInput(messageContent);

    await conversationService.addMessage(
      conversation.id,
      MessageRole.USER,
      sanitizedContent
    );

    const history = await conversationService.getHistory(conversation.id, 20);

    const systemPrompt = buildSystemPrompt(business);

    const messages: MessageParam[] = history
      .filter((m) => m.role !== MessageRole.SYSTEM)
      .map((m) => ({
        role: (m.role === MessageRole.USER ? "user" : "assistant") as "user" | "assistant",
        content: sanitizeUserInput(m.content),
      }));

    const ctx: ToolContext = {
      business,
      conversationId: conversation.id,
      customerPhone,
    };

    let responseText = "";

    while (true) {
      let response: Anthropic.Message;
      try {
        response = await callAnthropic(systemPrompt, messages);
      } catch (err) {
        if (err instanceof AnthropicTimeoutError) {
          return FALLBACK_MESSAGE;
        }
        throw err;
      }

      if (response.stop_reason === "end_turn") {
        const textBlock = response.content.find((b) => b.type === "text");
        responseText = textBlock?.type === "text" ? textBlock.text : "";
        break;
      }

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });

        const toolResults: ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const result = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
            ctx
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      break;
    }

    const cleanedResponse = stripMarkdownTables(responseText);

    await conversationService.addMessage(
      conversation.id,
      MessageRole.ASSISTANT,
      cleanedResponse
    );

    return cleanedResponse;
  },
};
