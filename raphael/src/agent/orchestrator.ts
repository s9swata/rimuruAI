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
  let jsonStr = raw.trim();
  
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  
  const parsed = JSON.parse(jsonStr);
  
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
  const systemPrompt = buildSystemPrompt("orchestrator", persona);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: userMessage },
  ];
  
  const raw = await completeJSON(MODELS.orchestrator, messages);
  return parseOrchestration(raw);
}