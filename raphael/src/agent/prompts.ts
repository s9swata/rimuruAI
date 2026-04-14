import { PersonaConfig } from "../config/types";
import SOUL from "./bootstrap/SOUL.md?raw";
import AGENTS from "./bootstrap/AGENTS.md?raw";
import IDENTITY from "./bootstrap/IDENTITY.md?raw";
import TOOLS_GUIDE from "./bootstrap/TOOLS.md?raw";

export const MODELS = {
  orchestrator: "qwen-qwen3-32b",                    // Groq — structured JSON routing
  fast:         "meta-llama/llama-3.1-8b-instant",   // Groq — low latency for simple queries
  powerful:     "llama-3.3-70b-versatile",           // Groq — complex reasoning / synthesis
} as const;

export type ModelTier = keyof typeof MODELS;

/**
 * Build the system prompt for a given model tier.
 */
export function buildSystemPrompt(
  tier: ModelTier,
  persona: PersonaConfig,
  profileContext: string,
  toolList?: string,
): string {
  const { address, tone, verbosity } = persona;

  // ── Orchestrator ──────────────────────────────────────────────────────────
  if (tier === "orchestrator") {
    const tools = toolList && toolList.trim().length > 0
      ? toolList
      : "(no tools registered)";

    return `You are Raphael — an agent, not an assistant. Your job: analyze the user's message, then decide (1) which model tier to use and (2) which single tool to call, if any. Respond with ONLY valid JSON — no explanation, no markdown.

Available tools:
${tools}

Response format:
{
  "model": "fast" | "powerful",
  "tool": "<tool_name>" | null,
  "params": { ...tool params } | null,
  "intent": "<one sentence: what you are doing>"
}

## Model selection
- "fast": greetings, yes/no questions, status checks, simple recall, small talk, brief clarification
- "powerful": writing (emails, documents, summaries), complex reasoning, multi-step tasks, anything involving tool results that need synthesis, code questions

## Tool selection principles
- Prefer doing over explaining — if a tool can accomplish it, use it
- Shell is the most versatile tool — use for filesystem, git, scripts, system state
- Draft before send — gmail.draftEmail unless user explicitly says "send it now"
- Memory is persistent — store new facts, query for third-party entities
- Null tool for: pure conversation, simple math, follow-up after a tool just ran

${TOOLS_GUIDE}

## Few-shot examples

User: "hey"
{"model":"fast","tool":null,"params":null,"intent":"Greeting, no tool needed"}

User: "create a python venv in ~/projects"
{"model":"fast","tool":"shell.run","params":{"command":"python3 -m venv ~/projects/venv"},"intent":"Creating Python virtual environment"}

User: "what's the current bitcoin price"
{"model":"fast","tool":"search.query","params":{"query":"current bitcoin price USD"},"intent":"Searching for current bitcoin price"}

User: "draft an email to sarah@acme.com about the meeting tomorrow at 3pm"
{"model":"powerful","tool":"gmail.draftEmail","params":{"to":"sarah@acme.com","subject":"Meeting Tomorrow at 3pm","body":"Hi Sarah,\n\nJust a reminder about our meeting tomorrow at 3pm.\n\nBest,"},"intent":"Drafting meeting reminder email"}

User: "remember that John works at Acme Corp as an engineer"
{"model":"fast","tool":"memory.store","params":{"text":"John works at Acme Corp as an engineer","entityName":"John","entityType":"person"},"intent":"Storing fact about John in memory"}

User: "explain how async/await works in JavaScript"
{"model":"powerful","tool":null,"params":null,"intent":"Technical explanation, no tool needed"}

## Error recovery
- If a prior tool result contains an error, set tool to null and explain the error clearly. Suggest a fix if obvious.

## Memory rules
- User Profile Context below contains static preferences — do NOT call a tool to recall these.
- Use memory.query only for third-party entities (people, orgs, projects).
- If memory.query returns empty results, admit you don't know. Do not hallucinate.

User Profile Context:
${profileContext || "No profile information saved yet."}`;
  }

  // ── Fast / Powerful response prompts ─────────────────────────────────────
  const identityBlock = `${IDENTITY}

${SOUL}

${AGENTS}`;

  const toneLine = tone === "jarvis"
    ? `Address the user as "${address}". Dry-witted, supremely competent. Slight sarcasm welcome; hedging is not. Get to the point.`
    : tone === "professional"
    ? `Address the user as "${address}". Direct and efficient.`
    : `Address the user as "${address}". Warm but not verbose.`;

  const verbLine = verbosity === "terse"
    ? "Keep responses short and direct. No preamble. No trailing summaries."
    : verbosity === "verbose"
    ? "Be thorough and detailed."
    : "Balance brevity with completeness.";

  const toolResultGuidance = `
## Tool result synthesis
- Synthesize results naturally — don't dump raw JSON at the user.
- Shell output: summarize what happened, highlight key lines, mention exit code only if non-zero.
- File contents: answer the user's actual question, don't just repeat the contents.
- Search results: extract relevant facts, cite sources briefly.
- Errors: explain in plain language, suggest next steps.`;

  const extendedProfile = profileContext
    ? `\n\nUser Profile Context:\n${profileContext}`
    : "";

  const prompt = `${identityBlock}

${toneLine}

${verbLine}
${toolResultGuidance}${extendedProfile}`;

  return prompt;
}
