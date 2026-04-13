import { generateText } from "ai";
import { MODELS, buildSystemPrompt } from "./prompts";
import { PersonaConfig } from "../config/types";
import { withGroqRetry } from "./providers";
import { ToolRegistry } from "./registry";

export interface OrchestratorResult {
  model: "fast" | "powerful";
  tool: string | null;
  params: Record<string, unknown> | null;
  intent: string;
}

const FALLBACK: OrchestratorResult = { model: "fast", tool: null, params: null, intent: "direct response" };

function parseOrchestration(raw: string): OrchestratorResult {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // Extract first JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in response");
  const parsed = JSON.parse(match[0]);
  if (!parsed.model || !["fast", "powerful"].includes(parsed.model)) parsed.model = "fast";
  if (!("tool" in parsed)) parsed.tool = null;
  if (!("params" in parsed)) parsed.params = null;
  if (!parsed.intent) parsed.intent = "direct response";
  return parsed as OrchestratorResult;
}

export async function orchestrate(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  persona: PersonaConfig,
  profileContext: string,
  registry: ToolRegistry,
): Promise<OrchestratorResult> {
  console.log("[Orchestrator] Starting orchestration...");

  const toolList = registry.toPromptString();
  const systemPrompt = buildSystemPrompt("orchestrator", persona, profileContext, toolList);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: userMessage },
  ];

  try {
    console.log("[Orchestrator] Calling generateText via Groq (with retry)...");

    const { text, finishReason, usage } = await withGroqRetry(async (provider) => {
      const model = provider(MODELS.orchestrator);
      return generateText({
        model,
        messages,
        temperature: 0,
      });
    });

    console.log("[Orchestrator] Raw response:", text, "finishReason:", finishReason, "usage:", usage);

    const result = parseOrchestration(text);
    console.log("[Orchestrator] Parsed result:", result);
    return result;
  } catch (e) {
    console.error("[Orchestrator] Error:", String(e));
    return FALLBACK;
  }
}
