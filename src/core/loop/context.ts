import type { ChatRequest, Message, ToolDefinition } from "../providers/types";

export interface AssembleOptions {
  model: string;
  system?: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Trim oldest turns when the conversation estimate exceeds this budget. */
  maxContextTokens?: number;
}

/** Rough token estimate (~4 characters per token). Enough for budgets and the meter. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function messageText(message: Message): string {
  switch (message.role) {
    case "user":
      return message.content;
    case "assistant": {
      const calls = (message.toolCalls ?? [])
        .map((call) => `${call.name}(${call.arguments})`)
        .join(" ");
      return calls ? `${message.content} ${calls}` : message.content;
    }
    case "tool":
      return `${message.name} ${message.content}`;
  }
}

export function estimateMessageTokens(message: Message): number {
  // +4 per message covers role and framing overhead.
  return estimateTokens(messageText(message)) + 4;
}

export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

/**
 * Turns are grouped so a trimmed transcript never starts with a tool result
 * whose assistant call was removed, and never leaves an unanswered tool call.
 * The newest turn is always kept.
 */
export function trimMessages(messages: Message[], maxTokens: number): {
  messages: Message[];
  dropped: number;
  estimatedTokens: number;
} {
  const groups: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= messages.length; i += 1) {
    const atTurnStart = i < messages.length && messages[i].role === "user";
    if (atTurnStart) {
      groups.push([start, i]);
      start = i;
    }
  }
  if (start < messages.length) groups.push([start, messages.length]);

  let kept = groups;
  let dropped = 0;
  while (kept.length > 1 && estimateConversationTokens(sliceMessages(messages, kept)) > maxTokens) {
    dropped += kept[0][1] - kept[0][0];
    kept = kept.slice(1);
  }

  const result = sliceMessages(messages, kept);
  return {
    messages: result,
    dropped,
    estimatedTokens: estimateConversationTokens(result),
  };
}

function sliceMessages(messages: Message[], groups: [number, number][]): Message[] {
  return groups.flatMap(([from, to]) => messages.slice(from, to));
}

/** Context assembly for one model call: system, messages, tools, budgets. */
export function assembleRequest(options: AssembleOptions): ChatRequest {
  const trimmed =
    options.maxContextTokens === undefined
      ? options.messages
      : trimMessages(options.messages, options.maxContextTokens).messages;

  return {
    model: options.model,
    ...(options.system ? { system: options.system } : {}),
    messages: trimmed,
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
  };
}
