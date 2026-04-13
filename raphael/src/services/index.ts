import { invoke } from "@tauri-apps/api/core";
import { ServiceMap } from "../agent/dispatcher";
import { calendarService } from "../calendar/store";
import { generateText } from "ai";
import { getGroqProvider } from "../agent/groq";





export async function getGmailAuthStatus(): Promise<boolean> {
  return invoke<boolean>("get_gmail_auth_status");
}

export async function startGoogleOAuth(): Promise<string> {
  return invoke<string>("start_google_oauth");
}

export async function revokeGoogleOAuth(): Promise<void> {
  await invoke("revoke_google_oauth");
}

export async function createServices(): Promise<ServiceMap> {
  return {
    gmail: {
      listEmails: async () => ({ success: true, data: [] }),
      readEmail: async () => ({ success: true, data: {} }),
      draftEmail: async (p) => ({ success: true, data: p }),
      sendEmail: async (p) => {
        const params = p as { to?: string; subject?: string; body?: string };
        try {
          const from = await invoke<string | null>("get_secret", { key: "gmail_address" });
          if (!from) {
            return { success: false, error: "Gmail address not configured. Please complete onboarding." };
          }
          await invoke("send_email", {
            from,
            to: params.to ?? "",
            subject: params.subject ?? "(no subject)",
            body: params.body ?? "",
          });
          return { success: true, data: { sent: true } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },
    calendar: calendarService,
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
      query: async (p) => {
        const params = p as { query?: string; depth?: number };
        if (!params.query) {
          console.error("[Graphify] Missing query param in memory.query");
          return { success: false, error: "Missing query param" };
        }
        try {
          console.log(`[Graphify] Executing memory.query for: "${params.query}"`);
          const result = await invoke<string>("graphify_query", {
            query: params.query,
            depth: params.depth ?? 2,
          });
          console.log(`[Graphify] memory.query SUCCESS. Result snippet: ${result.substring(0, 150)}...`);
          return { success: true, data: result };
        } catch (e) {
          console.error(`[Graphify] memory.query FAILED:`, e);
          return { success: false, error: String(e) };
        }
      },
      saveProfile: async (p) => {
        const params = p as { info?: string };
        if (!params.info) return { success: false, error: "Missing info param" };
        try {
          await invoke("update_profile", { info: params.info });
          return { success: true, data: { saved: true } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      store: async (p) => {
        const params = p as { text?: string };
        if (!params.text) {
          console.error("[Graphify] Missing text param in memory.store");
          return { success: false, error: "Missing text param" };
        }
        try {
          console.log(`[Graphify] Executing memory.store with text: "${params.text}"`);
          const result = await invoke<string>("store_memory", { text: params.text });
          console.log(`[Graphify] memory.store SUCCESS. Result: ${result}`);
          return {
            success: true,
            data: { stored: true, result },
          };
        } catch (e) {
          console.error(`[Graphify] memory.store FAILED:`, e);
          return { success: false, error: String(e) };
        }
      },
    },
    search: {
      query: async (p) => {
        const params = p as { query?: string };
        try {
          const results = await invoke<{
            organic: Array<{ title: string; link: string; snippet: string; position: number }>;
            knowledge_graph?: { title: string; description?: string; website?: string };
          }>("search_web", { query: params.query ?? "" });
          return { success: true, data: results };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },
    http: {
      fetch: async (p) => {
        const params = p as { url?: string; method?: string; body?: string };
        try {
          const result = await invoke<unknown>("http_fetch", {
            params: {
              url: params.url ?? "",
              method: params.method ?? "POST",
              body: params.body,
            },
          });
          return { success: true, data: result };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },
  };
}
