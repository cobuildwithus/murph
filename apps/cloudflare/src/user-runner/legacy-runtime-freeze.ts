import type { DurableObjectStateLike } from "./types.ts";

const FREEZE_KEY = "runtime-migration-freeze:v1";
interface FreezeRecord {
  schema: "murph.legacy-runtime-freeze.v2";
  phase: "quiescing" | "freezing" | "frozen";
  migrationId: string | null;
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
  private migrationId: string | null = null;
  private quiescing: Promise<void> | null = null;
  private readonly admissions = new Set<Promise<unknown>>();

  constructor(private readonly state: DurableObjectStateLike) {
    this.loaded = state.storage.get<unknown>(FREEZE_KEY).then(value => {
      if (value === undefined) return;
      const record = parseFreezeRecord(value);
      this.phase = record.phase;
      this.migrationId = record.migrationId;
    });
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.loaded;
    if (this.phase === "freezing" || this.phase === "frozen") throw new LegacyRuntimeFrozenError();
    // Register before yielding, so freeze cannot miss an admitted operation.
    return this.track(Promise.resolve().then(operation));
  }

  /** Only execution starts use this gate. Current-attempt callbacks continue
   * through run() while quiescing, including the final workspace checkpoint. */
  async runAdmission<T>(operation: () => Promise<T>): Promise<T> {
    await this.loaded;
    if (this.phase) throw new LegacyRuntimeFrozenError();
    const admitted = this.track(Promise.resolve().then(operation));
    this.admissions.add(admitted);
    void admitted.then(() => this.admissions.delete(admitted), () => this.admissions.delete(admitted));
    return admitted;
  }

  /** The caller verifies the canonical member transition before closing this
   * local gate. Wait for pre-barrier launches before selecting a checkpoint
   * target; background invocations remain tracked until the final freeze. */
  async quiesce(migrationId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(migrationId)) throw new TypeError("Legacy migration identity is invalid.");
    await this.loaded;
    if (this.phase && this.migrationId !== migrationId) throw new Error("Legacy migration identity changed.");
    if (this.phase === "freezing" || this.phase === "frozen") throw new LegacyRuntimeFrozenError();
    if (this.quiescing) return this.quiescing;
    this.phase = "quiescing";
    this.migrationId = migrationId;
    this.quiescing = this.persist("quiescing").then(async () => {
      await Promise.allSettled([...this.admissions]);
    });
    try { await this.quiescing; }
    finally { this.quiescing = null; }
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

  async freeze(input: { migrationId?: string; stop: () => Promise<void>; drained: () => Promise<boolean> }): Promise<boolean> {
    await this.loaded;
    if (input.migrationId && !this.phase) throw new Error("Member freeze requires completed quiescence.");
    if ((input.migrationId ?? null) !== this.migrationId) throw new Error("Legacy migration identity changed.");
    if (this.quiescing) await this.quiescing;
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
    return this.state.storage.put(FREEZE_KEY, { schema: "murph.legacy-runtime-freeze.v2", phase, migrationId: this.migrationId } satisfies FreezeRecord);
  }
}

function parseFreezeRecord(value: unknown): FreezeRecord {
  if (!value || typeof value !== "object" || !("schema" in value) || !("phase" in value)) {
    throw new Error("Legacy runtime freeze record is invalid.");
  }
  if (value.schema === "murph.legacy-runtime-freeze.v1" && (value.phase === "freezing" || value.phase === "frozen")) {
    return { schema: "murph.legacy-runtime-freeze.v2", phase: value.phase, migrationId: null };
  }
  if (value.schema !== "murph.legacy-runtime-freeze.v2"
    || (value.phase !== "quiescing" && value.phase !== "freezing" && value.phase !== "frozen")
    || !("migrationId" in value)
    || !(value.migrationId === null || (typeof value.migrationId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value.migrationId)))
    || (value.phase === "quiescing" && value.migrationId === null)) {
    throw new Error("Legacy runtime freeze record is invalid.");
  }
  return { schema: value.schema, phase: value.phase, migrationId: value.migrationId };
}
