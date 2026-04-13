import { generateObject } from "ai";
import { z } from "zod";
import { MODELS, buildSystemPrompt } from "./prompts";
import { PersonaConfig } from "../config/types";
import { getGroqProvider } from "./groq";
import { ToolRegistry } from "./registry";

export interface OrchestratorResult {
  model: "fast" | "powerful";
  tool: string | null;
  params: Record<string, unknown> | null;
  intent: string;
}

/**
 * Analyze the user's message and decide which tool (if any) to call.
 *
 * @param userMessage   - latest message from the user
 * @param history       - prior conversation turns
 * @param persona       - user's configured persona
 * @param profileContext - saved profile facts about the user
 * @param registry      - the live ToolRegistry; used to build the tool list in the prompt
 */
export async function orchestrate(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  persona: PersonaConfig,
  profileContext: string,
  registry: ToolRegistry,
): Promise<OrchestratorResult> {
  console.log("[Orchestrator] Starting orchestration (via Vercel AI SDK)...");

  const groq = await getGroqProvider();
  const toolList = registry.toPromptString();
  const systemPrompt = buildSystemPrompt("orchestrator", persona, profileContext, toolList);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: userMessage },
  ];

  try {
    console.log("[Orchestrator] Calling generateObject...");

    const { object } = await generateObject({
      model: groq(MODELS.orchestrator),
      providerOptions: { groq: { structuredOutputs: false } },
      messages,
      schema: z.object({
        model: z.enum(["fast", "powerful"]).describe("Which model tier to use for the user response"),
        tool: z.string().nullable().describe("The name of the tool to execute, or null if no tool needed"),
        params: z.record(z.string(), z.unknown()).nullable().describe("The parameters to pass into the tool, or null"),
        intent: z.string().describe("A brief description of what you are doing in response to the user query"),
      }),
    });

    console.log("[Orchestrator] Parsed result:", object);
    return object;
  } catch (e) {
    console.error("[Orchestrator] Error generating object:", e);
    throw e;
  }
}
