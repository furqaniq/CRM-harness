import { seedData } from "./seed";
import type { QuirkSwitches, Role, SimulatorData } from "./types";

/**
 * In-memory CRM database with the simulator's reset and snapshot/restore
 * (spec §6). Every mutation goes through here so tests can snapshot before a
 * write and restore after it, and the quirks switches stay visible instead of
 * being buried in tool code.
 */
export class SimulatorDb {
  data: SimulatorData;
  quirks: QuirkSwitches;
  /** Alternating counter behind the intermittent branch_list quirk. */
  private branchListCalls = 0;
  private idCounter = 0;
  private snapshots = new Map<string, SimulatorData>();

  constructor(options: { quirks?: Partial<QuirkSwitches> } = {}) {
    this.data = seedData();
    this.quirks = {
      intermittentBranchList: false,
      campaignStepWrongField: false,
      ...options.quirks,
    };
  }

  reset(): void {
    this.data = seedData();
    this.branchListCalls = 0;
    this.idCounter = 0;
  }

  snapshot(name: string): void {
    this.snapshots.set(name, structuredClone(this.data));
  }

  restore(name: string): boolean {
    const saved = this.snapshots.get(name);
    if (!saved) return false;
    this.data = structuredClone(saved);
    return true;
  }

  snapshotNames(): string[] {
    return [...this.snapshots.keys()];
  }

  /** The intermittent branch_list failure: every 4th call fails while the switch is on. */
  nextBranchListFails(): boolean {
    if (!this.quirks.intermittentBranchList) return false;
    this.branchListCalls += 1;
    return this.branchListCalls % 4 === 0;
  }

  /** A normal user sees only their own branch's conversations (owner sees all). */
  visibleConversations(role: Role, userId: string) {
    if (role === "owner") return this.data.conversations;
    const user = this.data.users.find((candidate) => candidate.id === userId);
    return this.data.conversations.filter(
      (conversation) =>
        conversation.ownerId === userId || conversation.branchId === user?.branchId,
    );
  }

  nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter}`;
  }
}

export function createSimulatorDb(options?: { quirks?: Partial<QuirkSwitches> }): SimulatorDb {
  return new SimulatorDb(options);
}

/** Process-wide simulator so chat runs share one CRM within a dev server. */
let appDb: SimulatorDb | null = null;

export function getAppSimulatorDb(): SimulatorDb {
  appDb ??= createSimulatorDb();
  return appDb;
}
