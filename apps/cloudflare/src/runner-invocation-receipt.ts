import type { DurableObjectSqlValue } from "./user-runner/types.ts";

interface InvocationSqlStorage {
  exec<T extends Record<string, DurableObjectSqlValue>>(
    query: string, ...bindings: DurableObjectSqlValue[]
  ): { toArray(): T[] };
}

export interface RunnerInvocationIdentity {
  attemptId: string;
  generation: string;
}

export interface RunnerProviderContext {
  workspaceVersion: string;
  customInferenceEnvelope: string | null;
  platformAiUsageAllowed: boolean;
}

export interface RunnerProviderAuthority extends RunnerInvocationIdentity, RunnerProviderContext {
  userId: string;
  settlementPending: boolean;
  retiring: boolean;
}

export interface RunnerInvocationReceipt extends RunnerInvocationIdentity {
  state: "registered" | "completed";
  immediateRecheckRequested: boolean;
}

/** Native execution evidence, never member admission authority. One retained
 * receipt fences delayed RPCs and survives eviction without storing job data.
 * An uncertain registered invocation must be reconciled or its slot retired.
 */
export class RunnerInvocationReceiptStore {
  constructor(private readonly sql: InvocationSqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS runner_invocation_receipt (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      attempt_id TEXT NOT NULL,
      generation TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('registered', 'completed')),
      immediate_recheck INTEGER NOT NULL DEFAULT 0,
      provider_context TEXT
    )`);
    if (!sql.exec<{ name: string }>("PRAGMA table_info(runner_invocation_receipt)").toArray()
      .some(column => column.name === "provider_context")) {
      sql.exec("ALTER TABLE runner_invocation_receipt ADD COLUMN provider_context TEXT");
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS runner_usage_settlement (
      report_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, generation TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'denied'))
    )`);
  }

  read(): RunnerInvocationReceipt | null {
    const [row] = this.sql.exec<{
      attempt_id: string; generation: string; state: string; immediate_recheck: number;
    }>("SELECT attempt_id, generation, state, immediate_recheck FROM runner_invocation_receipt WHERE singleton = 1").toArray();
    if (!row) return null;
    if (row.state !== "registered" && row.state !== "completed") throw new Error("Invalid native invocation receipt.");
    return { attemptId: row.attempt_id, generation: row.generation, state: row.state, immediateRecheckRequested: row.immediate_recheck === 1 };
  }

  register(identity: RunnerInvocationIdentity, context?: RunnerProviderContext): "new" | "existing" {
    if (!/^[1-9][0-9]*$/u.test(identity.generation)
      || BigInt(identity.generation) > 9_223_372_036_854_775_807n
      || !/^[A-Za-z0-9._:-]{1,200}$/u.test(identity.attemptId)) {
      throw new TypeError("Invalid native invocation identity.");
    }
    const current = this.read();
    if (current) {
      if (matches(current, identity)) return "existing";
      if (BigInt(identity.generation) <= BigInt(current.generation)) throw new Error("Stale native invocation.");
      if (current.state !== "completed") throw new Error("Native invocation outcome is unresolved.");
    }
    this.sql.exec(`INSERT INTO runner_invocation_receipt
      (singleton, attempt_id, generation, state, immediate_recheck, provider_context) VALUES (1, ?, ?, 'registered', 0, ?)
      ON CONFLICT(singleton) DO UPDATE SET attempt_id = excluded.attempt_id,
        generation = excluded.generation, state = 'registered', immediate_recheck = 0,
        provider_context = excluded.provider_context`,
    identity.attemptId, identity.generation, context ? JSON.stringify(context) : null);
    this.sql.exec("DELETE FROM runner_usage_settlement");
    return "new";
  }

  readProviderInvocation(): (RunnerInvocationIdentity & {
    context: RunnerProviderContext | null; settlementPending: boolean;
  }) | null {
    const [row] = this.sql.exec<{
      attempt_id: string; generation: string; provider_context: string | null; settlement_pending: number;
    }>(`SELECT attempt_id, generation, provider_context,
        EXISTS (SELECT 1 FROM runner_usage_settlement WHERE attempt_id = receipt.attempt_id
          AND generation = receipt.generation) AS settlement_pending
      FROM runner_invocation_receipt AS receipt WHERE singleton = 1 AND state = 'registered'`).toArray();
    return row ? { attemptId: row.attempt_id, generation: row.generation,
      context: row.provider_context === null ? null : JSON.parse(row.provider_context) as RunnerProviderContext,
      settlementPending: row.settlement_pending !== 0 } : null;
  }

  /** Only predeployment registered invocations need this one-time backfill. */
  restoreProviderContext(identity: RunnerInvocationIdentity, context: RunnerProviderContext): void {
    this.sql.exec(`UPDATE runner_invocation_receipt SET provider_context = ?
      WHERE singleton = 1 AND attempt_id = ? AND generation = ? AND state = 'registered'
        AND provider_context IS NULL`, JSON.stringify(context), identity.attemptId, identity.generation);
  }

  beginUsageSettlement(identity: RunnerInvocationIdentity, reportId: string): boolean {
    const current = this.read();
    if (!current || current.state !== "registered" || !matches(current, identity)) return false;
    if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(reportId)) throw new TypeError("Invalid usage settlement receipt.");
    if (this.sql.exec<{ report_id: string }>("SELECT report_id FROM runner_usage_settlement WHERE report_id = ?", reportId).toArray().length) return true;
    const [count] = this.sql.exec<{ count: number }>("SELECT count(*) AS count FROM runner_usage_settlement").toArray();
    if ((count?.count ?? 0) >= 128) return false;
    this.sql.exec("INSERT INTO runner_usage_settlement (report_id, attempt_id, generation, state) VALUES (?, ?, ?, 'pending')", reportId, identity.attemptId, identity.generation);
    return true;
  }

  finishUsageSettlement(identity: RunnerInvocationIdentity, reportId: string, allowed: boolean): void {
    // Only an explicit successful allowance response removes this request's
    // negative latch. Lost responses/eviction leave durable pending evidence.
    if (allowed) this.sql.exec("DELETE FROM runner_usage_settlement WHERE report_id = ? AND attempt_id = ? AND generation = ? AND state = 'pending'", reportId, identity.attemptId, identity.generation);
    else this.sql.exec("UPDATE runner_usage_settlement SET state = 'denied' WHERE report_id = ? AND attempt_id = ? AND generation = ?", reportId, identity.attemptId, identity.generation);
  }

  usageSettlementAllowsProviders(identity: RunnerInvocationIdentity): boolean {
    const current = this.read();
    if (!current || current.state !== "registered" || !matches(current, identity)) return false;
    const [row] = this.sql.exec<{ count: number }>("SELECT count(*) AS count FROM runner_usage_settlement WHERE attempt_id = ? AND generation = ?", identity.attemptId, identity.generation).toArray();
    return row?.count === 0;
  }

  complete(identity: RunnerInvocationIdentity, immediateRecheckRequested: boolean): boolean {
    const current = this.read();
    if (!current || !matches(current, identity)) return false;
    this.sql.exec(`UPDATE runner_invocation_receipt SET state = 'completed', immediate_recheck = MAX(immediate_recheck, ?)
      WHERE singleton = 1 AND attempt_id = ? AND generation = ?`,
    immediateRecheckRequested ? 1 : 0, identity.attemptId, identity.generation);
    return true;
  }
}

function matches(a: RunnerInvocationIdentity, b: RunnerInvocationIdentity): boolean {
  return a.attemptId === b.attemptId && a.generation === b.generation;
}
