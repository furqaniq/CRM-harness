import type { ProviderEvent, StopReason, ToolCall } from "./types";
import type { AnthropicStreamMessage } from "./anthropic";

export interface SseFrame {
  event: string;
  data: string;
}

export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame(chunk);
        if (frame) yield frame;
        boundary = buffer.indexOf("\n\n");
      }
    }

    if (buffer.trim().length > 0) {
      const frame = parseFrame(buffer);
      if (frame) yield frame;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function stopFromAnthropic(reason: string | undefined): StopReason {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "end";
}

function stopFromOpenAI(reason: string | null | undefined): StopReason {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  return "end";
}

export async function* anthropicEvents(
  frames: AsyncIterable<SseFrame>,
): AsyncGenerator<ProviderEvent> {
  const toolParts = new Map<number, ToolCall>();
  const openBlocks = new Set<number>();
  let stop: StopReason = "end";
  let sawError = false;

  for await (const frame of frames) {
    if (frame.data === "[DONE]") break;
    let payload: AnthropicStreamMessage;
    try {
      payload = JSON.parse(frame.data) as AnthropicStreamMessage;
    } catch {
      continue;
    }

    if (payload.type === "error") {
      sawError = true;
      stop = "error";
      continue;
    }

    if (payload.type === "message_start") {
      const usage = payload.message?.usage;
      if (usage) {
        yield {
          type: "usage",
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
        };
      }
      continue;
    }

    if (payload.type === "content_block_start") {
      const index = payload.index ?? 0;
      if (payload.content_block?.type === "tool_use") {
        openBlocks.add(index);
        toolParts.set(index, {
          id: payload.content_block.id ?? "",
          name: payload.content_block.name ?? "",
          arguments: "",
        });
      }
      continue;
    }

    if (payload.type === "content_block_delta") {
      const index = payload.index ?? 0;
      if (payload.delta?.type === "text_delta" && payload.delta.text) {
        yield { type: "text_delta", text: payload.delta.text };
      } else if (payload.delta?.type === "input_json_delta") {
        const part = toolParts.get(index);
        if (part) part.arguments += payload.delta.partial_json ?? "";
      }
      continue;
    }

    if (payload.type === "content_block_stop") {
      const index = payload.index ?? 0;
      if (openBlocks.has(index)) {
        openBlocks.delete(index);
        const part = toolParts.get(index);
        if (part) yield { type: "tool_call", call: part };
      }
      continue;
    }

    if (payload.type === "message_delta") {
      const reason = payload.delta?.stop_reason;
      if (reason) stop = stopFromAnthropic(reason);
      const usage = payload.delta?.usage ?? payload.usage;
      if (usage && (usage.input_tokens || usage.output_tokens)) {
        yield {
          type: "usage",
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
        };
      }
      continue;
    }
  }

  yield { type: "done", stop: sawError ? "error" : stop };
}

interface OpenAIChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export async function* openaiEvents(
  frames: AsyncIterable<SseFrame>,
): AsyncGenerator<ProviderEvent> {
  const toolParts = new Map<number, ToolCall>();
  let stop: StopReason = "end";

  for await (const frame of frames) {
    if (frame.data === "[DONE]") break;
    let payload: OpenAIChunk;
    try {
      payload = JSON.parse(frame.data) as OpenAIChunk;
    } catch {
      continue;
    }

    if (payload.usage) {
      yield {
        type: "usage",
        inputTokens: payload.usage.prompt_tokens ?? 0,
        outputTokens: payload.usage.completion_tokens ?? 0,
      };
    }

    const choice = payload.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) yield { type: "text_delta", text: delta.content };

    for (const part of delta?.tool_calls ?? []) {
      const index = part.index ?? 0;
      const existing = toolParts.get(index);
      if (existing) {
        if (part.id) existing.id = part.id;
        if (part.function?.name) existing.name = part.function.name;
        if (part.function?.arguments) existing.arguments += part.function.arguments;
      } else {
        toolParts.set(index, {
          id: part.id ?? "",
          name: part.function?.name ?? "",
          arguments: part.function?.arguments ?? "",
        });
      }
    }

    if (choice?.finish_reason) {
      stop = stopFromOpenAI(choice.finish_reason);
      for (const call of toolParts.values()) {
        yield { type: "tool_call", call };
      }
      toolParts.clear();
    }
  }

  if (toolParts.size > 0) {
    for (const call of toolParts.values()) yield { type: "tool_call", call };
  }

  yield { type: "done", stop };
}
