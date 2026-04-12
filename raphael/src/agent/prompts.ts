import { PersonaConfig } from "../config/types";

export const MODELS = {
  orchestrator: "qwen/qwen3-32b",
  fast:         "meta-llama/llama-3.1-8b-instant",
  powerful:     "meta-llama/llama-3.3-70b-versatile",
} as const;

export type ModelTier = keyof typeof MODELS;

export function buildSystemPrompt(tier: ModelTier, persona: PersonaConfig): string {
  const { address, tone, verbosity } = persona;

  if (tier === "orchestrator") {
    return `You are Raphael's orchestration layer. Analyze the user's message and respond with ONLY valid JSON.

Available tools: gmail.listEmails, gmail.readEmail, gmail.draftEmail, gmail.sendEmail,
calendar.listEvents, calendar.createEvent, calendar.checkAvailability,
x.getTimeline, x.getMentions, x.searchTweets,
files.searchFiles, files.readFile, memory.query.

Response format:
{
  "model": "fast" | "powerful",
  "tool": "<tool_name>" | null,
  "params": { ...tool params } | null,
  "intent": "<brief description>"
}

Use "fast" for greetings, simple questions, status checks.
Use "powerful" for drafting emails, complex reasoning, multi-step tasks.
If no tool is needed, set tool and params to null.`;
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

  if (tier === "fast") {
    return `${toneLine} ${verbLine} You are handling a quick query — be snappy.`;
  }

  return `${toneLine}\n\n${verbLine}\n\nWhen presenting results from tools, synthesize them naturally — don't just dump raw data.`;
}