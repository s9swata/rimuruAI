import { RaphaelConfig } from "../config/types";
import { ToolResult } from "./types";
import { ToolRegistry } from "./registry";

// Resource system types
export interface ResourceField {
  name: string;
  field_type: string; // "string" | "number" | "boolean"
  required: boolean;
  searchable: boolean;
}
export interface ResourceToolDef {
  name: string;
  description: string;
  op: string; // "find" | "upsert" | "list" | "delete"
}
export interface ResourceManifest {
  resource_type: string;
  description: string;
  fields: ResourceField[];
  tools: ResourceToolDef[];
}

export type { ToolResult };

export function requiresApprovalCheck(tool: string, config: RaphaelConfig): boolean {
  return config.tools[tool]?.requiresApproval ?? false;
}

/**
 * ServiceMap — kept for backward compatibility with createServices() return type.
 * initRegistry() accepts this type to register builtin implementations.
 */
export type ServiceMap = {
  gmail: {
    listEmails: (params: Record<string, unknown>) => Promise<ToolResult>;
    readEmail: (params: Record<string, unknown>) => Promise<ToolResult>;
    draftEmail: (params: Record<string, unknown>) => Promise<ToolResult>;
    sendEmail: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  calendar: {
    listEvents: (params: Record<string, unknown>) => Promise<ToolResult>;
    createEvent: (params: Record<string, unknown>) => Promise<ToolResult>;
    checkAvailability: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  x: {
    getTimeline: (params: Record<string, unknown>) => Promise<ToolResult>;
    getMentions: (params: Record<string, unknown>) => Promise<ToolResult>;
    searchTweets: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  files: {
    searchFiles: (params: Record<string, unknown>) => Promise<ToolResult>;
    readFile: (params: Record<string, unknown>) => Promise<ToolResult>;
    analyzeDocument: (params: Record<string, unknown>) => Promise<ToolResult>;
    embedText: (params: Record<string, unknown>) => Promise<ToolResult>;
    queryDocument: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  memory: {
    query: (params: Record<string, unknown>) => Promise<ToolResult>;
    saveProfile: (params: Record<string, unknown>) => Promise<ToolResult>;
    store: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  search: {
    query: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  http: {
    fetch: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  resources: {
    define: (manifest: ResourceManifest) => Promise<ResourceManifest>;
    listManifests: () => Promise<ResourceManifest[]>;
    upsert: (resource_type: string, item: Record<string, unknown>) => Promise<Record<string, unknown>>;
    find: (resource_type: string, query: string) => Promise<Record<string, unknown>[]>;
    list: (resource_type: string) => Promise<Record<string, unknown>[]>;
    delete: (resource_type: string, id: string) => Promise<boolean>;
  };
};

/**
 * Execute a tool by name using the registry.
 * This replaces the old ServiceMap-based dispatch.
 */
export async function dispatch(
  tool: string,
  params: Record<string, unknown>,
  registry: ToolRegistry,
): Promise<ToolResult> {
  return registry.execute(tool, params);
}
