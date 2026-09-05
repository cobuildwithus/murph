import {
  isHostedStandbyClaimId,
  readHostedRunnerTargetIdentity,
  resolveHostedRunnerReleaseId,
  type HostedRunnerRegion,
  type HostedStandbySlotBinding,
} from "./standby-runner-contract.js";
import type {
  DurableObjectSqlValue,
} from "./user-runner/types.js";

interface StandbySlotRow extends Record<string, DurableObjectSqlValue> {
  claim_id: string | null;
  release_id: string;
  region: string;
  slot_name: string;
  state: string;
  user_id: string | null;
}

interface RunnerSlotSqlStorage {
  exec<T extends Record<string, DurableObjectSqlValue>>(
    query: string,
    ...bindings: DurableObjectSqlValue[]
  ): { toArray(): T[] };
}

export class RunnerSlotBindingStore {
  constructor(private readonly sql: RunnerSlotSqlStorage) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS standby_slot_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        slot_name TEXT NOT NULL,
        release_id TEXT NOT NULL,
        region TEXT NOT NULL,
        state TEXT NOT NULL,
        claim_id TEXT,
        user_id TEXT
      )
    `);
  }

  initialize(input: {
    releaseId: string;
    region: HostedRunnerRegion;
    slotName: string;
  }): void {
    const identity = readHostedRunnerTargetIdentity(input.slotName);
    if (!identity || identity.releaseId !== input.releaseId || identity.region !== input.region) {
      throw new TypeError("Hosted runner slot identity is invalid.");
    }
    const existing = this.select();
    if (existing) {
      assertSameSlot(existing, input);
      return;
    }
    this.sql.exec(
      `INSERT INTO standby_slot_meta (
        singleton, slot_name, release_id, region, state, claim_id, user_id
      ) VALUES (1, ?, ?, ?, 'unbound', NULL, NULL)`,
      input.slotName,
      input.releaseId,
      input.region,
    );
  }

  bind(input: {
    claimId: string;
    releaseId: string;
    region: HostedRunnerRegion;
    slotName: string;
    userId: string;
  }): Extract<HostedStandbySlotBinding, { state: "bound" }> {
    const existing = this.require();
    assertSameSlot(existing, input);
    const claimId = requireClaimId(input.claimId);
    const userId = requireRunnerSlotUserId(input.userId);
    if (existing.state === "bound") {
      if (existing.claim_id === claimId && existing.user_id === userId) {
        const binding = projectBinding(existing);
        if (binding.state !== "bound") throw new Error("Hosted runner binding is invalid.");
        return binding;
      }
      throw new Error("Hosted standby slot is already bound to another claim.");
    }
    if (existing.state !== "unbound") {
      throw new Error("Hosted standby slot cannot be rebound.");
    }
    this.sql.exec(
      `UPDATE standby_slot_meta
       SET state = 'bound', claim_id = ?, user_id = ?
       WHERE singleton = 1 AND state = 'unbound'`,
      claimId,
      userId,
    );
    const bound = this.require();
    if (
      bound.state !== "bound"
      || bound.claim_id !== claimId
      || bound.user_id !== userId
    ) {
      throw new Error("Hosted standby slot bind did not commit exactly once.");
    }
    const binding = projectBinding(bound);
    if (binding.state !== "bound") throw new Error("Hosted runner binding is invalid.");
    return binding;
  }

  beginRetirement(input: { claimId?: string }): "retired" | "retiring" {
    const existing = this.require();
    if (existing.state === "retired") {
      return "retired";
    }
    if (existing.state === "bound") {
      const claimId = requireClaimId(input.claimId);
      if (existing.claim_id !== claimId) {
        throw new Error("Hosted standby retirement claim did not match the slot binding.");
      }
    } else if (existing.state === "retiring") {
      if (existing.claim_id === null) {
        if (input.claimId !== undefined || existing.user_id !== null) {
          throw new Error("Hosted standby unbound retirement identity is invalid.");
        }
      } else if (existing.claim_id !== requireClaimId(input.claimId)) {
        throw new Error("Hosted standby retirement claim did not match the slot binding.");
      }
    } else if (input.claimId !== undefined) {
      throw new Error("Hosted standby unbound retirement must not assert a claim.");
    }
    this.sql.exec(
      `UPDATE standby_slot_meta
       SET state = 'retiring'
       WHERE singleton = 1 AND state != 'retired'`,
    );
    return "retiring";
  }

  finishRetirement(): void {
    const existing = this.require();
    if (existing.state === "retired") {
      return;
    }
    if (existing.state !== "retiring") {
      throw new Error("Hosted standby retirement was not started.");
    }
    this.sql.exec(
      `UPDATE standby_slot_meta
       SET state = 'retired', claim_id = NULL, user_id = NULL
       WHERE singleton = 1 AND state = 'retiring'`,
    );
  }

  read(): HostedStandbySlotBinding {
    return projectBinding(this.require());
  }

  readOptional(): HostedStandbySlotBinding | null {
    const row = this.select();
    return row ? projectBinding(row) : null;
  }

  private require(): StandbySlotRow {
    const row = this.select();
    if (!row) {
      throw new Error("Hosted standby slot is not initialized.");
    }
    return row;
  }

  private select(): StandbySlotRow | null {
    return this.sql.exec<StandbySlotRow>(
      `SELECT slot_name, release_id, region, state, claim_id, user_id
       FROM standby_slot_meta
       WHERE singleton = 1`,
    ).toArray()[0] ?? null;
  }
}

function projectBinding(row: StandbySlotRow): HostedStandbySlotBinding {
  const identity = readHostedRunnerTargetIdentity(row.slot_name);
  if (!identity || identity.releaseId !== row.release_id || identity.region !== row.region) {
    throw new Error("Hosted runner stored slot identity is invalid.");
  }
  if (row.state === "unbound") {
    if (row.claim_id !== null || row.user_id !== null) {
      throw new Error("Hosted standby unbound slot retained member identity.");
    }
    return {
      claimId: null,
      releaseId: row.release_id,
      region: identity.region,
      slotName: row.slot_name,
      state: "unbound",
      userId: null,
    };
  }
  if (row.state === "bound") {
    return {
      claimId: requireClaimId(row.claim_id),
      releaseId: row.release_id,
      region: identity.region,
      slotName: row.slot_name,
      state: "bound",
      userId: requireRunnerSlotUserId(row.user_id),
    };
  }
  if (row.state === "retiring") {
    if ((row.claim_id === null) !== (row.user_id === null)) {
      throw new Error("Hosted standby retiring slot identity is incomplete.");
    }
    return {
      claimId: row.claim_id === null ? null : requireClaimId(row.claim_id),
      releaseId: row.release_id,
      region: identity.region,
      slotName: row.slot_name,
      state: "retiring",
      userId: row.user_id === null ? null : requireRunnerSlotUserId(row.user_id),
    };
  }
  if (row.state === "retired") {
    if (row.claim_id !== null || row.user_id !== null) {
      throw new Error("Hosted standby retired slot retained member identity.");
    }
    return {
      claimId: null,
      releaseId: row.release_id,
      region: identity.region,
      slotName: row.slot_name,
      state: "retired",
      userId: null,
    };
  }
  throw new Error("Hosted standby slot state is invalid.");
}

interface RetainedStandbyRequest {
  currentReleaseId: string;
  region: HostedRunnerRegion;
  slotName: string;
  targetReleaseId: string;
  userId: string;
}

export function requireRetainedRunnerRequest(
  environment: Readonly<Record<string, unknown>>,
  binding: HostedStandbySlotBinding,
  input: {
    currentReleaseId: string;
    region: HostedRunnerRegion;
    slotName: string;
    userId: string;
  },
): RetainedStandbyRequest {
  const currentReleaseId = resolveHostedRunnerReleaseId(environment);
  if (input.currentReleaseId !== currentReleaseId) {
    throw new Error("Hosted standby retained-slot release authority is stale.");
  }
  const targetIdentity = readHostedRunnerTargetIdentity(input.slotName);
  const targetReleaseId = targetIdentity?.releaseId;
  if (
    !targetReleaseId
    || input.region !== targetIdentity?.region
    || binding.slotName !== input.slotName
    || binding.releaseId !== targetReleaseId
    || binding.region !== input.region
  ) {
    throw new Error("Hosted standby retained-slot identity did not match exactly.");
  }
  const userId = requireRunnerSlotUserId(input.userId);
  if (
    (binding.state === "bound" || binding.state === "retiring")
    && binding.userId !== null
    && binding.userId !== userId
  ) {
    throw new Error("Hosted standby retained slot belongs to another member.");
  }
  return {
    currentReleaseId,
    region: input.region,
    slotName: input.slotName,
    targetReleaseId,
    userId,
  };
}

export function assertRetainedRunnerBinding(
  retained: HostedStandbySlotBinding,
  before: Extract<HostedStandbySlotBinding, { state: "bound" }>,
  request: RetainedStandbyRequest,
): void {
  if (
    retained.state !== "bound"
    || retained.claimId !== before.claimId
    || retained.releaseId !== request.currentReleaseId
    || retained.region !== request.region
    || retained.slotName !== request.slotName
    || retained.userId !== request.userId
  ) {
    throw new Error(
      "Hosted standby retained-slot binding changed during native liveness proof.",
    );
  }
}

export function assertRetiredRunnerBinding(
  retired: HostedStandbySlotBinding,
  request: RetainedStandbyRequest,
): asserts retired is Extract<HostedStandbySlotBinding, { state: "retired" }> {
  if (
    retired.state !== "retired"
    || retired.claimId !== null
    || retired.userId !== null
    || retired.releaseId !== request.targetReleaseId
    || retired.region !== request.region
    || retired.slotName !== request.slotName
  ) {
    throw new Error("Hosted standby retained-slot retirement did not settle exactly.");
  }
}

function assertSameSlot(
  row: StandbySlotRow,
  input: { releaseId: string; region: string; slotName: string },
): void {
  if (
    row.slot_name !== input.slotName
    || row.release_id !== input.releaseId
    || row.region !== input.region
  ) {
    throw new Error("Hosted standby slot identity is immutable.");
  }
}

function requireClaimId(value: unknown): string {
  if (!isHostedStandbyClaimId(value)) {
    throw new TypeError("Hosted standby claim id is invalid.");
  }
  return value;
}

export function requireRunnerSlotUserId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim() !== value || value.length > 256) {
    throw new TypeError("Hosted standby user id is invalid.");
  }
  return value;
}
