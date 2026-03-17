import type Anthropic from "@anthropic-ai/sdk";

export const agentTools: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "Consulta los turnos disponibles para una fecha específica. Retorna los horarios libres del día.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Fecha para verificar disponibilidad, en formato YYYY-MM-DD",
        },
        service_name: {
          type: "string",
          description:
            "Nombre del servicio. Se usa para calcular la duración del turno.",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "create_appointment",
    description: "Crea un nuevo turno para un cliente.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: {
          type: "string",
          description: "Nombre completo del cliente",
        },
        customer_phone: {
          type: "string",
          description: "Número de teléfono del cliente",
        },
        service_name: {
          type: "string",
          description: "Nombre del servicio a agendar",
        },
        start_time: {
          type: "string",
          description:
            "Hora de inicio del turno en formato ISO 8601 (ej: 2024-01-15T10:00:00)",
        },
      },
      required: ["customer_name", "customer_phone", "service_name", "start_time"],
    },
  },
  {
    name: "cancel_appointment",
    description: "Cancela un turno existente por su ID.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id: {
          type: "string",
          description: "El ID del turno a cancelar",
        },
      },
      required: ["appointment_id"],
    },
  },
  {
    name: "get_appointments",
    description: "Obtiene los turnos futuros de un cliente por su número de teléfono.",
    input_schema: {
      type: "object",
      properties: {
        customer_phone: {
          type: "string",
          description: "Número de teléfono del cliente",
        },
      },
      required: ["customer_phone"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Escala la conversación a un agente humano cuando no se puede resolver la consulta del cliente.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo por el que se escala a un humano",
        },
      },
      required: ["reason"],
    },
  },
];
