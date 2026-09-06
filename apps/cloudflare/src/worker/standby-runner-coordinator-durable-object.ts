import { DurableObject } from "cloudflare:workers";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";

import {
  HOSTED_RUNNER_REGION,
  HOSTED_STANDBY_LOCATION_HINT,
  HOSTED_STANDBY_ORPHAN_GRACE_MS,
  HOSTED_STANDBY_READY_TIMEOUT_MS,
  HOSTED_STANDBY_REGION,
  HOSTED_STANDBY_RETRY_MS,
  createHostedRunnerSlotName,
  isHostedRunnerSlotName,
  isHostedStandbyClaimId,
  isHostedStandbySlotName,
  readHostedRunnerSlotReleaseId,
  readHostedStandbyMode,
  readHostedStandbyReleaseId,
  readHostedStandbySlotReleaseId,
  readHostedStandbyTarget,
  type HostedStandbyClaimRequest,
  type HostedStandbyClaimResult,
  type HostedStandbyCoordinatorState,
  type HostedStandbyRunnerContainerNamespaceLike,
} from "../standby-runner-contract.js";
import type {
  DurableObjectSqlStorageLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "../user-runner/types.js";

const STANDBY_READY_REPROBE_MS = 60_000;
const STANDBY_CONTROL_RPC_TIMEOUT_MS = 1_000;
const STANDBY_CLEANUP_BATCH_SIZE = 4;
const STANDBY_PARALLELISM = 2;

type Region = HostedStandbyCoordinatorState["region"];

interface StandbyCoordinatorEnvironment extends Readonly<Record<string, unknown>> {
  RUNNER_CONTAINER?: HostedStandbyRunnerContainerNamespaceLike;
  STANDBY_RUNNER_CONTAINER?: HostedStandbyRunnerContainerNamespaceLike;
}

interface StandbyCoordinatorMetaRow extends Record<string, DurableObjectSqlValue> {
  region: string;
  release_id: string;
}

interface StandbySlotRow extends Record<string, DurableObjectSqlValue> {
  slot_name: string;
  phase: "ready" | "provisioning" | "draining";
  check_at_ms: number;
}

interface StandbyClaimRow extends Record<string, DurableObjectSqlValue> {
  claim_id: string;
  slot_name: string;
}

type CleanupTarget = { slotName: string; claimId?: string };

export class StandbyRunnerCoordinatorDurableObject extends DurableObject {
  private fillWork: Promise<void> | null = null;
  private cleanupWork: Promise<void> | null = null;
  private fillRequested = false;
  private cleanupRequested = false;
  // Invocation-local exclusion only; SQLite retains every intent across resets.
  private readonly preparing = new Set<string>();
  private readonly store: StandbyRunnerCoordinatorStore;
  private readonly transactionSync: <T>(callback: () => T) => T;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly environment: StandbyCoordinatorEnvironment,
  ) {
    super(state as never, environment as never);
    const { sql, transactionSync } = state.storage;
    if (!sql || !transactionSync) {
      throw new Error("Hosted standby coordinator requires SQLite Durable Object storage.");
    }
    this.transactionSync = transactionSync.bind(state.storage);
    this.store = this.transactionSync(() => new StandbyRunnerCoordinatorStore(sql));
  }

  claimReadyStandby(input: HostedStandbyClaimRequest): HostedStandbyClaimResult {
    requireReleaseAndRegion(input);
    if (!isHostedStandbyClaimId(input.claimId)) {
      throw new TypeError("Hosted standby claim id is invalid.");
    }
    if (!Number.isSafeInteger(input.deadlineAtEpochMs) || input.deadlineAtEpochMs <= 0) {
      throw new TypeError("Hosted standby claim deadline is invalid.");
    }
    const result = this.transactionSync((): HostedStandbyClaimResult => {
      this.store.initialize(input);
      // A replay is the original handoff, not another allocation. Preserve it
      // even when its deadline, mode or release has subsequently changed.
      const replay = this.store.readClaim(input.claimId);
      if (replay) return { outcome: "claimed", slotName: replay.slot_name };
      if (readHostedStandbyMode(this.environment) !== "allocate") {
        return { outcome: "disabled" };
      }
      if (input.region !== HOSTED_RUNNER_REGION
        || input.releaseId !== readHostedStandbyReleaseId(this.environment)) {
        return { outcome: "stale_release" };
      }
      if (input.deadlineAtEpochMs <= Date.now()) return { outcome: "deadline_expired" };
      this.rebalance();
      const slotName = this.store.claimReadySlot(input.claimId, Date.now());
      return slotName ? { outcome: "claimed", slotName } : { outcome: "no_ready_slot" };
    });
    this.startFill();
    this.startCleanup();
    return result;
  }

  ensureReadyStandby(input: { releaseId: string; region: Region }): { accepted: true } {
    requireReleaseAndRegion(input);
    this.transactionSync(() => {
      this.store.initialize(input);
      this.rebalance();
    });
    this.startFill();
    this.startCleanup();
    return { accepted: true };
  }

  readStandbyCoordinatorState(): HostedStandbyCoordinatorState {
    return this.store.readState();
  }

  async alarm(): Promise<void> {
    await Promise.all([this.startFill(), this.startCleanup()]);
  }

  private desiredTarget(): number {
    const target = readHostedStandbyTarget(this.environment);
    const state = this.store.readState();
    return state.releaseId !== null && state.region === HOSTED_RUNNER_REGION
      && state.releaseId === readHostedStandbyReleaseId(this.environment)
      && readHostedStandbyMode(this.environment) !== "off" ? target : 0;
  }

  private rebalance(): void {
    this.store.drainSurplus(this.desiredTarget(), Date.now());
  }

  // Independent, coalesced lanes: a slow cleanup batch cannot hold up a claim's
  // refill. Repeated triggers set one dirty bit, never append maintenance jobs.
  private startFill(): Promise<void> {
    this.fillRequested = true;
    if (this.fillWork) return this.fillWork;
    this.fillWork = Promise.resolve().then(async () => {
      do {
        this.fillRequested = false;
        await this.fillInventory();
      } while (this.fillRequested);
    }).catch(async () => {
      await this.state.storage.setAlarm(Date.now() + HOSTED_STANDBY_RETRY_MS);
    }).finally(() => {
      this.fillWork = null;
      // A trigger may arrive after the loop exits but before this continuation.
      if (this.fillRequested) this.startFill();
    });
    this.state.waitUntil(this.fillWork);
    return this.fillWork;
  }

  private startCleanup(): Promise<void> {
    this.cleanupRequested = true;
    if (this.cleanupWork) return this.cleanupWork;
    this.cleanupWork = Promise.resolve().then(async () => {
      do {
        this.cleanupRequested = false;
        await this.cleanupInventory();
      } while (this.cleanupRequested);
    }).catch(async () => {
      await this.state.storage.setAlarm(Date.now() + HOSTED_STANDBY_RETRY_MS);
    }).finally(() => {
      this.cleanupWork = null;
      if (this.cleanupRequested) this.startCleanup();
    });
    this.state.waitUntil(this.cleanupWork);
    return this.cleanupWork;
  }

  private async fillInventory(): Promise<void> {
    // Bound attempts even when every preparation fails. A later alarm retries.
    let remaining = Math.max(STANDBY_PARALLELISM, this.desiredTarget());
    let reprobed = false;
    const workers = await Promise.allSettled(Array.from({ length: STANDBY_PARALLELISM }, async () => {
      while (remaining > 0) {
        const reservation = this.transactionSync(() => {
          this.rebalance();
          const target = this.desiredTarget();
          const state = this.store.readState();
          if (!target || !state.releaseId) return null;
          const pending = this.store.readInventory().find((row) =>
            row.phase === "provisioning" && row.check_at_ms <= Date.now()
            && !this.preparing.has(row.slot_name));
          if (pending) return { slotName: pending.slot_name, fresh: false };
          if (state.readySlotNames.length + state.provisioningSlotNames.length < target) {
            const slotName = createHostedRunnerSlotName(state.releaseId);
            this.store.insertProvisioning(slotName);
            return { slotName, fresh: true };
          }
          if (!reprobed && state.provisioningSlotNames.length === 0) {
            const slotName = this.store.beginReproof(Date.now(), target);
            if (slotName) {
              reprobed = true;
              return { slotName, fresh: false };
            }
          }
          return null;
        });
        if (!reservation) break;
        remaining -= 1;
        this.preparing.add(reservation.slotName);
        try {
          // Persist both the exact intent and its recovery alarm BEFORE even
          // obtaining the external stub. A reset never substitutes a new name.
          await this.scheduleRecovery();
          this.transactionSync(() => this.rebalance());
          if (!this.store.isProvisioning(reservation.slotName)) {
            // This invocation alone knows a fresh intent never left the owner.
            if (reservation.fresh) this.store.forgetSlot(reservation.slotName);
            continue;
          }
          if (!await this.prepareSlot(reservation.slotName)) break;
        } finally {
          this.preparing.delete(reservation.slotName);
          this.store.makeDrainDue(reservation.slotName, Date.now());
          this.startCleanup();
        }
      }
    }));
    // A failed worker must not release the fill owner while its peer still
    // prepares a slot, or the next trigger could start another pair.
    const failed = workers.find((worker) => worker.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    await this.scheduleRecovery();
  }

  private async prepareSlot(slotName: string): Promise<boolean> {
    const releaseId = readHostedRunnerSlotReleaseId(slotName);
    if (!releaseId) throw new Error("Hosted runner slot identity is invalid.");
    try {
      const proof = await withRpcDeadline(
        () => this.slot(slotName).prepareStandbySlot({
          releaseId, region: HOSTED_RUNNER_REGION, slotName,
          timeoutMs: HOSTED_STANDBY_READY_TIMEOUT_MS,
        }),
        HOSTED_STANDBY_READY_TIMEOUT_MS,
        () => {
          // Timeout is not cancellation. A late completion must still have an
          // exact cleanup target, even if an earlier retirement already settled.
          this.transactionSync(() => this.store.rememberDrain(slotName, Date.now()));
          this.startCleanup();
        },
      );
      if (proof.slotName !== slotName || proof.releaseId !== releaseId
        || proof.region !== HOSTED_RUNNER_REGION || proof.prepared !== true) {
        throw new Error("Hosted standby preparation proof is invalid.");
      }
      this.transactionSync(() => {
        this.rebalance();
        this.store.finishProvisioning(slotName, Date.now(), this.desiredTarget());
      });
      return true;
    } catch (error) {
      this.transactionSync(() => this.store.rememberDrain(slotName, Date.now()));
      emitHostedExecutionStructuredLog({
        component: "cloudflare.standby",
        details: {
          errorCode: deriveHostedExecutionErrorCode(error),
          errorName: readHostedExecutionSafeErrorName(error),
        },
        level: "warn",
        message: "Hosted standby provisioning failed.",
        phase: "failed",
      });
      return false;
    }
  }

  private async cleanupInventory(): Promise<void> {
    const targets = this.transactionSync(() => {
      this.rebalance();
      return this.store.takeCleanupBatch(Date.now(), this.preparing);
    });
    if (targets.length) {
      await this.scheduleRecovery();
      let next = 0;
      await Promise.all(Array.from({ length: STANDBY_PARALLELISM }, async () => {
        while (next < targets.length) {
          const target = targets[next++];
          if (target && await this.retireIfOwned(target.slotName)) {
            this.transactionSync(() => {
              if (target.claimId) this.store.deleteClaim(target.claimId);
              else this.store.forgetSlot(target.slotName);
            });
          }
        }
      }));
    }
    await this.scheduleRecovery();
  }

  private slot(slotName: string) {
    if (isHostedStandbySlotName(slotName)) {
      const namespace = this.environment.STANDBY_RUNNER_CONTAINER;
      if (!namespace) throw new Error("Legacy standby cleanup binding is unavailable.");
      return namespace.getByName(slotName, { locationHint: HOSTED_STANDBY_LOCATION_HINT });
    }
    if (!isHostedRunnerSlotName(slotName) || !this.environment.RUNNER_CONTAINER) {
      throw new Error("Hosted runner container binding is unavailable.");
    }
    return this.environment.RUNNER_CONTAINER.getByName(slotName);
  }

  private async retireIfOwned(slotName: string): Promise<boolean> {
    try {
      const slot = this.slot(slotName);
      const binding = await withRpcDeadline(
        () => slot.readStandbySlotCoordinatorState(), STANDBY_CONTROL_RPC_TIMEOUT_MS,
      );
      const releaseId = readHostedRunnerSlotReleaseId(slotName)
        ?? readHostedStandbySlotReleaseId(slotName);
      if (binding.slotName !== slotName || binding.releaseId !== releaseId) return false;
      if (binding.state === "bound" || binding.state === "retired"
        || (binding.state === "retiring" && binding.coordinatorOwned === false)) return true;
      if (binding.coordinatorOwned !== true
        || (binding.state !== "unbound" && binding.state !== "retiring")) return false;
      // No claim authority: the slot's binding fence rejects a racing bind.
      const retirement = await withRpcDeadline(
        () => slot.retireStandbySlot({}), STANDBY_CONTROL_RPC_TIMEOUT_MS,
      );
      return retirement.retired === true;
    } catch {
      // Unknown/timeout is not retirement proof. Keep the exact durable fact.
      return false;
    }
  }

  private async scheduleRecovery(): Promise<void> {
    const target = this.desiredTarget();
    if (!target && !this.store.hasWork()) return;
    const state = this.store.readState();
    const nextProof = target && state.provisioningSlotNames.length === 0
      ? this.store.nextProofAt() : null;
    const delay = nextProof === null ? HOSTED_STANDBY_RETRY_MS
      : Math.min(HOSTED_STANDBY_RETRY_MS, Math.max(1_000, nextProof - Date.now()));
    await this.state.storage.setAlarm(Date.now() + delay);
  }
}

class StandbyRunnerCoordinatorStore {
  constructor(private readonly sql: DurableObjectSqlStorageLike) {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS standby_coordinator_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      release_id TEXT NOT NULL, region TEXT NOT NULL,
      ready_slot_name TEXT, provisioning_slot_name TEXT
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS standby_claim_tombstone (
      claim_id TEXT PRIMARY KEY, slot_name TEXT NOT NULL, claimed_at_ms INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS standby_coordinator_slot (
      slot_name TEXT PRIMARY KEY,
      phase TEXT NOT NULL CHECK (phase IN ('ready', 'provisioning', 'draining')),
      check_at_ms INTEGER NOT NULL
    )`);
    // One additive migration, in the owner's transaction. Old singleton names
    // are cleanup-only, never GLOBAL inventory. Clearing them makes replay safe.
    for (const column of ["ready_slot_name", "provisioning_slot_name"]) {
      this.sql.exec(`INSERT OR IGNORE INTO standby_coordinator_slot
        (slot_name, phase, check_at_ms)
        SELECT ${column}, 'draining', 0 FROM standby_coordinator_meta
        WHERE ${column} IS NOT NULL`);
    }
    this.sql.exec(`UPDATE standby_coordinator_meta
      SET ready_slot_name = NULL, provisioning_slot_name = NULL WHERE singleton = 1`);
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(standby_claim_tombstone)").toArray();
    if (!columns.some((column) => column.name === "check_at_ms")) {
      this.sql.exec("ALTER TABLE standby_claim_tombstone ADD COLUMN check_at_ms INTEGER NOT NULL DEFAULT 0");
      this.sql.exec("UPDATE standby_claim_tombstone SET check_at_ms = claimed_at_ms + ?", HOSTED_STANDBY_ORPHAN_GRACE_MS);
    }
    this.sql.exec(`CREATE INDEX IF NOT EXISTS standby_slot_check
      ON standby_coordinator_slot (phase, check_at_ms, slot_name)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS standby_claim_check
      ON standby_claim_tombstone (check_at_ms, claim_id)`);
  }

  initialize(input: { releaseId: string; region: Region }): void {
    const existing = this.selectMeta();
    if (existing) {
      if (existing.release_id !== input.releaseId || existing.region !== input.region) {
        throw new Error("Hosted standby coordinator identity is immutable.");
      }
    } else {
      this.sql.exec(`INSERT INTO standby_coordinator_meta
        (singleton, release_id, region) VALUES (1, ?, ?)`, input.releaseId, input.region);
    }
  }

  readState(): HostedStandbyCoordinatorState {
    const row = this.selectMeta();
    const region = row?.region ?? HOSTED_RUNNER_REGION;
    if (region !== HOSTED_RUNNER_REGION && region !== HOSTED_STANDBY_REGION) {
      throw new Error("Hosted standby coordinator region is invalid.");
    }
    const inventory = this.readInventory();
    return {
      readySlotNames: inventory.filter((slot) => slot.phase === "ready").map((slot) => slot.slot_name),
      provisioningSlotNames: inventory.filter((slot) => slot.phase === "provisioning").map((slot) => slot.slot_name),
      releaseId: row?.release_id ?? null,
      region,
    };
  }

  readInventory(): StandbySlotRow[] {
    return this.sql.exec<StandbySlotRow>(`SELECT slot_name, phase, check_at_ms
      FROM standby_coordinator_slot WHERE phase IN ('ready', 'provisioning')
      ORDER BY phase DESC, check_at_ms, slot_name`).toArray();
  }

  drainSurplus(target: number, now: number): void {
    // Keep ready slots ahead of unfinished preparations when reducing target.
    for (const row of this.readInventory().slice(target)) this.rememberDrain(row.slot_name, now);
  }

  insertProvisioning(slotName: string): void {
    this.sql.exec(`INSERT INTO standby_coordinator_slot (slot_name, phase, check_at_ms)
      VALUES (?, 'provisioning', 0)`, slotName);
  }

  isProvisioning(slotName: string): boolean {
    return this.sql.exec<{ phase: string }>(
      "SELECT phase FROM standby_coordinator_slot WHERE slot_name = ?", slotName,
    ).toArray()[0]?.phase === "provisioning";
  }

  beginReproof(now: number, target: number): string | null {
    const row = this.sql.exec<StandbySlotRow>(`SELECT slot_name, phase, check_at_ms
      FROM standby_coordinator_slot WHERE phase = 'ready' AND check_at_ms <= ?
      ORDER BY check_at_ms, slot_name LIMIT 1`, now).toArray()[0];
    if (!row) return null;
    this.sql.exec("UPDATE standby_coordinator_slot SET phase = 'provisioning' WHERE slot_name = ?", row.slot_name);
    // Stagger even after downtime made several proofs overdue. Only one ready
    // slot is withdrawn; finishing it does not make its peers immediately due.
    this.sql.exec(`UPDATE standby_coordinator_slot SET check_at_ms = MAX(check_at_ms, ?)
      WHERE phase = 'ready'`, now + Math.ceil(STANDBY_READY_REPROBE_MS / target));
    return row.slot_name;
  }

  finishProvisioning(slotName: string, now: number, target: number): void {
    if (!target) return;
    const last = this.sql.exec<{ due: number | null }>(`SELECT MAX(check_at_ms) AS due
      FROM standby_coordinator_slot WHERE phase = 'ready'`).toArray()[0]?.due;
    const due = Math.max(now + STANDBY_READY_REPROBE_MS,
      (last ?? now) + Math.ceil(STANDBY_READY_REPROBE_MS / target));
    this.sql.exec(`UPDATE standby_coordinator_slot SET phase = 'ready', check_at_ms = ?
      WHERE slot_name = ? AND phase = 'provisioning'`, due, slotName);
  }

  readClaim(claimId: string): StandbyClaimRow | null {
    return this.sql.exec<StandbyClaimRow>(`SELECT claim_id, slot_name
      FROM standby_claim_tombstone WHERE claim_id = ?`, claimId).toArray()[0] ?? null;
  }

  claimReadySlot(claimId: string, now: number): string | null {
    const row = this.sql.exec<{ slot_name: string }>(`SELECT slot_name
      FROM standby_coordinator_slot WHERE phase = 'ready'
      ORDER BY check_at_ms, slot_name LIMIT 1`).toArray()[0];
    if (!row) return null;
    this.forgetSlot(row.slot_name);
    this.sql.exec(`INSERT INTO standby_claim_tombstone
      (claim_id, slot_name, claimed_at_ms, check_at_ms) VALUES (?, ?, ?, ?)`,
    claimId, row.slot_name, now, now + HOSTED_STANDBY_ORPHAN_GRACE_MS);
    return row.slot_name;
  }

  rememberDrain(slotName: string, now: number): void {
    this.sql.exec(`INSERT INTO standby_coordinator_slot (slot_name, phase, check_at_ms)
      VALUES (?, 'draining', ?) ON CONFLICT(slot_name) DO UPDATE
      SET phase = 'draining', check_at_ms = excluded.check_at_ms`, slotName, now);
  }

  makeDrainDue(slotName: string, now: number): void {
    this.sql.exec(`UPDATE standby_coordinator_slot SET check_at_ms = ?
      WHERE slot_name = ? AND phase = 'draining'`, now, slotName);
  }

  takeCleanupBatch(now: number, preparing: ReadonlySet<string>): CleanupTarget[] {
    const slots = this.sql.exec<StandbySlotRow>(`SELECT slot_name, phase, check_at_ms
      FROM standby_coordinator_slot WHERE phase = 'draining' AND check_at_ms <= ?
      ORDER BY check_at_ms, slot_name LIMIT ?`, now,
    STANDBY_CLEANUP_BATCH_SIZE + STANDBY_PARALLELISM).toArray()
      .filter((row) => !preparing.has(row.slot_name)).slice(0, STANDBY_CLEANUP_BATCH_SIZE);
    const claims = this.sql.exec<StandbyClaimRow>(`SELECT claim_id, slot_name
      FROM standby_claim_tombstone WHERE check_at_ms <= ?
      ORDER BY check_at_ms, claim_id LIMIT ?`, now, STANDBY_CLEANUP_BATCH_SIZE).toArray();
    // Move attempted records behind untouched records before I/O, so one bad
    // target cannot monopolize the indexed batch after retries or a reset.
    for (const slot of slots) this.makeDrainDue(slot.slot_name, now + HOSTED_STANDBY_RETRY_MS);
    for (const claim of claims) this.sql.exec(
      "UPDATE standby_claim_tombstone SET check_at_ms = ? WHERE claim_id = ?",
      now + HOSTED_STANDBY_RETRY_MS, claim.claim_id,
    );
    return [
      ...slots.map((slot) => ({ slotName: slot.slot_name })),
      ...claims.map((claim) => ({ slotName: claim.slot_name, claimId: claim.claim_id })),
    ];
  }

  forgetSlot(slotName: string): void {
    this.sql.exec("DELETE FROM standby_coordinator_slot WHERE slot_name = ?", slotName);
  }

  deleteClaim(claimId: string): void {
    this.sql.exec("DELETE FROM standby_claim_tombstone WHERE claim_id = ?", claimId);
  }

  hasWork(): boolean {
    return this.sql.exec<{ present: number }>(`SELECT
      EXISTS (SELECT 1 FROM standby_coordinator_slot)
      OR EXISTS (SELECT 1 FROM standby_claim_tombstone) AS present`).toArray()[0]?.present === 1;
  }

  nextProofAt(): number | null {
    return this.sql.exec<{ check_at_ms: number }>(`SELECT check_at_ms
      FROM standby_coordinator_slot WHERE phase = 'ready'
      ORDER BY check_at_ms LIMIT 1`).toArray()[0]?.check_at_ms ?? null;
  }

  private selectMeta(): StandbyCoordinatorMetaRow | null {
    return this.sql.exec<StandbyCoordinatorMetaRow>(`SELECT release_id, region
      FROM standby_coordinator_meta WHERE singleton = 1`).toArray()[0] ?? null;
  }
}

async function withRpcDeadline<T>(
  operation: () => Promise<T>, timeoutMs: number, onLateSettlement?: () => void,
): Promise<T> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(operation);
  // Both branches observe settlement; a rejected late RPC is not unhandled.
  void work.then(() => { if (timedOut) onLateSettlement?.(); },
    () => { if (timedOut) onLateSettlement?.(); });
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("Hosted standby RPC deadline exceeded."));
      }, timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function requireReleaseAndRegion(input: { releaseId: string; region: string }): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.releaseId)) {
    throw new TypeError("Hosted standby release id is invalid.");
  }
  if (input.region !== HOSTED_RUNNER_REGION && input.region !== HOSTED_STANDBY_REGION) {
    throw new TypeError("Hosted standby region is invalid.");
  }
}
