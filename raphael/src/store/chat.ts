import { useReducer } from "react";

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
}

export interface ToolCardState {
  id: string;
  tool: string;
  status: "running" | "done" | "error";
  result?: string;
}

export interface EmailDraftState {
  id: string;
  to: string;
  subject: string;
  body: string;
}

export type ChatItem =
  | { type: "message"; data: ChatMessage }
  | { type: "tool"; data: ToolCardState }
  | { type: "email"; data: EmailDraftState };

interface ChatState {
  items: ChatItem[];
}

type ChatAction =
  | { type: "ADD_MESSAGE"; msg: ChatMessage }
  | { type: "APPEND_STREAM"; id: string; chunk: string }
  | { type: "FINISH_STREAM"; id: string }
  | { type: "ADD_TOOL"; card: ToolCardState }
  | { type: "UPDATE_TOOL"; id: string; status: ToolCardState["status"]; result?: string }
  | { type: "ADD_EMAIL"; draft: EmailDraftState }
  | { type: "UPDATE_EMAIL"; id: string; patch: Partial<EmailDraftState> }
  | { type: "REMOVE"; id: string };

const ADD_MESSAGE = "ADD_MESSAGE";
const APPEND_STREAM = "APPEND_STREAM";
const FINISH_STREAM = "FINISH_STREAM";
const ADD_TOOL = "ADD_TOOL";
const UPDATE_TOOL = "UPDATE_TOOL";
const ADD_EMAIL = "ADD_EMAIL";
const UPDATE_EMAIL = "UPDATE_EMAIL";
const REMOVE = "REMOVE";

function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case ADD_MESSAGE:
      return { items: [...state.items, { type: "message", data: action.msg }] };
    case APPEND_STREAM:
      return {
        items: state.items.map((item) =>
          item.type === "message" && item.data.id === action.id
            ? { ...item, data: { ...item.data, content: item.data.content + action.chunk } }
            : item
        ),
      };
    case FINISH_STREAM:
      return {
        items: state.items.map((item) =>
          item.type === "message" && item.data.id === action.id
            ? { ...item, data: { ...item.data, streaming: false } }
            : item
        ),
      };
    case ADD_TOOL:
      return { items: [...state.items, { type: "tool", data: action.card }] };
    case UPDATE_TOOL:
      return {
        items: state.items.map((item) =>
          item.type === "tool" && item.data.id === action.id
            ? { ...item, data: { ...item.data, status: action.status, result: action.result } }
            : item
        ),
      };
    case ADD_EMAIL:
      return { items: [...state.items, { type: "email", data: action.draft }] };
    case UPDATE_EMAIL:
      return {
        items: state.items.map((item) =>
          item.type === "email" && item.data.id === action.id
            ? { ...item, data: { ...item.data, ...action.patch } }
            : item
        ),
      };
    case REMOVE:
      return { items: state.items.filter((i) => i.data.id !== action.id) };
    default:
      return state;
  }
}

export function useChatStore() {
  const [state, dispatch] = useReducer(reducer, { items: [] });
  return { state, dispatch };
}

export {
  ADD_MESSAGE,
  APPEND_STREAM,
  FINISH_STREAM,
  ADD_TOOL,
  UPDATE_TOOL,
  ADD_EMAIL,
  UPDATE_EMAIL,
  REMOVE,
};