import { completeJSON } from "./groq";
import { MODELS, buildSystemPrompt } from "./prompts";
import { PersonaConfig } from "../config/types";

export interface OrchestratorResult {
  model: "fast" | "powerful";
  tool: string | null;
  params: Record<string, unknown> | null;
  intent: string;
}

export function parseOrchestration(raw: string): OrchestratorResult {
  console.log("[Orchestrator] Raw response:", raw.substring(0, 500));
  // Strip <think>... blocks from reasoning models (e.g. qwen3, deepseek-r1)
  let jsonStr = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  
  // Try to find JSON object in the response
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in response: " + jsonStr.substring(0, 200));
  }
  jsonStr = jsonMatch[0];

  console.log("[Orchestrator] Parsing JSON...");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error("[Orchestrator] JSON parse error:", e);
    // Try to fix common issues
    jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    parsed = JSON.parse(jsonStr);
  }
  
  if (
    typeof parsed.model !== "string" ||
    typeof parsed.intent !== "string" ||
    (parsed.tool !== null && typeof parsed.tool !== "string") ||
    (parsed.params !== null && typeof parsed.params !== "object")
  ) {
    throw new Error("Invalid orchestration shape");
  }

  if (parsed.model !== "fast" && parsed.model !== "powerful") {
    throw new Error("Invalid model tier");
  }

  console.log("[Orchestrator] Parsed result:", parsed);
  return {
    model: parsed.model,
    tool: parsed.tool,
    params: parsed.params,
    intent: parsed.intent,
  };
}

export async function orchestrate(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  persona: PersonaConfig,
): Promise<OrchestratorResult> {
  console.log("[Orchestrator] Starting orchestration...");
  const systemPrompt = buildSystemPrompt("orchestrator", persona);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: userMessage },
  ];
  
  try {
    console.log("[Orchestrator] Calling completeJSON...");
    const raw = await completeJSON(MODELS.orchestrator, messages);
    console.log("[Orchestrator] Got raw response, length:", raw.length, "preview:", raw.substring(0, 100));
    console.log("[Orchestrator] Parsing...");
    return parseOrchestration(raw);
  } catch (e) {
    console.error("[Orchestrator] Error:", e);
    throw e;
  }
}