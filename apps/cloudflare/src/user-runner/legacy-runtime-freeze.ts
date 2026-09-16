import type { DurableObjectStateLike } from "./types.ts";

const FREEZE_KEY = "runtime-migration-freeze:v1";
interface FreezeRecord {
  schema: "murph.legacy-runtime-freeze.v1";
  phase: "freezing" | "frozen";
}

export class LegacyRuntimeFrozenError extends Error {
  constructor() { super("Legacy runtime is frozen for migration."); this.name = "LegacyRuntimeFrozenError"; }
}

/** Temporary cutover barrier. New RPCs stop before the final export; already
 * admitted RPCs and tracked background continuations settle before it freezes.
 * The record survives eviction and is never reset to legacy authority. */
export class LegacyRuntimeFreeze {
  private phase: FreezeRecord["phase"] | null = null;
  private readonly loaded: Promise<void>;
  private readonly pending = new Set<Promise<unknown>>();
  private freezing: Promise<boolean> | null = null;

  constructor(private readonly state: DurableObjectStateLike) {
    this.loaded = state.storage.get<unknown>(FREEZE_KEY).then(value => {
      if (value === undefined) return;
      if (!value || typeof value !== "object" || !("schema" in value) || !("phase" in value)
        || value.schema !== "murph.legacy-runtime-freeze.v1" || (value.phase !== "freezing" && value.phase !== "frozen")) {
        throw new Error("Legacy runtime freeze record is invalid.");
      }
      this.phase = value.phase;
    });
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.loaded;
    if (this.phase) throw new LegacyRuntimeFrozenError();
    // Register before yielding, so freeze cannot miss an admitted operation.
    return this.track(Promise.resolve().then(operation));
  }

  track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    return operation;
  }

  async observe(): Promise<{ phase: FreezeRecord["phase"] | null; pendingOperations: number }> {
    await this.loaded;
    return { phase: this.phase, pendingOperations: this.pending.size };
  }

  async freeze(input: { stop: () => Promise<void>; drained: () => Promise<boolean> }): Promise<boolean> {
    await this.loaded;
    if (this.phase === "frozen") return true;
    if (this.freezing) return this.freezing;
    this.phase = "freezing";
    this.freezing = this.finishFreeze(input);
    try { return await this.freezing; }
    finally { this.freezing = null; }
  }

  private async finishFreeze(input: { stop: () => Promise<void>; drained: () => Promise<boolean> }): Promise<boolean> {
    await this.persist("freezing");
    await input.stop();
    do {
      await Promise.allSettled([...this.pending]);
      // An admitted launch can have crossed the first stop while awaiting an
      // RPC. Reconcile again after those continuations have settled.
      await input.stop();
    } while (this.pending.size > 0);
    if (!await input.drained()) return false;
    if (!this.state.storage.deleteAlarm) throw new Error("Legacy migration requires alarm deletion.");
    await this.state.storage.deleteAlarm();
    await this.persist("frozen");
    this.phase = "frozen";
    return true;
  }

  async assertFrozen(): Promise<void> {
    await this.loaded;
    if (this.phase !== "frozen") throw new Error("Legacy runtime export requires a completed freeze.");
  }

  private persist(phase: FreezeRecord["phase"]): Promise<void> {
    return this.state.storage.put(FREEZE_KEY, { schema: "murph.legacy-runtime-freeze.v1", phase } satisfies FreezeRecord);
  }
}
