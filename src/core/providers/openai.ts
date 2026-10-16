import type { ChatRequest, ToolDefinition } from "./types";

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: true;
  stream_options: { include_usage: true };
  tools?: OpenAITool[];
  temperature?: number;
  max_tokens?: number;
}

export function toOpenAIMessages(request: ChatRequest): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }

  for (const message of request.messages) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      });
      continue;
    }

    if (message.role === "user") {
      messages.push({ role: "user", content: message.content });
      continue;
    }

    const next: OpenAIMessage = { role: "assistant", content: message.content };
    const calls = message.toolCalls ?? [];
    if (calls.length > 0) {
      next.tool_calls = calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    messages.push(next);
  }

  return messages;
}

export function toOpenAITools(tools: ToolDefinition[] | undefined): OpenAITool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }));
}

export function buildOpenAIRequest(request: ChatRequest): OpenAIRequest {
  const body: OpenAIRequest = {
    model: request.model,
    messages: toOpenAIMessages(request),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  const tools = toOpenAITools(request.tools);
  if (tools) body.tools = tools;
  return body;
}

export function openAIChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}
