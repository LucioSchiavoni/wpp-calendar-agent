import type { FastifyInstance } from "fastify";
import { calendarService } from "@/modules/calendar/calendar.service.js";

export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/google", async (_request, reply) => {
    const url = calendarService.getAuthUrl();
    return reply.redirect(url);
  });

  app.get<{ Querystring: { code?: string; error?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      const { code, error } = request.query;

      if (error) {
        return reply.status(400).send({ error: `OAuth error: ${error}` });
      }

      if (!code) {
        return reply.status(400).send({ error: "Missing authorization code" });
      }

      await calendarService.exchangeCode(code);

      return reply.send({
        success: true,
        message: "Google Calendar connected successfully.",
      });
    }
  );
}
