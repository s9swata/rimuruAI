export interface ToolConfig {
  requiresApproval: boolean;
}

export type TrustLevel = "supervised" | "balanced" | "autonomous";

export interface PersonaConfig {
  address: string;
  tone: "jarvis" | "professional" | "friendly";
  verbosity: "terse" | "balanced" | "verbose";
}

export interface RaphaelConfig {
  persona: PersonaConfig;
  trustLevel: TrustLevel;
  tools: Record<string, ToolConfig>;
  watchedFolders: string[];
  hotkey: string;
}

export const DEFAULT_CONFIG: RaphaelConfig = {
  persona: { address: "sir", tone: "jarvis", verbosity: "terse" },
  trustLevel: "balanced",
  tools: {
    "gmail.sendEmail":              { requiresApproval: true },
    "gmail.draftEmail":             { requiresApproval: false },
    "calendar.createEvent":         { requiresApproval: true },
    "calendar.listEvents":          { requiresApproval: false },
    "calendar.checkAvailability":   { requiresApproval: false },
    "x.getTimeline":                { requiresApproval: false },
    "x.getMentions":                { requiresApproval: false },
    "x.searchTweets":               { requiresApproval: false },
    "files.searchFiles":            { requiresApproval: false },
    "files.readFile":               { requiresApproval: false },
    "memory.query":                 { requiresApproval: false },
    "search.query":                 { requiresApproval: false },
  },
  watchedFolders: [],
  hotkey: "Super+Shift+Space",
};

export function applyTrustLevel(config: RaphaelConfig, level: TrustLevel): RaphaelConfig {
  const sideEffecting = new Set([
    "gmail.sendEmail", "calendar.createEvent",
  ]);
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