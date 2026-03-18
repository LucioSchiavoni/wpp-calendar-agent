import { google } from "googleapis";
import type { Credentials } from "google-auth-library";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "@/config/env.js";

interface WorkingHour {
  day: number;
  start: string;
  end: string;
}

interface EventInput {
  title: string;
  start: Date;
  end: Date;
  description?: string;
}

export interface ICalendarService {
  isConfigured(): boolean;
  getAuthUrl(): string;
  exchangeCode(code: string): Promise<void>;
  getAvailableSlots(
    calendarId: string,
    date: string,
    duration: number,
    workingHours: WorkingHour[]
  ): Promise<string[]>;
  createEvent(calendarId: string, event: EventInput): Promise<string>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKENS_PATH = path.resolve(__dirname, "../../../tokens.json");

function createOAuth2Client() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new Error(
      "Google OAuth2 credentials not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI."
    );
  }
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

async function loadTokens(client: InstanceType<typeof google.auth.OAuth2>): Promise<void> {
  if (env.GOOGLE_REFRESH_TOKEN) {
    client.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
    return;
  }
  try {
    const raw = await fs.readFile(TOKENS_PATH, "utf-8");
    const tokens = JSON.parse(raw) as Credentials;
    client.setCredentials(tokens);
  } catch {
    // tokens.json not found or unreadable — OAuth flow not completed yet
  }
}

async function saveTokens(tokens: Credentials): Promise<void> {
  if (env.GOOGLE_REFRESH_TOKEN) return;
  await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2), "utf-8");
  await fs.chmod(TOKENS_PATH, 0o600);
}

async function getAuthenticatedClient() {
  const client = createOAuth2Client();
  await loadTokens(client);

  client.on("tokens", async (tokens) => {
    const merged: Credentials = {
      ...client.credentials,
      ...tokens,
      refresh_token: tokens.refresh_token ?? client.credentials.refresh_token,
    };
    await saveTokens(merged);
    client.setCredentials(merged);
  });

  return client;
}

export const calendarService: ICalendarService = {
  isConfigured(): boolean {
    return !!(
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET &&
      env.GOOGLE_REDIRECT_URI
    );
  },

  getAuthUrl(): string {
    const client = createOAuth2Client();
    return client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
    });
  },

  async exchangeCode(code: string): Promise<void> {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    await saveTokens(tokens);
  },

  async getAvailableSlots(
    calendarId: string,
    date: string,
    duration: number,
    workingHours: WorkingHour[]
  ): Promise<string[]> {
    const [year, month, day] = date.split("-").map(Number);
    const targetDate = new Date(year, month - 1, day);
    const dayOfWeek = targetDate.getDay();

    const schedule = workingHours.find((h) => h.day === dayOfWeek);
    if (!schedule) return [];

    const client = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth: client });

    const timeMin = new Date(year, month - 1, day, 0, 0, 0).toISOString();
    const timeMax = new Date(year, month - 1, day, 23, 59, 59).toISOString();

    const response = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const busyIntervals =
      response.data.items
        ?.filter(
          (e) =>
            e.status !== "cancelled" &&
            e.start?.dateTime &&
            e.end?.dateTime
        )
        .map((e) => ({
          start: new Date(e.start!.dateTime!),
          end: new Date(e.end!.dateTime!),
        })) ?? [];

    const [startHour, startMin] = schedule.start.split(":").map(Number);
    const [endHour, endMin] = schedule.end.split(":").map(Number);

    const slots: string[] = [];
    let current = new Date(year, month - 1, day, startHour, startMin, 0);
    const workEnd = new Date(year, month - 1, day, endHour, endMin, 0);

    while (current < workEnd) {
      const slotEnd = new Date(current.getTime() + duration * 60 * 1000);
      if (slotEnd > workEnd) break;

      const isOccupied = busyIntervals.some(
        (interval) => current < interval.end && slotEnd > interval.start
      );

      if (!isOccupied) {
        const hh = current.getHours().toString().padStart(2, "0");
        const mm = current.getMinutes().toString().padStart(2, "0");
        slots.push(`${hh}:${mm}`);
      }

      current = new Date(current.getTime() + duration * 60 * 1000);
    }

    return slots;
  },

  async createEvent(calendarId: string, event: EventInput): Promise<string> {
    const client = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth: client });

    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: event.title,
        description: event.description,
        start: { dateTime: event.start.toISOString() },
        end: { dateTime: event.end.toISOString() },
      },
    });

    return response.data.id!;
  },

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const client = await getAuthenticatedClient();
    const calendar = google.calendar({ version: "v3", auth: client });

    await calendar.events.delete({ calendarId, eventId });
  },
};
