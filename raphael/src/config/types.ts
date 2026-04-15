export interface ToolConfig {
  requiresApproval: boolean;
}

export type TrustLevel = "supervised" | "balanced" | "autonomous";

export type BuiltInProvider = "groq" | "gemini" | "openai" | "anthropic" | "openrouter" | "nvidia" | "cerebras";

export interface CustomProviderConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

export interface PersonaConfig {
  address: string;
  tone: "jarvis" | "professional" | "friendly";
  verbosity: "terse" | "balanced" | "verbose";
}

export interface ProviderPriorityConfig {
  provider: BuiltInProvider;
  priority: number;
  enabled: boolean;
}

export interface ProviderRateLimitConfig {
  maxTokensPerDay: number;
  warnThreshold: number;
}

export interface ModelSelection {
  provider: BuiltInProvider;
  model: string;
}

export interface RaphaelConfig {
  persona: PersonaConfig;
  trustLevel: TrustLevel;
  tools: Record<string, ToolConfig>;
  watchedFolders: string[];
  hotkey: string;
  mcpServers: McpServerConfig[];
  customProviders: CustomProviderConfig[];
  defaultProvider: BuiltInProvider | string;
  providerPriority: ProviderPriorityConfig[];
  rateLimitConfig: Record<BuiltInProvider, ProviderRateLimitConfig>;
  modelSelection: {
    orchestrator: ModelSelection;
    fast: ModelSelection;
    powerful: ModelSelection;
  };
}

export const DEFAULT_CONFIG: RaphaelConfig = {
  persona: { address: "sir", tone: "jarvis", verbosity: "terse" },
  trustLevel: "balanced",
  tools: {
    "gmail.sendEmail": { requiresApproval: true },
    "gmail.draftEmail": { requiresApproval: false },
    "calendar.createEvent": { requiresApproval: true },
    "calendar.listEvents": { requiresApproval: false },
    "calendar.checkAvailability": { requiresApproval: false },
    "x.getTimeline": { requiresApproval: false },
    "x.getMentions": { requiresApproval: false },
    "x.searchTweets": { requiresApproval: false },
    "files.searchFiles": { requiresApproval: false },
    "files.readFile": { requiresApproval: false },
    "memory.query": { requiresApproval: false },
    "search.query": { requiresApproval: true },
  },
  watchedFolders: [],
  hotkey: "Super+Shift+Space",
  mcpServers: [],
  customProviders: [],
  defaultProvider: "groq",
  providerPriority: [
    { provider: "groq", priority: 1, enabled: true },
    { provider: "cerebras", priority: 2, enabled: true },
    { provider: "openrouter", priority: 3, enabled: true },
    { provider: "anthropic", priority: 4, enabled: true },
    { provider: "openai", priority: 5, enabled: true },
    { provider: "gemini", priority: 6, enabled: true },
    { provider: "nvidia", priority: 7, enabled: false },
  ],
  rateLimitConfig: {
    groq: { maxTokensPerDay: 500_000, warnThreshold: 0.8 },
    cerebras: { maxTokensPerDay: 500_000, warnThreshold: 0.8 },
    openrouter: { maxTokensPerDay: 200_000, warnThreshold: 0.8 },
    anthropic: { maxTokensPerDay: 100_000, warnThreshold: 0.8 },
    openai: { maxTokensPerDay: 100_000, warnThreshold: 0.8 },
    gemini: { maxTokensPerDay: 150_000, warnThreshold: 0.8 },
    nvidia: { maxTokensPerDay: 100_000, warnThreshold: 0.8 },
  },
  modelSelection: {
    orchestrator: { provider: "groq", model: "openai/gpt-oss-120b" },
    fast: { provider: "groq", model: "llama-3.1-8b-instant" },
    powerful: { provider: "groq", model: "llama-3.3-70b-versatile" },
  },
};

export function applyTrustLevel(
  config: RaphaelConfig,
  level: TrustLevel,
): RaphaelConfig {
  const sideEffecting = new Set(["gmail.sendEmail", "calendar.createEvent"]);
  const tools = { ...config.tools };
  for (const key of Object.keys(tools)) {
    if (level === "supervised") {
      tools[key] = { requiresApproval: true };
    } else if (level === "autonomous") {
      tools[key] = { requiresApproval: false };
    } else {
      tools[key] = { requiresApproval: sideEffecting.has(key) };
    }
  }
  return { ...config, trustLevel: level, tools };
}
