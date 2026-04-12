import { invoke } from "@tauri-apps/api/core";
import { ServiceMap, ToolResult } from "../agent/dispatcher";

const OAUTH_REDIRECT_URI = "http://localhost:9876/callback";
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.modify";
const CALENDAR_SCOPES = "https://www.googleapis.com/auth/calendar";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

async function getSecret(key: string): Promise<string | null> {
  return await invoke<string | null>("get_secret", { key });
}

async function setSecret(key: string, value: string): Promise<void> {
  await invoke("set_secret", { key, value });
}

async function getAccessToken(): Promise<string | null> {
  const accessToken = await getSecret("google_access_token");
  if (accessToken) return accessToken;

  const refreshToken = await getSecret("google_refresh_token");
  if (!refreshToken) return null;

  const clientId = await getSecret("google_client_id");
  const clientSecret = await getSecret("google_client_secret");
  if (!clientId || !clientSecret) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data: TokenResponse = await res.json();
  if (data.access_token) {
    await setSecret("google_access_token", data.access_token);
    return data.access_token;
  }

  return null;
}

async function gmailRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const token = await getAccessToken();
  if (!token) throw new Error("No access token available");

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail API ${res.status}: ${errText}`);
  }
  return res.json();
}

async function calendarRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const token = await getAccessToken();
  if (!token) throw new Error("No access token available");

  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Calendar API ${res.status}: ${errText}`);
  }
  return res.json();
}

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function decodeEmailBody(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  if (p.body && typeof p.body === "object" && (p.body as Record<string, unknown>).data) {
    return base64UrlDecode((p.body as Record<string, unknown>).data as string);
  }
  if (p.parts && Array.isArray(p.parts)) {
    for (const part of p.parts) {
      if (part && typeof part === "object") {
        const pt = part as Record<string, unknown>;
        if (pt.mimeType === "text/plain" && pt.body && typeof pt.body === "object") {
          const body = pt.body as Record<string, unknown>;
          if (body.data) return base64UrlDecode(body.data as string);
        }
      }
    }
  }
  return "";
}

function extractHeader(headers: Array<Record<string, unknown>>, name: string): string {
  if (!Array.isArray(headers)) return "";
  for (const h of headers) {
    if (h && typeof h === "object") {
      const header = h as Record<string, unknown>;
      const headerName = header.name as string | undefined;
      if (headerName?.toLowerCase() === name.toLowerCase()) {
        return String(header.value || "");
      }
    }
  }
  return "";
}

async function listEmails(
  params: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const clientId = await getSecret("google_client_id");
    if (!clientId) return { success: true, data: [] };

    const token = await getAccessToken();
    if (!token) return { success: true, data: [] };

    const query = (params.query as string) || "";
    const listRes = (await gmailRequest(
      "GET",
      `/users/me/messages?maxResults=10${query ? `&q=${encodeURIComponent(query)}` : ""}`
    )) as Record<string, unknown>;

    const messages = listRes.messages as Array<{ id: string }> || [];
    const emails = await Promise.all(
      messages.map(async (msg) => {
        const msgRes = (await gmailRequest(
          "GET",
          `/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From,Subject,Date`
        )) as Record<string, unknown>;
        const msgResPayload = msgRes.payload as Record<string, unknown>;
        const headers = (msgResPayload?.headers) as Array<Record<string, unknown>> || [];
        return {
          id: msg.id,
          from: extractHeader(headers, "From"),
          subject: extractHeader(headers, "Subject"),
          date: extractHeader(headers, "Date"),
        };
      })
    );

    return { success: true, data: emails };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function readEmail(params: Record<string, unknown>): Promise<ToolResult> {
  try {
    const id = params.id as string;
    if (!id) return { success: false, error: "Missing email id" };

    const token = await getAccessToken();
    if (!token) return { success: false, error: "Not authenticated" };

    const msgRes = (await gmailRequest(
      "GET",
      `/users/me/messages/${id}?format=full`
    )) as Record<string, unknown>;

    const msgResPayload = msgRes.payload as Record<string, unknown>;
    const headers = (msgResPayload?.headers) as Array<Record<string, unknown>> || [];
    const body = decodeEmailBody(msgRes.payload);

    return {
      success: true,
      data: {
        id: msgRes.id,
        from: extractHeader(headers, "From"),
        subject: extractHeader(headers, "Subject"),
        body,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function draftEmail(params: Record<string, unknown>): Promise<ToolResult> {
  try {
    const to = params.to as string;
    const subject = params.subject as string;
    const body = params.body as string;
    if (!to || !subject) return { success: false, error: "Missing to or subject" };

    const token = await getAccessToken();
    if (!token) return { success: false, error: "Not authenticated" };

    const rawMessage = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\n");

    const raw = base64UrlEncode(rawMessage);

    const res = (await gmailRequest(
      "POST",
      "/users/me/drafts",
      { message: { raw } }
    )) as Record<string, unknown>;

    return { success: true, data: { draftId: res.id } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function sendEmail(params: Record<string, unknown>): Promise<ToolResult> {
  try {
    const to = params.to as string;
    const subject = params.subject as string;
    const body = params.body as string;
    if (!to || !subject) return { success: false, error: "Missing to or subject" };

    const from = await getSecret("gmail_address");
    if (!from) {
      return { success: false, error: "Gmail address not configured. Please complete onboarding." };
    }

    await invoke("send_email", {
      from,
      to,
      subject,
      body: body || "",
    });

    return { success: true, data: { sent: true } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

function getDefaultTimeRange(): { from: string; to: string } {
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    from: now.toISOString(),
    to: weekLater.toISOString(),
  };
}

async function listEvents(
  params: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const clientId = await getSecret("google_client_id");
    if (!clientId) return { success: true, data: [] };

    const token = await getAccessToken();
    if (!token) return { success: true, data: [] };

    const { from, to } = params.from && params.to
      ? { from: params.from as string, to: params.to as string }
      : getDefaultTimeRange();

    const eventsRes = (await calendarRequest(
      "GET",
      `/calendars/primary/events?maxResults=10&orderBy=startTime&singleEvents=true&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`
    )) as Record<string, unknown>;

    const events = ((eventsRes.items as Array<Record<string, unknown>>) || []).map((evt) => ({
      id: evt.id,
      summary: evt.summary || "",
      start: (evt.start as Record<string, unknown>)?.dateTime || (evt.start as Record<string, unknown>)?.date,
      end: (evt.end as Record<string, unknown>)?.dateTime || (evt.end as Record<string, unknown>)?.date,
    }));

    return { success: true, data: events };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function createEvent(params: Record<string, unknown>): Promise<ToolResult> {
  try {
    const title = params.title as string;
    const start = params.start as string;
    const end = params.end as string;
    if (!title || !start || !end) {
      return { success: false, error: "Missing title, start, or end" };
    }

    const token = await getAccessToken();
    if (!token) return { success: false, error: "Not authenticated" };

    const eventRes = (await calendarRequest(
      "POST",
      "/calendars/primary/events",
      {
        summary: title,
        description: (params.description as string) || "",
        start: { dateTime: start, timeZone: "UTC" },
        end: { dateTime: end, timeZone: "UTC" },
      }
    )) as Record<string, unknown>;

    return {
      success: true,
      data: {
        eventId: eventRes.id,
        link: eventRes.htmlLink,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function checkAvailability(
  params: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const from = params.from as string;
    const to = params.to as string;
    if (!from || !to) return { success: false, error: "Missing from or to" };

    const token = await getAccessToken();
    if (!token) return { success: false, error: "Not authenticated" };

    const res = (await calendarRequest(
      "POST",
      "/freeBusy",
      {
        timeMin: from,
        timeMax: to,
        items: [{ id: "primary" }],
      }
    )) as Record<string, unknown>;

    const primary = (res.calendars as Record<string, unknown>)?.primary as Record<string, unknown>;
    const busySlots = ((primary?.busy as Array<Record<string, unknown>>) || []).map((slot) => ({
      start: slot.start,
      end: slot.end,
    }));

    return { success: true, data: { busy: busySlots } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function createServices(): Promise<ServiceMap> {
  return {
    gmail: {
      listEmails,
      readEmail,
      draftEmail,
      sendEmail,
    },
    calendar: {
      listEvents,
      createEvent,
      checkAvailability,
    },
    x: {
      getTimeline: async () => ({ success: true, data: [] }),
      getMentions: async () => ({ success: true, data: [] }),
      searchTweets: async () => ({ success: true, data: [] }),
    },
    files: {
      searchFiles: async () => ({ success: true, data: [] }),
      readFile: async () => ({ success: true, data: { path: "", content: "" } }),
    },
    memory: {
      query: async () => ({ success: true, data: {} }),
    },
  };
}

export async function triggerGoogleOAuth(): Promise<boolean> {
  const clientId = await getSecret("google_client_id");
  const clientSecret = await getSecret("google_client_secret");
  if (!clientId || !clientSecret) return false;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", `${GMAIL_SCOPES} ${CALENDAR_SCOPES}`);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  const { open } = await import("@tauri-apps/plugin-shell");
  await open(authUrl.toString());

  return new Promise((resolve) => {
    const http = require("http");
    const server = http.createServer((req: typeof http.IncomingMessage, res: typeof http.ServerResponse) => {
      const urlObj = new URL(req.url || "", "http://localhost:9876");
      const code = urlObj.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Success! You can close this window.</h1>");
        server.close();

        const params = new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: OAUTH_REDIRECT_URI,
          grant_type: "authorization_code",
        });

        fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
          .then((r: Response) => r.json())
          .then(async (data: TokenResponse) => {
            if (data.access_token) {
              await setSecret("google_access_token", data.access_token);
            }
            if (data.refresh_token) {
              await setSecret("google_refresh_token", data.refresh_token);
            }
            resolve(!!data.access_token);
          })
          .catch(() => resolve(false));
      } else {
        res.writeHead(400);
        res.end("Missing code");
      }
    });

    server.listen(9876);
  });
}