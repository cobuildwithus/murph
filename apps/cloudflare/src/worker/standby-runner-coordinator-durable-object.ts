import { DurableObject } from "cloudflare:workers";

import {
  HOSTED_STANDBY_LOCATION_HINT,
  HOSTED_STANDBY_ORPHAN_GRACE_MS,
  HOSTED_STANDBY_READY_TIMEOUT_MS,
  HOSTED_STANDBY_REGION,
  HOSTED_STANDBY_RETRY_MS,
  createHostedStandbySlotName,
  isHostedStandbyClaimId,
  readHostedStandbyMode,
  readHostedStandbyReleaseId,
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

interface StandbyCoordinatorEnvironment extends Readonly<Record<string, unknown>> {
  STANDBY_RUNNER_CONTAINER?: HostedStandbyRunnerContainerNamespaceLike;
}

interface StandbyCoordinatorMetaRow extends Record<string, DurableObjectSqlValue> {
  provisioning_slot_name: string | null;
  ready_slot_name: string | null;
  region: string;
  release_id: string;
}

interface StandbyClaimRow extends Record<string, DurableObjectSqlValue> {
  claim_id: string;
  claimed_at_ms: number;
  slot_name: string;
}

export class StandbyRunnerCoordinatorDurableObject extends DurableObject {
  private backgroundWork: Promise<void> = Promise.resolve();
  private readonly environment: StandbyCoordinatorEnvironment;
  private readonly setAlarm: (scheduledTime: number | Date) => Promise<void>;
  private readonly state: DurableObjectStateLike;
  private readonly store: StandbyRunnerCoordinatorStore;
  private readonly transactionSync: <T>(callback: () => T) => T;

  constructor(
    state: DurableObjectStateLike,
    environment: StandbyCoordinatorEnvironment,
  ) {
    super(state as never, environment as never);
    const sql = state.storage.sql;
    const transactionSync = state.storage.transactionSync;
    if (!sql || !transactionSync) {
      throw new Error("Hosted standby coordinator requires SQLite Durable Object storage.");
    }
    this.environment = environment;
    this.setAlarm = state.storage.setAlarm.bind(state.storage);
    this.state = state;
    this.store = new StandbyRunnerCoordinatorStore(sql);
    this.transactionSync = transactionSync.bind(state.storage);
  }

  claimReadyStandby(input: HostedStandbyClaimRequest): HostedStandbyClaimResult {
    const request = parseClaimRequest(input);
    const releaseId = readHostedStandbyReleaseId(this.environment);
    const mode = readHostedStandbyMode(this.environment);
    if (mode !== "allocate") {
      this.startBackgroundWork();
      return { claimId: request.claimId, outcome: "disabled" };
    }
    if (!releaseId || releaseId !== request.releaseId) {
      this.startBackgroundWork();
      return { claimId: request.claimId, outcome: "stale_release" };
    }
    if (request.deadlineAtEpochMs <= Date.now()) {
      this.startBackgroundWork();
      return { claimId: request.claimId, outcome: "deadline_expired" };
    }

    const slotName = this.transactionSync(() => {
      this.store.initialize({ releaseId, region: request.region });
      return this.store.claimReadySlot({
        claimId: request.claimId,
        claimedAtMs: Date.now(),
      });
    });
    this.startBackgroundWork();
    return slotName
      ? {
          claimId: request.claimId,
          outcome: "claimed",
          releaseId,
          region: request.region,
          slotName,
        }
      : { claimId: request.claimId, outcome: "no_ready_slot" };
  }

  ensureReadyStandby(input: {
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
  }): { accepted: true } {
    requireReleaseAndRegion(input);
    this.transactionSync(() => {
      this.store.initialize(input);
    });
    this.startBackgroundWork();
    return { accepted: true };
  }

  readStandbyCoordinatorState(): HostedStandbyCoordinatorState {
    return this.store.readState();
  }

  alarm(): void {
    this.startBackgroundWork();
  }

  private startBackgroundWork(): void {
    const work = this.backgroundWork
      .then(async () => await this.runMaintenance())
      .catch(async () => {
        await this.scheduleAlarm(HOSTED_STANDBY_RETRY_MS);
      });
    this.backgroundWork = work;
    this.state.waitUntil(work);
  }

  private async runMaintenance(): Promise<void> {
    const state = this.store.readState();
    if (!state.releaseId) {
      return;
    }
    const currentReleaseId = readHostedStandbyReleaseId(this.environment);
    const mode = readHostedStandbyMode(this.environment);
    const namespace = this.environment.STANDBY_RUNNER_CONTAINER;
    if (!namespace) {
      await this.scheduleAlarm(HOSTED_STANDBY_RETRY_MS);
      return;
    }

    await this.reconcileClaimTombstones(namespace);
    if (mode === "off" || currentReleaseId !== state.releaseId) {
      const converged = await this.retireCoordinatorOwnedSlots(namespace);
      if (!converged) {
        await this.scheduleAlarm(HOSTED_STANDBY_RETRY_MS);
      }
      return;
    }

    if (state.readySlotName) {
      const ready = await this.reproveReadySlot(namespace, state);
      if (!ready) {
        await this.scheduleAlarm(HOSTED_STANDBY_RETRY_MS);
        return;
      }
    }
    await this.provisionIfNeeded(namespace, state.releaseId);
    await this.scheduleAlarm(STANDBY_READY_REPROBE_MS);
  }

  private async provisionIfNeeded(
    namespace: HostedStandbyRunnerContainerNamespaceLike,
    releaseId: string,
  ): Promise<void> {
    const slotName = this.transactionSync(() => {
      const state = this.store.readState();
      if (state.readySlotName) {
        return null;
      }
      if (state.provisioningSlotName) {
        return state.provisioningSlotName;
      }
      const candidate = createHostedStandbySlotName(releaseId);
      this.store.beginProvisioning(candidate);
      return candidate;
    });
    if (!slotName) {
      return;
    }

    const slot = namespace.getByName(slotName, {
      locationHint: HOSTED_STANDBY_LOCATION_HINT,
    });
    try {
      await slot.prepareStandbySlot({
        releaseId,
        region: HOSTED_STANDBY_REGION,
        slotName,
        timeoutMs: HOSTED_STANDBY_READY_TIMEOUT_MS,
      });
      this.transactionSync(() => {
        this.store.finishProvisioning(slotName);
      });
    } catch {
      await this.reconcileFailedOwnedSlot(slotName, slot);
    }
  }

  private async reproveReadySlot(
    namespace: HostedStandbyRunnerContainerNamespaceLike,
    state: HostedStandbyCoordinatorState,
  ): Promise<boolean> {
    const slotName = state.readySlotName;
    if (!slotName || !state.releaseId) {
      return true;
    }
    const slot = namespace.getByName(slotName, {
      locationHint: HOSTED_STANDBY_LOCATION_HINT,
    });
    try {
      await slot.prepareStandbySlot({
        releaseId: state.releaseId,
        region: HOSTED_STANDBY_REGION,
        slotName,
        timeoutMs: HOSTED_STANDBY_READY_TIMEOUT_MS,
      });
      return true;
    } catch {
      return await this.reconcileFailedOwnedSlot(slotName, slot);
    }
  }

  private async reconcileFailedOwnedSlot(
    slotName: string,
    slot: ReturnType<HostedStandbyRunnerContainerNamespaceLike["getByName"]>,
  ): Promise<boolean> {
    try {
      const binding = await slot.readStandbySlotCoordinatorState();
      if (
        binding.state === "unbound"
        || (binding.state === "retiring" && binding.coordinatorOwned)
      ) {
        await slot.retireStandbySlot({});
      }
      this.transactionSync(() => {
        this.store.forgetOwnedSlot(slotName);
      });
      return true;
    } catch {
      return false;
    }
  }

  private async reconcileClaimTombstones(
    namespace: HostedStandbyRunnerContainerNamespaceLike,
  ): Promise<void> {
    const expired = this.store.readExpiredClaims(
      Date.now() - HOSTED_STANDBY_ORPHAN_GRACE_MS,
    );
    for (const claim of expired) {
      const slot = namespace.getByName(claim.slot_name, {
        locationHint: HOSTED_STANDBY_LOCATION_HINT,
      });
      try {
        const binding = await slot.readStandbySlotCoordinatorState();
        if (
          binding.state === "unbound"
          || (binding.state === "retiring" && binding.coordinatorOwned)
        ) {
          await slot.retireStandbySlot({});
        }
        this.transactionSync(() => {
          this.store.deleteClaim(claim.claim_id);
        });
      } catch {
        // Keep the tombstone and retry the exact target on the next alarm.
      }
    }
  }

  private async retireCoordinatorOwnedSlots(
    namespace: HostedStandbyRunnerContainerNamespaceLike,
  ): Promise<boolean> {
    const state = this.store.readState();
    const targets = new Set(
      [state.readySlotName, state.provisioningSlotName].filter(
        (value): value is string => Boolean(value),
      ),
    );
    let converged = true;
    for (const slotName of targets) {
      const slot = namespace.getByName(slotName, {
        locationHint: HOSTED_STANDBY_LOCATION_HINT,
      });
      try {
        const binding = await slot.readStandbySlotCoordinatorState();
        if (
          binding.state === "unbound"
          || (binding.state === "retiring" && binding.coordinatorOwned)
        ) {
          await slot.retireStandbySlot({});
        }
        this.transactionSync(() => {
          this.store.forgetOwnedSlot(slotName);
        });
      } catch {
        converged = false;
      }
    }
    return converged;
  }

  private async scheduleAlarm(delayMs: number): Promise<void> {
    try {
      await this.setAlarm(Date.now() + delayMs);
    } catch {
      // The next scheduled Worker tick is the independent bootstrap backstop.
    }
  }
}

class StandbyRunnerCoordinatorStore {
  constructor(private readonly sql: DurableObjectSqlStorageLike) {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS standby_coordinator_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        release_id TEXT NOT NULL,
        region TEXT NOT NULL,
        ready_slot_name TEXT,
        provisioning_slot_name TEXT
      )
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS standby_claim_tombstone (
        claim_id TEXT PRIMARY KEY,
        slot_name TEXT NOT NULL,
        claimed_at_ms INTEGER NOT NULL
      )
    `);
  }

  initialize(input: {
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
  }): void {
    requireReleaseAndRegion(input);
    const existing = this.selectMeta();
    if (existing) {
      if (existing.release_id !== input.releaseId || existing.region !== input.region) {
        throw new Error("Hosted standby coordinator identity is immutable.");
      }
      return;
    }
    this.sql.exec(
      `INSERT INTO standby_coordinator_meta (
        singleton, release_id, region, ready_slot_name, provisioning_slot_name
      ) VALUES (1, ?, ?, NULL, NULL)`,
      input.releaseId,
      input.region,
    );
  }

  readState(): HostedStandbyCoordinatorState {
    const row = this.selectMeta();
    if (!row) {
      return {
        provisioningSlotName: null,
        readySlotName: null,
        releaseId: null,
        region: HOSTED_STANDBY_REGION,
      };
    }
    if (row.region !== HOSTED_STANDBY_REGION) {
      throw new Error("Hosted standby coordinator region is invalid.");
    }
    return {
      provisioningSlotName: row.provisioning_slot_name,
      readySlotName: row.ready_slot_name,
      releaseId: row.release_id,
      region: row.region,
    };
  }

  beginProvisioning(slotName: string): void {
    this.sql.exec(
      `UPDATE standby_coordinator_meta
       SET provisioning_slot_name = ?
       WHERE singleton = 1
         AND ready_slot_name IS NULL
         AND provisioning_slot_name IS NULL`,
      slotName,
    );
  }

  finishProvisioning(slotName: string): void {
    this.sql.exec(
      `UPDATE standby_coordinator_meta
       SET ready_slot_name = ?, provisioning_slot_name = NULL
       WHERE singleton = 1 AND provisioning_slot_name = ?`,
      slotName,
      slotName,
    );
    if (this.readState().readySlotName !== slotName) {
      throw new Error("Hosted standby provisioning result was superseded.");
    }
  }

  claimReadySlot(input: { claimId: string; claimedAtMs: number }): string | null {
    const state = this.readState();
    const slotName = state.readySlotName;
    if (!slotName) {
      return null;
    }
    this.sql.exec(
      `UPDATE standby_coordinator_meta
       SET ready_slot_name = NULL
       WHERE singleton = 1 AND ready_slot_name = ?`,
      slotName,
    );
    if (this.readState().readySlotName !== null) {
      return null;
    }
    this.sql.exec(
      `INSERT INTO standby_claim_tombstone (claim_id, slot_name, claimed_at_ms)
       VALUES (?, ?, ?)`,
      input.claimId,
      slotName,
      input.claimedAtMs,
    );
    return slotName;
  }

  forgetOwnedSlot(slotName: string): void {
    this.sql.exec(
      `UPDATE standby_coordinator_meta
       SET ready_slot_name = CASE WHEN ready_slot_name = ? THEN NULL ELSE ready_slot_name END,
           provisioning_slot_name = CASE
             WHEN provisioning_slot_name = ? THEN NULL ELSE provisioning_slot_name END
       WHERE singleton = 1`,
      slotName,
      slotName,
    );
  }

  readExpiredClaims(cutoffMs: number): StandbyClaimRow[] {
    return this.sql.exec<StandbyClaimRow>(
      `SELECT claim_id, slot_name, claimed_at_ms
       FROM standby_claim_tombstone
       WHERE claimed_at_ms <= ?
       ORDER BY claimed_at_ms ASC`,
      cutoffMs,
    ).toArray();
  }

  deleteClaim(claimId: string): void {
    this.sql.exec(
      "DELETE FROM standby_claim_tombstone WHERE claim_id = ?",
      claimId,
    );
  }

  private selectMeta(): StandbyCoordinatorMetaRow | null {
    return this.sql.exec<StandbyCoordinatorMetaRow>(
      `SELECT release_id, region, ready_slot_name, provisioning_slot_name
       FROM standby_coordinator_meta
       WHERE singleton = 1`,
    ).toArray()[0] ?? null;
  }
}

function parseClaimRequest(input: HostedStandbyClaimRequest): HostedStandbyClaimRequest {
  requireReleaseAndRegion(input);
  if (!isHostedStandbyClaimId(input.claimId)) {
    throw new TypeError("Hosted standby claim id is invalid.");
  }
  if (!Number.isSafeInteger(input.deadlineAtEpochMs) || input.deadlineAtEpochMs <= 0) {
    throw new TypeError("Hosted standby claim deadline is invalid.");
  }
  return input;
}

function requireReleaseAndRegion(input: {
  releaseId: string;
  region: string;
}): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.releaseId)) {
    throw new TypeError("Hosted standby release id is invalid.");
  }
  if (input.region !== HOSTED_STANDBY_REGION) {
    throw new TypeError("Hosted standby region is invalid.");
  }
}
