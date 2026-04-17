import { buildSystemPrompt } from "./prompts";
import { PersonaConfig, ProviderPriorityConfig, BuiltInProvider, ModelSelection } from "../config/types";
import { generateTextWithFallback } from "./providers";
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
  toolResult?: string,
  providerPriority?: ProviderPriorityConfig[],
  rateLimitConfig?: Record<BuiltInProvider, { maxTokensPerDay: number; warnThreshold: number }>,
  modelSelection?: { orchestrator: ModelSelection; fast: ModelSelection; powerful: ModelSelection },
): Promise<OrchestratorResult> {
  if (!userMessage.trim()) return FALLBACK;

  console.log("[Orchestrator] Starting orchestration...");

  const toolList = registry.toPromptString();
  const toolListWithContext = toolResult
    ? `${toolList}\n\n## Active tool result\n${toolResult.slice(0, 500)}\nDecide if another tool is needed or return tool: null to synthesize.`
    : toolList;
  const systemPrompt = buildSystemPrompt("orchestrator", persona, profileContext, toolListWithContext);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.slice(-6).map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: userMessage },
  ];

  if (toolResult) {
    const toolResultLabel = toolResult.startsWith("TOOL_FAILED:")
      ? "[PREVIOUS TOOL FAILED — do not repeat same call]"
      : "Previous tool result:";
    messages.push({
      role: "user",
      content: `${toolResultLabel}\n${toolResult.slice(0, 500)}\n\nBased on this result, what should I do next? Return JSON routing decision.`,
    });
  }

  // Default priority if not provided
  const priority = providerPriority || [
    { provider: "groq", priority: 1, enabled: true },
    { provider: "cerebras", priority: 2, enabled: true },
    { provider: "openrouter", priority: 3, enabled: true },
    { provider: "anthropic", priority: 4, enabled: true },
  ];

  console.log("[Orchestrator] Calling generateText with fallback...");

  const result = await generateTextWithFallback(messages, "orchestrator", priority, rateLimitConfig, modelSelection);

  console.log("[Orchestrator] Raw response:", result.text, "finishReason:", result.finishReason, "provider:", result.provider, "model:", result.model);

  let parsed: OrchestratorResult;
  try {
    parsed = parseOrchestration(result.text);
  } catch {
    throw new Error(`Orchestrator returned unparseable response: ${result.text.slice(0, 200)}`);
  }
  console.log("[Orchestrator] Parsed result:", parsed);
  return parsed;
}
