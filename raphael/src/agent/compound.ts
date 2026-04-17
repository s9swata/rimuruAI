/**
 * Groq Compound systems — server-side agentic loop with built-in tools
 * (web_search, visit_website, browser_automation, code_interpreter, wolfram_alpha).
 *
 * Calls the Groq OpenAI-compatible endpoint directly because the Vercel AI SDK
 * groq provider does not pass `compound_custom` through, and we need access to
 * the `executed_tools` field returned by the server.
 */

import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_COMPOUND_TOOLS, GROQ_COMPOUND_MODELS } from "./prompts";

export interface ExecutedToolSearchResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

export interface ExecutedTool {
  index?: number;
  type: string;
  arguments?: string | Record<string, unknown>;
  output?: string;
  search_results?: { results?: ExecutedToolSearchResult[] };
  code_results?: unknown;
}

export interface CompoundOptions {
  model?: string;
  enabledTools?: string[];
  onChunk?: (text: string) => void;
  onExecutedTools?: (tools: ExecutedTool[]) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}

function parseKeys(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const arr = JSON.parse(stored);
    if (Array.isArray(arr)) return arr.filter(Boolean);
    if (typeof arr === "string") return [arr];
  } catch {}
  return stored.trim() ? [stored.trim()] : [];
}

async function getGroqApiKey(): Promise<string> {
  const stored = await invoke<string | null>("get_secret", { key: "groq_api_key" });
  const keys = parseKeys(stored);
  if (keys.length === 0) throw new Error("Groq API key not configured");
  return keys[Math.floor(Math.random() * keys.length)];
}

export const COMPOUND_MODELS = GROQ_COMPOUND_MODELS;

export async function streamCompound(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: CompoundOptions = {},
): Promise<{ text: string; executed_tools: ExecutedTool[] }> {
  const apiKey = await getGroqApiKey();
  const model = options.model ?? GROQ_COMPOUND_MODELS.full;
  const enabledTools = options.enabledTools ?? DEFAULT_COMPOUND_TOOLS;

  const body = {
    model,
    messages,
    stream: true,
    temperature: 0.7,
    compound_custom: {
      tools: { enabled_tools: enabledTools },
    },
  };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Groq compound request failed: ${response.status} ${errText.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  // Merge tool entries by index across stream chunks. Streaming responses send
  // each step incrementally; replacing the array on every event drops earlier
  // steps, leaving only the last one visible in the UI.
  const toolsByIndex = new Map<number, ExecutedTool>();
  let nextSyntheticIndex = 0;

  function mergeTools(entries: unknown) {
    if (!Array.isArray(entries)) return;
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as Partial<ExecutedTool> & { index?: number };
      const idx = typeof entry.index === "number" ? entry.index : nextSyntheticIndex++;
      const prev = toolsByIndex.get(idx) ?? ({ index: idx, type: "" } as ExecutedTool);
      const merged: ExecutedTool = { ...prev, ...entry, index: idx } as ExecutedTool;

      // Concatenate streamed string fields (arguments / output) instead of replace
      if (typeof prev.arguments === "string" && typeof entry.arguments === "string") {
        merged.arguments = prev.arguments + entry.arguments;
      }
      if (typeof prev.output === "string" && typeof entry.output === "string") {
        merged.output = prev.output + entry.output;
      }
      toolsByIndex.set(idx, merged);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx;
    while ((sepIdx = buffer.indexOf("\n\n")) >= 0) {
      const event = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);

      for (const line of event.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (delta && typeof delta.content === "string" && delta.content) {
            fullText += delta.content;
            options.onChunk?.(delta.content);
          }
          mergeTools(delta?.executed_tools);
          mergeTools(choice.message?.executed_tools);
        } catch (e) {
          console.warn("[compound] SSE parse error", e, data.slice(0, 200));
        }
      }
    }
  }

  const executedTools = Array.from(toolsByIndex.values()).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  );

  options.onExecutedTools?.(executedTools);
  options.onDone?.();
  return { text: fullText, executed_tools: executedTools };
}
