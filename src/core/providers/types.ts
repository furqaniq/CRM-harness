export type ModelRole =
  | "orchestrator"
  | "worker"
  | "verifier"
  | "writer"
  | "judge";

export const MODEL_ROLES: ModelRole[] = [
  "orchestrator",
  "worker",
  "verifier",
  "writer",
  "judge",
];

export type ProviderKind = "anthropic" | "openai" | "openai-compatible" | "gemini" | "mock";

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text as produced by the model. Parsed by the loop, not the provider. */
  arguments: string;
}

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
      isError?: boolean;
    };

export interface ChatRequest {
  model: string;
  system?: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export type StopReason = "end" | "tool_calls" | "length" | "cancelled" | "error";

export type ProviderEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; stop: StopReason };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelPricing {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
}

export interface ModelCapabilities {
  tools: boolean;
  streaming: boolean;
  vision: boolean;
}

export interface ModelConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  model: string;
  baseUrl?: string;
  /** Name of the secret to read. The secret value never leaves the server. */
  apiKeyRef?: string;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
}

export interface ProviderConnection {
  models: ModelConfig[];
  /** Model config id per model role. */
  roles: Partial<Record<ModelRole, string>>;
  /** Ordered model config ids to try when a call fails. */
  fallbacks: string[][];
}

export interface ChatProvider {
  readonly kind: ProviderKind;
  readonly model: string;
  stream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ProviderEvent>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderRuntime {
  apiKey?: string;
  fetch: FetchLike;
}
