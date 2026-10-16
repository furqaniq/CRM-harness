import { createMockProvider, type MockScriptStep } from "./mock";
import {
  createAnthropicProvider,
  createOpenAIProvider,
  GEMINI_OPENAI_URL,
  OPENAI_URL,
} from "./providers";
import type {
  ChatProvider,
  ModelConfig,
  ProviderRuntime,
} from "./types";

export interface CreateProviderOptions {
  /** Scripted steps for the `mock` kind, so tests and demos need no key. */
  mockScript?: MockScriptStep[];
}

export function createProvider(
  config: ModelConfig,
  runtime: ProviderRuntime,
  options: CreateProviderOptions = {},
): ChatProvider {
  switch (config.kind) {
    case "mock":
      return createMockProvider({
        script: options.mockScript ?? [{ type: "done", stop: "end" }],
        model: config.model,
      });
    case "anthropic":
      return createAnthropicProvider(config.model, runtime);
    case "openai":
      return createOpenAIProvider(
        config.model,
        config.baseUrl ?? OPENAI_URL,
        runtime,
      );
    case "openai-compatible":
      if (!config.baseUrl) {
        throw new Error(`Provider "${config.label}" needs a base URL`);
      }
      return createOpenAIProvider(config.model, config.baseUrl, runtime);
    case "gemini":
      return createOpenAIProvider(
        config.model,
        config.baseUrl ?? GEMINI_OPENAI_URL,
        runtime,
      );
  }
}
