import { PersonaConfig, BuiltInProvider } from "../config/types";
import SOUL from "./bootstrap/SOUL.md?raw";
import AGENTS from "./bootstrap/AGENTS.md?raw";
import IDENTITY from "./bootstrap/IDENTITY.md?raw";
import TOOLS_GUIDE from "./bootstrap/TOOLS.md?raw";

export const GROQ_MODELS = {
  orchestrator: "openai/gpt-oss-120b",
  fast: "llama-3.1-8b-instant",
  powerful: "llama-3.3-70b-versatile",
} as const;

export const GEMINI_MODELS = {
  orchestrator: "gemini-2.0-flash",
  fast: "gemini-2.0-flash-lite",
  powerful: "gemini-2.0-pro",
} as const;

export const CEREBRAS_MODELS = {
  orchestrator: "llama-3.1-8b",
  fast: "llama-3.1-8b",
  powerful: "llama-3.3-70b",
} as const;

export const OPENAI_MODELS = {
  orchestrator: "gpt-4o-mini",
  fast: "gpt-4o-mini",
  powerful: "gpt-4o",
} as const;

export const ANTHROPIC_MODELS = {
  orchestrator: "claude-haiku-4-5-20251001",
  fast: "claude-haiku-4-5-20251001",
  powerful: "claude-sonnet-4-6",
} as const;

export const OPENROUTER_MODELS = {
  orchestrator: "anthropic/claude-haiku-4-5",
  fast: "anthropic/claude-haiku-4-5",
  powerful: "anthropic/claude-sonnet-4-5",
} as const;

export const NVIDIA_MODELS = {
  orchestrator: "nvidia/llama-3.1-nemotron-70b-instruct",
  fast: "nvidia/llama-3.1-nemotron-70b-instruct",
  powerful: "nvidia/llama-3.1-nemotron-70b-instruct",
} as const;

export const GROQ_COMPOUND_MODELS = {
  full: "groq/compound",
  mini: "groq/compound-mini",
} as const;

// browser_automation is intentionally NOT enabled by default. It can spawn up
// to 10 browsers in parallel and frequently leaves the run with no final text
// content streamed back to the client. Keep this list focused on tools whose
// output cleanly returns to the model for synthesis.
export const DEFAULT_COMPOUND_TOOLS = [
  "web_search",
  "visit_website",
];

export type ModelTier = keyof typeof GROQ_MODELS;

// Some Groq models require "openai/" prefix, others don't
// This map indicates which models need the prefix
export const GROQ_MODELS_WITH_PREFIX = new Set([
  "openai/gpt-oss-120b",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/gpt-4-turbo",
]);

export function getGroqModelId(model: string): string {
  // Compound systems and other already-prefixed ids pass through unchanged
  if (model.startsWith("openai/") || model.startsWith("groq/")) return model;
  // If it's a known model that needs prefix, add it
  if (GROQ_MODELS_WITH_PREFIX.has(`openai/${model}`)) {
    return `openai/${model}`;
  }
  // Otherwise use as-is (e.g., "llama-3.1-8b-instant")
  return model;
}

type ModelConfig = Record<ModelTier, string>;

const PROVIDER_MODELS: Record<BuiltInProvider, ModelConfig> = {
  groq: GROQ_MODELS as ModelConfig,
  cerebras: CEREBRAS_MODELS as ModelConfig,
  gemini: GEMINI_MODELS as ModelConfig,
  openai: OPENAI_MODELS as ModelConfig,
  anthropic: ANTHROPIC_MODELS as ModelConfig,
  openrouter: OPENROUTER_MODELS as ModelConfig,
  nvidia: NVIDIA_MODELS as ModelConfig,
};

export function getModelForTier(tier: ModelTier, provider: BuiltInProvider | string): string {
  if (provider === "cerebras") return CEREBRAS_MODELS[tier];
  if (provider === "gemini") return GEMINI_MODELS[tier];
  if (provider === "groq") return GROQ_MODELS[tier];
  if (provider === "openai") return OPENAI_MODELS[tier];
  if (provider === "anthropic") return ANTHROPIC_MODELS[tier];
  if (provider === "openrouter") return OPENROUTER_MODELS[tier];
  if (provider === "nvidia") return NVIDIA_MODELS[tier];
  return "";
}

export function getProviderModels(provider: BuiltInProvider): ModelConfig {
  return PROVIDER_MODELS[provider] || GROQ_MODELS;
}

export function getAllModelsForProvider(provider: BuiltInProvider): string[] {
  const models = getProviderModels(provider);
  return [...new Set(Object.values(models))];
}

export const PROVIDER_MODEL_OPTIONS: Record<BuiltInProvider, string[]> = {
  groq: [
    "groq/compound",
    "groq/compound-mini",
    "openai/gpt-oss-120b",
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "llama-3.2-90b-vision-instruct",
    "mixtral-8x7b-32768",
    "llama-3.2-1b-instruct",
    "llama-3.2-8b-instruct",
  ],
  cerebras: ["llama-3.1-8b", "llama-3.3-70b", "llama-3.2-90b"],
  gemini: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-pro", "gemini-1.5-pro", "gemini-1.5-flash"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
  openrouter: [
    "anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-4-5",
    "openai/gpt-4o", "openai/gpt-4o-mini",
    "meta-llama/llama-3.1-70b-instruct", "meta-llama/llama-3.1-8b-instruct",
    "google/gemini-pro-1.5", "mistralai/mixtral-8x7b-instruct"
  ],
  nvidia: ["nvidia/llama-3.1-nemotron-70b-instruct", "nvidia/llama-3.1-nemotron-80b-instruct", "deepseek-ai/deepseek-r1"],
};

export const PROVIDER_LABELS: Record<BuiltInProvider, string> = {
  groq: "Groq",
  cerebras: "Cerebras",
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  openrouter: "OpenRouter",
  nvidia: "NVIDIA NIM",
};

export const MODELS = GROQ_MODELS;

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
    const tools =
      toolList && toolList.trim().length > 0
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
- Multi-step intent: when user asks to search THEN email, first call search.query, then on re-orchestration call gmail.draftEmail with the results synthesized into the body

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

User: "my name is Alex and I prefer dark mode"
{"model":"fast","tool":"memory.saveProfile","params":{"info":"User name is Alex, prefers dark mode"},"intent":"Saving user preference to profile"}

User: "remember I'm a Python developer"
{"model":"fast","tool":"memory.saveProfile","params":{"info":"User is a Python developer"},"intent":"Saving user skill/preference to profile"}

User: "explain how async/await works in JavaScript"
{"model":"powerful","tool":null,"params":null,"intent":"Technical explanation, no tool needed"}

User: "search for claude api pricing, then compose an email to user@example.com about it"
{"model":"powerful","tool":"search.query","params":{"query":"Claude API pricing 2025"},"intent":"Searching for Claude API pricing before composing email"}

Previous tool result: [search results about Claude API pricing...]
{"model":"powerful","tool":"gmail.draftEmail","params":{"to":"user@example.com","subject":"Claude API Pricing","body":"Here's what I found about Claude API pricing:\n\n[synthesized results]"},"intent":"Composing email with search results"}

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

  const toneLine =
    tone === "jarvis"
      ? `Address the user as "${address}". Dry-witted, supremely competent. Slight sarcasm welcome; hedging is not. Get to the point.`
      : tone === "professional"
        ? `Address the user as "${address}". Direct and efficient.`
        : `Address the user as "${address}". Warm but not verbose.`;

  const verbLine =
    verbosity === "terse"
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

  if (tier === "fast") {
    return `You are Raphael — a personal AI agent. ${toneLine} ${verbLine}${toolResultGuidance}${extendedProfile}`;
  }
  // powerful gets full identity
  return `${identityBlock}

${toneLine}

${verbLine}
${toolResultGuidance}${extendedProfile}`;
}
