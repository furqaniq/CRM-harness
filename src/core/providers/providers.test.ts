import { describe, expect, it } from "vitest";
import { buildAnthropicRequest, toAnthropicMessages } from "./anthropic";
import { buildOpenAIRequest, openAIChatUrl, toOpenAIMessages } from "./openai";
import { ProviderError, createAnthropicProvider, createOpenAIProvider } from "./providers";
import { createMockProvider } from "./mock";
import { createProvider } from "./registry";
import { anthropicEvents, openaiEvents, readSse } from "./streams";
import type { ChatRequest, ProviderEvent, ProviderRuntime } from "./types";
import {
  EMPTY_CONNECTION,
  costUsd,
  fallbackChain,
  formatUsd,
  modelForRole,
} from "../models/config";

const REQUEST: ChatRequest = {
  model: "test-model",
  system: "You are Maple Assistant.",
  messages: [
    { role: "user", content: "Follow-ups due this week?" },
    {
      role: "assistant",
      content: "Checking.",
      toolCalls: [{ id: "call_1", name: "list_tasks", arguments: '{"due":"week"}' }],
    },
    { role: "tool", toolCallId: "call_1", name: "list_tasks", content: '{"count":4}' },
    { role: "user", content: "Thanks" },
  ],
  tools: [
    {
      name: "list_tasks",
      description: "List tasks",
      inputSchema: { type: "object", properties: { due: { type: "string" } } },
    },
  ],
  temperature: 0,
  maxTokens: 1024,
};

async function collect(iterable: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of iterable) out.push(event);
  return out;
}

function framesFrom(text: string) {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return readSse(stream);
}

const ANTHROPIC_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":40,"output_tokens":1}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"4 "}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"due."}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_9","name":"list_tasks"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"due\\""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":":\\"week\\"}"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","usage":{"input_tokens":40,"output_tokens":17}}}\n\n',
  "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
].join("");

const OPENAI_SSE = [
  'data: {"choices":[{"delta":{"content":"4 "}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"due."}}]}\n\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"list_tasks","arguments":"{\\"due\\""}}]}}]}\n\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"week\\"}"}}]}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":40,"completion_tokens":17}}\n\n',
  "data: [DONE]\n\n",
].join("");

describe("mock provider", () => {
  it("replays its script in order", async () => {
    const provider = createMockProvider({
      script: [
        { type: "text", text: "4 " },
        { type: "text", text: "due." },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
        { type: "done", stop: "end" },
      ],
    });

    const events = await collect(provider.stream(REQUEST));

    expect(events).toEqual([
      { type: "text_delta", text: "4 " },
      { type: "text_delta", text: "due." },
      { type: "usage", inputTokens: 10, outputTokens: 5 },
      { type: "done", stop: "end" },
    ]);
  });

  it("reports a tool call and stops with tool_calls", async () => {
    const provider = createMockProvider({
      script: [
        { type: "tool_call", toolCall: { id: "c1", name: "list_tasks", arguments: "{}" } },
        { type: "done", stop: "tool_calls" },
      ],
    });

    const events = await collect(provider.stream(REQUEST));
    expect(events).toEqual([
      { type: "tool_call", call: { id: "c1", name: "list_tasks", arguments: "{}" } },
      { type: "done", stop: "tool_calls" },
    ]);
  });

  it("stops with cancelled when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createMockProvider({
      script: [{ type: "text", text: "never" }],
    });

    const events = await collect(provider.stream(REQUEST, controller.signal));
    expect(events).toEqual([{ type: "done", stop: "cancelled" }]);
  });
});

describe("anthropic request", () => {
  it("converts neutral messages into merged content blocks", () => {
    const messages = toAnthropicMessages(REQUEST.messages);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Follow-ups due this week?" }],
    });
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toEqual([
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "call_1", name: "list_tasks", input: { due: "week" } },
    ]);
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_1", content: '{"count":4}' },
        { type: "text", text: "Thanks" },
      ],
    });
  });

  it("builds a streaming request with system, tools and limits", () => {
    const body = buildAnthropicRequest(REQUEST);

    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0);
    expect(body.system).toBe("You are Maple Assistant.");
    expect(body.tools?.[0]?.name).toBe("list_tasks");
    expect(body.tools?.[0]?.input_schema).toEqual({
      type: "object",
      properties: { due: { type: "string" } },
    });
    expect(body.messages).toHaveLength(3);
  });

  it("parses the stream into text, one assembled tool call, usage and stop", async () => {
    const events = await collect(anthropicEvents(framesFrom(ANTHROPIC_SSE)));

    expect(events).toEqual([
      { type: "usage", inputTokens: 40, outputTokens: 1 },
      { type: "text_delta", text: "4 " },
      { type: "text_delta", text: "due." },
      { type: "tool_call", call: { id: "call_9", name: "list_tasks", arguments: '{"due":"week"}' } },
      { type: "usage", inputTokens: 40, outputTokens: 17 },
      { type: "done", stop: "tool_calls" },
    ]);
  });
});

describe("openai request", () => {
  it("converts neutral messages into chat.completions roles", () => {
    const messages = toOpenAIMessages(REQUEST);

    expect(messages[0]).toEqual({ role: "system", content: "You are Maple Assistant." });
    expect(messages[1]).toEqual({ role: "user", content: "Follow-ups due this week?" });
    expect(messages[2]?.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "list_tasks", arguments: '{"due":"week"}' } },
    ]);
    expect(messages[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: '{"count":4}',
    });
  });

  it("builds a streaming request with usage and tools", () => {
    const body = buildOpenAIRequest(REQUEST);

    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.max_tokens).toBe(1024);
    expect(body.tools?.[0]?.function.name).toBe("list_tasks");
    expect(body.tools?.[0]?.function.parameters).toEqual({
      type: "object",
      properties: { due: { type: "string" } },
    });
  });

  it("appends /chat/completions to the base URL exactly once", () => {
    expect(openAIChatUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(openAIChatUrl("https://local:8080/v1/")).toBe(
      "https://local:8080/v1/chat/completions",
    );
    expect(openAIChatUrl("https://local:8080/v1/chat/completions")).toBe(
      "https://local:8080/v1/chat/completions",
    );
  });

  it("parses the stream into text, one assembled tool call, usage and stop", async () => {
    const events = await collect(openaiEvents(framesFrom(OPENAI_SSE)));

    expect(events).toEqual([
      { type: "text_delta", text: "4 " },
      { type: "text_delta", text: "due." },
      { type: "tool_call", call: { id: "call_1", name: "list_tasks", arguments: '{"due":"week"}' } },
      { type: "usage", inputTokens: 40, outputTokens: 17 },
      { type: "done", stop: "tool_calls" },
    ]);
  });
});

describe("provider transport", () => {
  it("posts to the Anthropic endpoint with the right headers and body", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const runtime: ProviderRuntime = {
      apiKey: "sk-ant-test",
      fetch: async (url, init) => {
        seen.url = url;
        seen.init = init;
        return new Response(ANTHROPIC_SSE, { status: 200 });
      },
    };

    await collect(createAnthropicProvider("claude-test", runtime).stream(REQUEST));

    expect(seen.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(seen.init?.body)) as { model: string; stream: boolean };
    expect(body.model).toBe("claude-test");
    expect(body.stream).toBe(true);
  });

  it("posts to an OpenAI-compatible endpoint with bearer auth", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const runtime: ProviderRuntime = {
      apiKey: "local-key",
      fetch: async (url, init) => {
        seen.url = url;
        seen.init = init;
        return new Response(OPENAI_SSE, { status: 200 });
      },
    };

    await collect(
      createOpenAIProvider("qwen3", "http://localhost:11434/v1", runtime).stream(REQUEST),
    );

    expect(seen.url).toBe("http://localhost:11434/v1/chat/completions");
    const headers = seen.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer local-key");
  });

  it("surfaces a failed provider response as a typed error with status", async () => {
    const runtime: ProviderRuntime = {
      apiKey: "bad",
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
        }),
    };

    const provider = createAnthropicProvider("claude-test", runtime);
    await expect(collect(provider.stream(REQUEST))).rejects.toMatchObject({
      name: "ProviderError",
      status: 401,
      message: "invalid api key",
    });
    expect(new ProviderError("x", 500).status).toBe(500);
  });
});

describe("provider registry", () => {
  it("builds each configured kind", () => {
    const base = {
      label: "test",
      model: "m",
      capabilities: { tools: true, streaming: true, vision: false },
      pricing: { inputPerMTok: 1, outputPerMTok: 2 },
    } as const;

    const runtime: ProviderRuntime = { fetch: async () => new Response("", { status: 200 }) };

    expect(createProvider({ ...base, id: "a", kind: "mock" }, runtime).kind).toBe("mock");
    expect(createProvider({ ...base, id: "b", kind: "anthropic" }, runtime).kind).toBe("anthropic");
    expect(createProvider({ ...base, id: "c", kind: "openai" }, runtime).kind).toBe("openai");
    expect(
      createProvider({ ...base, id: "d", kind: "openai-compatible", baseUrl: "http://x/v1" }, runtime).kind,
    ).toBe("openai");
    expect(createProvider({ ...base, id: "e", kind: "gemini" }, runtime).kind).toBe("openai");
  });

  it("refuses an openai-compatible provider without a base URL", () => {
    const runtime: ProviderRuntime = { fetch: async () => new Response("", { status: 200 }) };
    expect(() =>
      createProvider(
        {
          id: "x",
          kind: "openai-compatible",
          label: "local",
          model: "m",
          capabilities: { tools: true, streaming: true, vision: false },
          pricing: { inputPerMTok: 0, outputPerMTok: 0 },
        },
        runtime,
      ),
    ).toThrow(/base URL/);
  });
});

describe("model and role configuration", () => {
  it("resolves the orchestrator model from the connection", () => {
    expect(modelForRole(EMPTY_CONNECTION, "orchestrator")?.id).toBe("mock");
    expect(modelForRole(EMPTY_CONNECTION, "judge")).toBeUndefined();
  });

  it("walks a fallback chain without repeating models", () => {
    const chain = fallbackChain(
      {
        models: [EMPTY_CONNECTION.models[0]!, { ...EMPTY_CONNECTION.models[0]!, id: "b", label: "B" }],
        roles: {},
        fallbacks: [["mock", "b"]],
      },
      "mock",
    );
    expect(chain.map((model) => model.id)).toEqual(["mock", "b"]);
    expect(fallbackChain(EMPTY_CONNECTION, "unknown")).toEqual([]);
  });

  it("prices a run from per-million rates", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000 };
    expect(costUsd(EMPTY_CONNECTION.models[0]!, usage)).toBe(0);
    expect(
      costUsd(
        { ...EMPTY_CONNECTION.models[0]!, pricing: { inputPerMTok: 3, outputPerMTok: 15 } },
        usage,
      ),
    ).toBe(10.5);
    expect(formatUsd(10.5)).toBe("$10.50");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0004)).toBe("$0.0004");
  });
});
