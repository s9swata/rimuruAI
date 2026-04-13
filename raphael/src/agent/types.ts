/** The return value of every tool execution. */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** A function that implements a tool. */
export type ToolImpl = (params: Record<string, unknown>) => Promise<ToolResult>;

/** The two supported tool execution strategies. */
export type ToolType = "builtin" | "http";

/** One parameter in a tool's parameter schema. */
export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
}

/**
 * A tool definition — describes a tool as pure data.
 *
 * builtin: the executor calls the registered ToolImpl function.
 * http:    the executor calls `url` via fetch with params as JSON body.
 */
export interface ToolDefinition {
  name: string;                              // format: "service.method"
  description: string;
  parameters: Record<string, ToolParameter>;
  type: ToolType;
  url?: string;                              // http only
  method?: "GET" | "POST";                  // http only, default POST
  headers?: Record<string, string>;         // http only, optional extra headers
}
