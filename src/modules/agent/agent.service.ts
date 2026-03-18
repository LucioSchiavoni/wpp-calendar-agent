import Anthropic from "@anthropic-ai/sdk";
import {
  AppointmentStatus,
  ConversationStatus,
  MessageRole,
  type Business,
} from "@prisma/client";
import { prisma } from "@/lib/prisma.js";
import { env } from "@/config/env.js";
import { conversationService } from "@/modules/conversation/conversation.service.js";
import { businessService } from "@/modules/business/business.service.js";
import { agentTools } from "@/modules/agent/agent.tools.js";
import { buildSystemPrompt } from "@/modules/agent/agent.prompt.js";
import { calendarService } from "@/modules/calendar/calendar.service.js";

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

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

async function executeCheckAvailability(
  input: { date: string; service_name?: string },
  ctx: ToolContext
): Promise<string> {
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
      slots = await calendarService.getAvailableSlots(
        ctx.business.calendarId,
        input.date,
        duration,
        workingHours
      );
    } catch {
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

async function getAvailableSlotsFromDb(
  date: string,
  duration: number,
  workingHours: WorkingHour[],
  ctx: ToolContext
): Promise<string[]> {
  const [year, month, day] = date.split("-").map(Number);
  const targetDate = new Date(year, month - 1, day);
  const dayOfWeek = targetDate.getDay();

  const schedule = workingHours.find((h) => h.day === dayOfWeek);
  if (!schedule) return [];

  const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
  const endOfDay = new Date(year, month - 1, day, 23, 59, 59);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      businessId: ctx.business.id,
      startTime: { gte: startOfDay, lte: endOfDay },
      status: { notIn: [AppointmentStatus.CANCELLED] },
    },
  });

  const [startHour, startMin] = schedule.start.split(":").map(Number);
  const [endHour, endMin] = schedule.end.split(":").map(Number);

  const slots: string[] = [];
  let current = new Date(year, month - 1, day, startHour, startMin, 0);
  const workEnd = new Date(year, month - 1, day, endHour, endMin, 0);

  while (current < workEnd) {
    const slotEnd = new Date(current.getTime() + duration * 60 * 1000);
    if (slotEnd > workEnd) break;

    const isOccupied = existingAppointments.some(
      (apt) => current < apt.endTime && slotEnd > apt.startTime
    );

    if (!isOccupied) {
      const hh = current.getHours().toString().padStart(2, "0");
      const mm = current.getMinutes().toString().padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }

    current = new Date(current.getTime() + duration * 60 * 1000);
  }

  return slots;
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
        description: `Turno agendado por WhatsApp. Teléfono: ${input.customer_phone}`,
      });
    } catch {
      // Calendar event creation failed — appointment is still saved in DB
    }
  }

  const appointment = await prisma.appointment.create({
    data: {
      businessId: ctx.business.id,
      conversationId: ctx.conversationId,
      customerPhone: input.customer_phone,
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

    await conversationService.addMessage(
      conversation.id,
      MessageRole.USER,
      messageContent
    );

    const history = await conversationService.getHistory(conversation.id, 20);

    const messages: Anthropic.MessageParam[] = history
      .filter((m) => m.role !== MessageRole.SYSTEM)
      .map((m) => ({
        role: m.role === MessageRole.USER ? "user" : "assistant",
        content: m.content,
      }));

    const systemPrompt = buildSystemPrompt(business);

    const ctx: ToolContext = {
      business,
      conversationId: conversation.id,
      customerPhone,
    };

    let responseText = "";

    while (true) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        tools: agentTools,
        messages,
      });

      if (response.stop_reason === "end_turn") {
        const textBlock = response.content.find(
          (b): b is Anthropic.TextBlock => b.type === "text"
        );
        responseText = textBlock?.text ?? "";
        break;
      }

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

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
