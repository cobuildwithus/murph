import {
  registerHostedRunnerContainerOutboundInterception,
  RunnerContainer,
  type HostedExecutionContainerInvokeRequest,
  type RunnerContainerBeginShellPrewarmInput,
  type RunnerContainerBeginShellPrewarmResult,
  type RunnerContainerEnsureProcessingInput,
  type RunnerContainerEnsureProcessingResult,
  type RunnerContainerEnsureReadyForProcessingInput,
  type RunnerContainerEnsureReadyForProcessingResult,
  type RunnerContainerPrewarmShellResult,
  type RunnerContainerRuntimeCompletionRecordedInput,
  type RunnerRuntimeWakeInput,
  type RunnerRuntimeWakeResult,
  type RunnerWorkspaceInvocationAbortStatus,
} from "./runner-container.js";
import type { HostedExecutionRunnerJobResult } from "./runner-job-transport.js";
import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "./hosted-runtime-architecture.js";
import {
  HOSTED_STANDBY_REGION,
  isHostedStandbyClaimId,
  isHostedStandbySlotName,
  readHostedStandbyReleaseId,
  type HostedStandbySlotCoordinatorState,
  type HostedStandbySlotBinding,
} from "./standby-runner-contract.js";
import type {
  DurableObjectSqlStorageLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "./user-runner/types.js";

const STANDBY_HEALTH_URL = "http://container/health";
const STANDBY_CODEX_PREFLIGHT_URL =
  "http://container/internal/deploy-codex-shell-smoke";

interface StandbySlotRow extends Record<string, DurableObjectSqlValue> {
  claim_id: string | null;
  release_id: string;
  region: string;
  slot_name: string;
  state: string;
  user_id: string | null;
}

export class StandbyRunnerContainer extends RunnerContainer {
  private readonly standbyStore: StandbyRunnerSlotStore;

  constructor(state: DurableObjectStateLike, env: Readonly<Record<string, unknown>>) {
    super(state, env);
    this.standbyStore = new StandbyRunnerSlotStore(requireSql(state));
    const releaseId = readHostedStandbyReleaseId(env);
    if (releaseId) {
      this.envVars = {
        ...this.envVars,
        HOSTED_EXECUTION_WORKER_RELEASE_ID: releaseId,
      };
    }
  }

  async prepareStandbySlot(input: {
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
    timeoutMs: number;
  }): Promise<{
    prepared: true;
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
  }> {
    this.standbyStore.initialize(input);
    const before = this.standbyStore.read();
    if (before.state !== "unbound") {
      throw new Error("Hosted standby slot is not eligible for preparation.");
    }

    const timeoutMs = requirePositiveTimeout(input.timeoutMs);
    const deadlineAtEpochMs = Date.now() + timeoutMs;
    const readiness = await super.ensureReadyForProcessing({
      timeoutMs: Math.max(1, deadlineAtEpochMs - Date.now()),
      userId: "standby-unbound",
    });
    if (readiness.kind !== "ready") {
      throw new Error("Hosted standby slot readiness cleanup did not settle.");
    }

    let health = await this.readStandbyHealth(deadlineAtEpochMs);
    if (health.codexShellPreflightStatus !== "ready") {
      const remainingMs = requireRemainingTime(deadlineAtEpochMs);
      const response = await this.containerFetch(STANDBY_CODEX_PREFLIGHT_URL, {
        method: "POST",
        signal: AbortSignal.timeout(remainingMs),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("Hosted standby Codex CLI preflight failed.");
      }
      await response.body?.cancel().catch(() => undefined);
      health = await this.readStandbyHealth(deadlineAtEpochMs);
    }
    this.assertPristineStandbyHealth(health, input);

    const after = this.standbyStore.read();
    if (after.state !== "unbound") {
      throw new Error("Hosted standby slot binding changed during preparation.");
    }
    return {
      prepared: true,
      releaseId: after.releaseId,
      region: after.region,
      slotName: after.slotName,
    };
  }

  async bindStandbySlot(input: {
    claimId: string;
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
    userId: string;
  }): Promise<{
    bound: true;
    claimId: string;
    releaseId: string;
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
    userId: string;
  }> {
    const binding = this.standbyStore.bind(input);
    return {
      bound: true,
      claimId: binding.claimId,
      releaseId: binding.releaseId,
      region: binding.region,
      slotName: binding.slotName,
      userId: binding.userId,
    };
  }

  async readStandbySlotBinding(): Promise<HostedStandbySlotBinding> {
    return this.standbyStore.read();
  }

  async readStandbySlotCoordinatorState(): Promise<HostedStandbySlotCoordinatorState> {
    const binding = this.standbyStore.read();
    return {
      coordinatorOwned: binding.userId === null,
      releaseId: binding.releaseId,
      slotName: binding.slotName,
      state: binding.state,
    };
  }

  async retireStandbySlot(input: {
    claimId?: string;
  }): Promise<{ retired: true }> {
    const retirement = this.standbyStore.beginRetirement(input);
    if (retirement === "retired") {
      return { retired: true };
    }
    await this.destroyInstance();
    this.standbyStore.finishRetirement();
    return { retired: true };
  }

  override async invoke(
    payload: HostedExecutionContainerInvokeRequest,
  ): Promise<HostedExecutionRunnerJobResult> {
    this.authorizeBoundUser(payload.userId);
    return await super.invoke(payload);
  }

  override async onRuntimeCompletionRecorded(
    input: RunnerContainerRuntimeCompletionRecordedInput,
  ): Promise<void> {
    this.authorizeBoundUser(input.userId);
    await super.onRuntimeCompletionRecorded(input);
  }

  override async ensureReadyForProcessing(
    payload: RunnerContainerEnsureReadyForProcessingInput,
  ): Promise<RunnerContainerEnsureReadyForProcessingResult> {
    this.authorizeBoundUser(payload.userId);
    return await super.ensureReadyForProcessing(payload);
  }

  override async beginShellPrewarm(
    payload: RunnerContainerBeginShellPrewarmInput,
  ): Promise<RunnerContainerBeginShellPrewarmResult> {
    this.authorizeBoundUser(payload.userId);
    return await super.beginShellPrewarm(payload);
  }

  override async prewarmShell(
    payload: RunnerContainerEnsureReadyForProcessingInput,
  ): Promise<RunnerContainerPrewarmShellResult> {
    this.authorizeBoundUser(payload.userId);
    return await super.prewarmShell(payload);
  }

  override async abortWorkspaceInvocation(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<RunnerWorkspaceInvocationAbortStatus> {
    this.authorizeBoundUser(input.userId);
    return await super.abortWorkspaceInvocation(input);
  }

  override async ensureProcessing(
    input: RunnerContainerEnsureProcessingInput,
  ): Promise<RunnerContainerEnsureProcessingResult> {
    this.authorizeBoundUser(input.userId);
    return await super.ensureProcessing(input);
  }

  override async wakeRuntime(
    input: RunnerRuntimeWakeInput,
  ): Promise<RunnerRuntimeWakeResult> {
    this.authorizeBoundUser(input.userId);
    return await super.wakeRuntime(input);
  }

  override async onActivityExpired(): Promise<void> {
    const binding = this.standbyStore.readOptional();
    if (!binding || binding.state !== "unbound") {
      await super.onActivityExpired();
      return;
    }
    this.renewPlatformActivityTimeout("standby-unbound-ready");
  }

  private authorizeBoundUser(userId: string): void {
    const binding = this.standbyStore.read();
    if (binding.state !== "bound" || binding.userId !== requireUserId(userId)) {
      throw new Error("Hosted standby slot is not bound to the runtime user.");
    }
  }

  private async readStandbyHealth(
    deadlineAtEpochMs: number,
  ): Promise<Record<string, unknown>> {
    const response = await this.containerFetch(STANDBY_HEALTH_URL, {
      method: "GET",
      signal: AbortSignal.timeout(requireRemainingTime(deadlineAtEpochMs)),
    });
    const payload: unknown = await response.json();
    if (!response.ok || !isRecord(payload)) {
      throw new Error("Hosted standby health proof was unavailable.");
    }
    return payload;
  }

  private assertPristineStandbyHealth(
    payload: Record<string, unknown>,
    input: {
      releaseId: string;
      region: typeof HOSTED_STANDBY_REGION;
    },
  ): void {
    const expectedBundleFingerprint = readRequiredEnvironmentString(
      this.environment.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT,
      "HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT",
    );
    const expectedSourceFingerprint = readRequiredEnvironmentString(
      this.environment.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT,
      "HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT",
    );
    const runnerBundle = isRecord(payload.runnerBundle) ? payload.runnerBundle : null;
    const expectedHealthRegion = this.resolveExpectedStandbyHealthRegion(
      input.region,
    );
    const failedChecks: string[] = [];
    if (payload.activeJobCount !== 0) failedChecks.push("active_job_count");
    if (payload.codexShellPreflightStatus !== "ready") {
      failedChecks.push("codex_shell_preflight_status");
    }
    if (typeof payload.codexShellPreflightCompletedAtEpochMs !== "number") {
      failedChecks.push("codex_shell_preflight_completed_at");
    }
    if (payload.cloudflareRegion !== expectedHealthRegion) {
      failedChecks.push("cloudflare_region");
    }
    if (payload.heavyRuntimeHydrationStatus !== "ready") {
      failedChecks.push("heavy_runtime_hydration_status");
    }
    if (payload.hostedRuntimeArchitectureVersion !== HOSTED_RUNTIME_ARCHITECTURE_VERSION) {
      failedChecks.push("hosted_runtime_architecture_version");
    }
    if (payload.hostedWorkerReleaseId !== input.releaseId) {
      failedChecks.push("hosted_worker_release_id");
    }
    if (payload.poisoned !== false) failedChecks.push("poisoned");
    if (payload.workspaceInvocationAcceptedCount !== 0) {
      failedChecks.push("workspace_invocation_accepted_count");
    }
    if (runnerBundle?.bundleFingerprint !== expectedBundleFingerprint) {
      failedChecks.push("runner_bundle_fingerprint");
    }
    if (runnerBundle?.sourceFingerprint !== expectedSourceFingerprint) {
      failedChecks.push("runner_source_fingerprint");
    }
    if (failedChecks.length > 0) {
      throw new Error(
        `Hosted standby slot failed pristine readiness proof: ${failedChecks.join(", ")}.`,
      );
    }
  }

  protected resolveExpectedStandbyHealthRegion(
    region: typeof HOSTED_STANDBY_REGION,
  ): string {
    return region;
  }
}

registerHostedRunnerContainerOutboundInterception(StandbyRunnerContainer);

class StandbyRunnerSlotStore {
  constructor(private readonly sql: DurableObjectSqlStorageLike) {
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
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
  }): void {
    if (!isHostedStandbySlotName(input.slotName)) {
      throw new TypeError("Hosted standby slot name is invalid.");
    }
    if (input.region !== HOSTED_STANDBY_REGION) {
      throw new TypeError("Hosted standby slot region is invalid.");
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
    region: typeof HOSTED_STANDBY_REGION;
    slotName: string;
    userId: string;
  }): Extract<HostedStandbySlotBinding, { state: "bound" }> {
    const existing = this.require();
    assertSameSlot(existing, input);
    const claimId = requireClaimId(input.claimId);
    const userId = requireUserId(input.userId);
    if (existing.state === "bound") {
      if (existing.claim_id === claimId && existing.user_id === userId) {
        return projectBinding(existing) as Extract<
          HostedStandbySlotBinding,
          { state: "bound" }
        >;
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
    return projectBinding(bound) as Extract<
      HostedStandbySlotBinding,
      { state: "bound" }
    >;
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
  if (row.region !== HOSTED_STANDBY_REGION) {
    throw new Error("Hosted standby slot region is invalid.");
  }
  if (row.state === "unbound") {
    if (row.claim_id !== null || row.user_id !== null) {
      throw new Error("Hosted standby unbound slot retained member identity.");
    }
    return {
      claimId: null,
      releaseId: row.release_id,
      region: row.region,
      slotName: row.slot_name,
      state: "unbound",
      userId: null,
    };
  }
  if (row.state === "bound") {
    return {
      claimId: requireClaimId(row.claim_id),
      releaseId: row.release_id,
      region: row.region,
      slotName: row.slot_name,
      state: "bound",
      userId: requireUserId(row.user_id),
    };
  }
  if (row.state === "retiring") {
    if ((row.claim_id === null) !== (row.user_id === null)) {
      throw new Error("Hosted standby retiring slot identity is incomplete.");
    }
    return {
      claimId: row.claim_id === null ? null : requireClaimId(row.claim_id),
      releaseId: row.release_id,
      region: row.region,
      slotName: row.slot_name,
      state: "retiring",
      userId: row.user_id === null ? null : requireUserId(row.user_id),
    };
  }
  if (row.state === "retired") {
    if (row.claim_id !== null || row.user_id !== null) {
      throw new Error("Hosted standby retired slot retained member identity.");
    }
    return {
      claimId: null,
      releaseId: row.release_id,
      region: row.region,
      slotName: row.slot_name,
      state: "retired",
      userId: null,
    };
  }
  throw new Error("Hosted standby slot state is invalid.");
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

function requireUserId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    throw new TypeError("Hosted standby user id is invalid.");
  }
  return value;
}

function requirePositiveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 120_000) {
    throw new TypeError("Hosted standby readiness timeout is invalid.");
  }
  return value;
}

function requireRemainingTime(deadlineAtEpochMs: number): number {
  const remainingMs = deadlineAtEpochMs - Date.now();
  if (remainingMs <= 0) {
    throw new DOMException("Hosted standby readiness timed out.", "TimeoutError");
  }
  return remainingMs;
}

function requireSql(state: DurableObjectStateLike): DurableObjectSqlStorageLike {
  if (!state.storage.sql) {
    throw new Error("Hosted standby slot requires Durable Object SQLite storage.");
  }
  return state.storage.sql;
}

function readRequiredEnvironmentString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} is required for hosted standby readiness.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
