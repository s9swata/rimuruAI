import { ServiceMap } from "../agent/dispatcher";

export async function createServices(): Promise<ServiceMap> {
  return {
    gmail: { listEmails: async () => ({ success: true, data: [] }), readEmail: async () => ({ success: true, data: {} }), draftEmail: async (p) => ({ success: true, data: p }), sendEmail: async () => ({ success: true, data: {} }) },
    calendar: { listEvents: async () => ({ success: true, data: [] }), createEvent: async () => ({ success: true, data: {} }), checkAvailability: async () => ({ success: true, data: [] }) },
    x: { getTimeline: async () => ({ success: true, data: [] }), getMentions: async () => ({ success: true, data: [] }), searchTweets: async () => ({ success: true, data: [] }) },
    files: { searchFiles: async () => ({ success: true, data: [] }), readFile: async () => ({ success: true, data: { path: "", content: "" } }) },
    memory: { query: async () => ({ success: true, data: {} }) },
  };
}