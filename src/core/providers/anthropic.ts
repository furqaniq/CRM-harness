import type { ChatRequest, Message, ToolDefinition } from "./types";

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  stream: true;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  temperature?: number;
}

export type AnthropicMessage =
  | { role: "user" | "assistant"; content: AnthropicBlock[] }
  | { role: "user"; content: string };

export type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      const block: AnthropicBlock = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      };
      pushBlock(out, "user", block);
      continue;
    }

    if (message.role === "user") {
      pushBlock(out, "user", { type: "text", text: message.content });
      continue;
    }

    const blocks: AnthropicBlock[] = [];
    if (message.content.length > 0) {
      blocks.push({ type: "text", text: message.content });
    }
    for (const call of message.toolCalls ?? []) {
      blocks.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: safeParse(call.arguments),
      });
    }
    if (blocks.length === 0) blocks.push({ type: "text", text: "" });
    pushBlocks(out, "assistant", blocks);
  }

  return out;
}

function pushBlock(
  out: AnthropicMessage[],
  role: "user" | "assistant",
  block: AnthropicBlock,
): void {
  pushBlocks(out, role, [block]);
}

function pushBlocks(
  out: AnthropicMessage[],
  role: "user" | "assistant",
  blocks: AnthropicBlock[],
): void {
  const last = out.at(-1);
  if (last && last.role === role && Array.isArray(last.content)) {
    last.content.push(...blocks);
    return;
  }
  out.push({ role, content: [...blocks] });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function toAnthropicTools(tools: ToolDefinition[] | undefined): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Record<string, unknown>,
  }));
}

export function buildAnthropicRequest(request: ChatRequest): AnthropicRequest {
  const body: AnthropicRequest = {
    model: request.model,
    max_tokens: request.maxTokens ?? 4096,
    stream: true,
    messages: toAnthropicMessages(request.messages),
  };
  if (request.system) body.system = request.system;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  const tools = toAnthropicTools(request.tools);
  if (tools) body.tools = tools;
  return body;
}

export interface AnthropicStreamMessage {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  content_block?: { type?: string; id?: string; name?: string };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  error?: { type?: string; message?: string };
}
