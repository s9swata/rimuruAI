import { invoke } from "@tauri-apps/api/core";
import { ServiceMap, ResourceManifest } from "../agent/dispatcher";
import { calendarService } from "../calendar/store";
import { callMemoryTool } from "../agent/MemoryMCPClient";





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
      searchFiles: async (p) => {
        const params = p as { query?: string };
        const query = params.query ?? "";
        const lastSlash = query.lastIndexOf("/");
        const dir = lastSlash >= 0 ? query.slice(0, lastSlash) || "/" : "/";
        const pattern = lastSlash >= 0 ? query.slice(lastSlash + 1) : query;
        try {
          const files = await invoke<string[]>("list_files", { dir, pattern });
          return { success: true, data: { files } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
      readFile: async (p) => {
        const params = p as { path?: string };
        const path = params.path ?? "";
        try {
          const content = await invoke<string>("read_file_content", { path });
          return { success: true, data: { path, content } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },
    memory: {
      // ── Backed by @modelcontextprotocol/server-memory via Rust stdio ──────
      query: async (p) => {
        const params = p as { query?: string };
        if (!params.query) return { success: false, error: "Missing query param" };
        console.log(`[MemoryMCP] memory.query: "${params.query}"`);
        // The official memory server exposes a 'search_nodes' tool for querying
        return callMemoryTool("search_nodes", { query: params.query });
      },
      saveProfile: async (p) => {
        const params = p as { info?: string };
        if (!params.info) return { success: false, error: "Missing info param" };
        console.log("[Memory] saveProfile: saving profile entry");
        try {
          await invoke("update_profile", { info: params.info });
          return { success: true, data: { saved: true } };
        } catch (e) {
          console.error("[Memory] saveProfile failed:", e);
          return { success: false, error: String(e) };
        }
      },
      store: async (p) => {
        const params = p as { text?: string; entityName?: string; entityType?: string };
        if (!params.text) return { success: false, error: "Missing text param" };
        console.log(`[MemoryMCP] memory.store: "${params.text}"`);
        // Create a generic entity + observation using server-memory's tools
        const name = params.entityName ?? `fact_${Date.now()}`;
        const type = params.entityType ?? "fact";
        // Step 1: create or upsert entity
        await callMemoryTool("create_entities", {
          entities: [{ name, entityType: type, observations: [params.text] }],
        });
        return { success: true, data: { stored: true, entity: name } };
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
    resources: {
      define: (manifest: ResourceManifest) =>
        invoke<ResourceManifest>("resource_define", { manifest }),
      listManifests: () =>
        invoke<ResourceManifest[]>("resource_list_manifests"),
      upsert: (resource_type: string, item: Record<string, unknown>) =>
        invoke<Record<string, unknown>>("resource_upsert", { resource_type, item }),
      find: (resource_type: string, query: string) =>
        invoke<Record<string, unknown>[]>("resource_find", { resource_type, query }),
      list: (resource_type: string) =>
        invoke<Record<string, unknown>[]>("resource_list", { resource_type }),
      delete: (resource_type: string, id: string) =>
        invoke<boolean>("resource_delete", { resource_type, id }),
    },
  };
}
