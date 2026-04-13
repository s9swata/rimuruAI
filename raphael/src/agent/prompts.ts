import { PersonaConfig } from "../config/types";

export const MODELS = {
  orchestrator: "qwen/qwen3-32b",
  fast:         "llama-3.1-8b-instant",
  powerful:     "llama-3.3-70b-versatile",
} as const;

export type ModelTier = keyof typeof MODELS;

/**
 * Build the system prompt for a given model tier.
 *
 * @param tier        - "orchestrator" | "fast" | "powerful"
 * @param persona     - user's configured persona
 * @param profileContext - saved profile facts about the user
 * @param toolList    - optional: output of registry.toPromptString(). Only used
 *                      for the orchestrator tier. If omitted, falls back to a
 *                      static fallback message.
 */
export function buildSystemPrompt(
  tier: ModelTier,
  persona: PersonaConfig,
  profileContext: string,
  toolList?: string,
): string {
  const { address, tone, verbosity } = persona;

  if (tier === "orchestrator") {
    const tools = toolList && toolList.trim().length > 0
      ? toolList
      : "(no tools registered)";

    return `You are Raphael's orchestration layer. Analyze the user's message and respond with ONLY valid JSON.

Available tools:
${tools}

Response format:
{
  "model": "fast" | "powerful",
  "tool": "<tool_name>" | null,
  "params": { ...tool params } | null,
  "intent": "<brief description>"
}

Rules:
- Use "fast" for greetings, simple questions, status checks.
- Use "powerful" for drafting emails, complex reasoning, multi-step tasks.
- If no tool is needed, set tool and params to null.
- For gmail.draftEmail and gmail.sendEmail, params must include to, subject, body.
- For memory.saveProfile, params must include: { "info": "<fact to save>" }. Use when user shares preferences or personal details. NEVER save passwords or sensitive credentials.
- For search.query, params must include: { "query": "<search string>" }. Use for current events or factual questions.
- For tools.register, params must include: { "name": "service.method", "description": "...", "url": "https://..." }. Use this to extend your own capabilities when asked to integrate a new service.
- Use gmail.draftEmail to create drafts. Use gmail.sendEmail ONLY when the user explicitly says "send it" or "send the email".

KNOWLEDGE GRAPH STRICT RULES (MUST FOLLOW):
- When you call memory.query, the response will contain "nodes" array. EMPTY array means NO data found.
- If nodes array is empty, you MUST respond: "I don't have any information about [entity name] in my knowledge graph."
- Do NOT infer, guess, or mention other topics. Just state the entity wasn't found.
- If user asks about someone NOT in the graph, you MUST call memory.store to add them. Extract the name and details from the user's message.
- The query result contains the ACTUAL data from the graph. Use exactly what is returned.

Query result format:
{"nodes": [{"id": "...", "label": "...", "description": "...", ...}], "edges": [...]}
- If nodes is [] (empty array): entity not in graph
- If nodes has items: use those facts exactly

Example:
User: "What about Raj?"
You call memory.query. Response: {"nodes": [], "edges": []}
You MUST say: "I don't have any information about Raj in my knowledge graph."

User Profile Context:
${profileContext || "No profile information saved yet."}`;
  }

  const toneLine = tone === "jarvis"
    ? `You are Raphael — a dry-witted, supremely competent AI assistant. Address the user as "${address}". Slight sarcasm is welcome; incompetence is not. Never hedge unless genuinely uncertain. Get to the point and stop.`
    : tone === "professional"
    ? `You are Raphael, a professional AI assistant. Address the user as "${address}". Be direct and efficient.`
    : `You are Raphael, a warm and helpful AI assistant. Address the user as "${address}".`;

  const verbLine = verbosity === "terse"
    ? "Keep responses short and direct. No preamble. No trailing summaries."
    : verbosity === "verbose"
    ? "Be thorough and detailed in your responses."
    : "Balance brevity with completeness.";

  const extendedProfile = profileContext
    ? `\n\nUser Profile Context:\n${profileContext}\n`
    : "";

  if (tier === "fast") {
    return `${toneLine} ${verbLine} You are handling a quick query — be snappy.${extendedProfile}`;
  }

  return `${toneLine}\n\n${verbLine}\n\nWhen presenting results from tools, synthesize them naturally — don't just dump raw data.${extendedProfile}`;
}
