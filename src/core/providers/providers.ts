import { buildAnthropicRequest } from "./anthropic";
import { buildOpenAIRequest, openAIChatUrl } from "./openai";
import { anthropicEvents, openaiEvents, readSse } from "./streams";
import type {
  ChatProvider,
  FetchLike,
  ProviderEvent,
  ProviderRuntime,
} from "./types";

export class ProviderError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const OPENAI_URL = "https://api.openai.com/v1";
export const GEMINI_OPENAI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

async function errorFrom(response: Response): Promise<ProviderError> {
  let detail = "";
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string };
        message?: string;
      };
      detail = parsed.error?.message ?? parsed.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    detail = response.statusText;
  }
  const message = detail.trim() || `Provider returned ${response.status}`;
  return new ProviderError(message, response.status);
}

async function openStream(
  runtime: ProviderRuntime,
  url: string,
  init: RequestInit,
): Promise<ReadableStream<Uint8Array>> {
  const fetchFn: FetchLike = runtime.fetch;
  const response = await fetchFn(url, init);
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new ProviderError("Provider returned an empty body");
  return response.body;
}

export function createAnthropicProvider(
  model: string,
  runtime: ProviderRuntime,
): ChatProvider {
  return {
    kind: "anthropic",
    model,
    stream(request, signal): AsyncIterable<ProviderEvent> {
      const body = buildAnthropicRequest({ ...request, model });
      return anthropicEvents(
        (async function* () {
          const stream = await openStream(runtime, ANTHROPIC_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": runtime.apiKey ?? "",
              "anthropic-version": ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
            signal,
          });
          yield* readSse(stream, signal);
        })(),
      );
    },
  };
}

export function createOpenAIProvider(
  model: string,
  baseUrl: string,
  runtime: ProviderRuntime,
): ChatProvider {
  return {
    kind: "openai",
    model,
    stream(request, signal): AsyncIterable<ProviderEvent> {
      const body = buildOpenAIRequest({ ...request, model });
      return openaiEvents(
        (async function* () {
          const stream = await openStream(runtime, openAIChatUrl(baseUrl), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${runtime.apiKey ?? ""}`,
            },
            body: JSON.stringify(body),
            signal,
          });
          yield* readSse(stream, signal);
        })(),
      );
    },
  };
}
