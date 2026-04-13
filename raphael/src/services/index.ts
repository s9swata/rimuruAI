import { invoke } from "@tauri-apps/api/core";
import { ServiceMap } from "../agent/dispatcher";
import { calendarService } from "../calendar/store";
import { generateText } from "ai";
import { getGroqProvider } from "../agent/groq";

type ExtractionResult = {
  nodes: Array<{
    id: string;
    label: string;
    node_type: string;
    description: string;
    confidence: "EXTRACTED" | "INFERRED";
  }>;
  edges: Array<{
    source: string;
    target: string;
    relation: string;
    confidence: "EXTRACTED" | "INFERRED" | "AMBIGUOUS";
    confidence_score: number;
  }>;
};

async function extractNodesFromText(text: string): Promise<ExtractionResult> {
  const groq = await getGroqProvider();

  try {
    const { text: rawText } = await generateText({
      model: groq("llama-3.3-70b-versatile"),
      messages: [
        {
          role: "system",
          content: `You are a knowledge graph extraction engine. Extract entities and relationships from text. Output ONLY valid JSON.

RULES:
1. DO NOT extract "user", "me", "my", "I" - these refer to the speaker, not external entities
2. Node IDs MUST be snake_case (e.g., "arjun", "google", "bangalore", "machine_learning")
3. Every node MUST have a description - derive from context if not in text
4. Only extract external entities explicitly mentioned or strongly implied

Node types: person, place, concept, event, organization, technology, preference, habit
Relations: knows, lives_in, works_at, prefers, related_to, part_of, interested_in
Confidence: EXTRACTED (explicitly stated), INFERRED (implied), AMBIGUOUS (uncertain)
confidence_score: 1.0 for EXTRACTED, 0.5 for INFERRED, 0.2 for AMBIGUOUS

Output: {"nodes": [{"id": "snake_case", "label": "Human Readable", ...}], "edges": [...]}
If nothing meaningful, return {"nodes": [], "edges": []}.`,
        },
        {
          role: "user",
          content: `Extract entities and relationships from:\n${text}`,
        },
      ],
    });
    
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    console.log("[Graph] Extraction result:", JSON.stringify(parsed));
    return parsed as ExtractionResult;
  } catch (e) {
    console.error("[Graph] Extraction error:", e);
    throw e;
  }
}

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
        if (!params.query) return { success: false, error: "Missing query param" };
        try {
          const result = await invoke<{
            nodes: Array<{ id: string; label: string; node_type: string; description: string; confidence: string }>;
            edges: Array<{ source: string; target: string; relation: string; confidence: string; confidence_score: number }>;
            start_nodes: string[];
          }>("query_graph", {
            query: params.query,
            depth: params.depth ?? 2,
          });
          return { success: true, data: result };
        } catch (e) {
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
        const params = p as { text?: string; source?: string };
        if (!params.text) return { success: false, error: "Missing text param" };
        try {
          const cached = await invoke<string | null>("check_graph_cache", { text: params.text });

          let nodes: ExtractionResult["nodes"];
          let edges: ExtractionResult["edges"];

          if (cached) {
            const parsed = JSON.parse(cached) as ExtractionResult;
            nodes = parsed.nodes;
            edges = parsed.edges;
          } else {
            const extracted = await extractNodesFromText(params.text);
            nodes = extracted.nodes;
            edges = extracted.edges;
          }

          if (nodes.length === 0 && edges.length === 0) {
            return { success: true, data: { stored: 0, note: "Nothing meaningful to extract" } };
          }

          await invoke("add_to_graph", {
            params: {
              nodes: nodes.map((n) => ({
                ...n,
                source: params.source ?? "agent",
                community: null,
              })),
              edges,
              source_text: params.text,
            },
          });

          return {
            success: true,
            data: { stored: nodes.length, nodes: nodes.length, edges: edges.length },
          };
        } catch (e) {
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
