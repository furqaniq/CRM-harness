import type { ToolExecutor } from "../loop/types";
import { createSimulatorDb, type SimulatorDb } from "./db";
import { buildSimulatorTools, type SimulatorToolOptions } from "./tools";
import type { QuirkSwitches } from "./types";

export { SimulatorDb, createSimulatorDb, getAppSimulatorDb } from "./db";
export { buildSimulatorTools } from "./tools";
export { seedData } from "./seed";
export { assertInList, closestMatch, CompanyListError } from "./validate";
export type { QuirkSwitches, SimulatorData } from "./types";
export type { SimulatorToolOptions } from "./tools";

export interface Simulator {
  db: SimulatorDb;
  tools(options?: Partial<SimulatorToolOptions>): ToolExecutor[];
  reset(): void;
  snapshot(name: string): void;
  restore(name: string): boolean;
}

export function createSimulator(options: { quirks?: Partial<QuirkSwitches> } = {}): Simulator {
  const db = createSimulatorDb(options);
  return {
    db,
    tools(toolOptions: Partial<SimulatorToolOptions> = {}) {
      return buildSimulatorTools(db, {
        role: toolOptions.role ?? "owner",
        userId: toolOptions.userId ?? "u_owner",
      });
    },
    reset: () => db.reset(),
    snapshot: (name) => db.snapshot(name),
    restore: (name) => db.restore(name),
  };
}

let appSimulator: Simulator | null = null;

/** One simulator per server process, so chat runs share one CRM. */
export function getAppSimulator(): Simulator {
  appSimulator ??= createSimulator();
  return appSimulator;
}
