import { RaphaelConfig } from "../config/types";

export function requiresApprovalCheck(tool: string, config: RaphaelConfig): boolean {
  return config.tools[tool]?.requiresApproval ?? false;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

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
  };
  memory: {
    query: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
};

export async function dispatch(
  tool: string,
  params: Record<string, unknown>,
  services: ServiceMap,
): Promise<ToolResult> {
  const [service, method] = tool.split(".") as [keyof ServiceMap, string];
  
  if (!service || !method) {
    return { success: false, error: `Invalid tool format: ${tool}` };
  }
  
  const serviceObj = services[service];
  if (!serviceObj) {
    return { success: false, error: `Unknown service: ${service}` };
  }
  
  const methodFn = serviceObj[method as keyof typeof serviceObj];
  if (typeof methodFn !== "function") {
    return { success: false, error: `Unknown method: ${method}` };
  }
  
  try {
    return await methodFn(params);
  } catch (err) {
    return { success: false, error: String(err) };
  }
}