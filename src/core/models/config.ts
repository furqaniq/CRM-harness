import {
  MODEL_ROLES,
  type ModelConfig,
  type ProviderConnection,
  type TokenUsage,
} from "../providers/types";

export const MOCK_MODEL: ModelConfig = {
  id: "mock",
  kind: "mock",
  label: "Scripted mock",
  model: "mock-model",
  capabilities: { tools: true, streaming: true, vision: false },
  pricing: { inputPerMTok: 0, outputPerMTok: 0 },
};

export const EMPTY_CONNECTION: ProviderConnection = {
  models: [MOCK_MODEL],
  roles: { orchestrator: MOCK_MODEL.id },
  fallbacks: [],
};

export function findModel(
  connection: ProviderConnection,
  id: string | undefined,
): ModelConfig | undefined {
  if (!id) return undefined;
  return connection.models.find((model) => model.id === id);
}

export function modelForRole(
  connection: ProviderConnection,
  role: (typeof MODEL_ROLES)[number],
): ModelConfig | undefined {
  return findModel(connection, connection.roles[role]);
}

/**
 * Ordered candidates for a model: the model itself, then any fallback chain it
 * belongs to, deduplicated.
 */
export function fallbackChain(
  connection: ProviderConnection,
  configId: string | undefined,
): ModelConfig[] {
  const chain: ModelConfig[] = [];
  const seen = new Set<string>();

  const push = (id: string | undefined) => {
    const model = findModel(connection, id);
    if (!model || seen.has(model.id)) return;
    seen.add(model.id);
    chain.push(model);
  };

  push(configId);
  for (const group of connection.fallbacks) {
    if (!configId || !group.includes(configId)) continue;
    for (const id of group) push(id);
  }

  return chain;
}

export function costUsd(config: ModelConfig, usage: TokenUsage): number {
  const input = (usage.inputTokens / 1_000_000) * config.pricing.inputPerMTok;
  const output = (usage.outputTokens / 1_000_000) * config.pricing.outputPerMTok;
  return input + output;
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
