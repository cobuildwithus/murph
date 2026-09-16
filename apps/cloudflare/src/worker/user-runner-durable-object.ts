import { commandHostedRuntimeMigration } from "../runtime-migration-client.ts";
import { observeLegacyRuntime } from "../user-runner/legacy-runtime-observation.ts";
import { requireLegacyRuntimeStorageCoverage, readLegacyRuntimeMigrationIdentity, readLegacyRuntimeExportPage, type LegacyRuntimeExportCursor } from "../user-runner/legacy-runtime-export.ts";
import { LegacyRuntimeFreeze, LegacyRuntimeFrozenError } from "../user-runner/legacy-runtime-freeze.ts";
import { commandHostedRuntimeOwner } from "../runtime-owner-client.ts";
import { DurableObject } from "cloudflare:workers";
import type {
  HostedRuntimeLatencyPhaseBreakdown,
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";

import {
  readHostedExecutionEnvironment,
} from "../env.ts";
import {
  notFound,
} from "../json.ts";
import {
  HostedUserRunner,
} from "../user-runner.ts";
import type {
  DurableObjectStateLike,
} from "../user-runner.ts";
import {
  asWorkerStringEnvironment,
} from "../worker-contracts.ts";
import {
  createHostedRunnerContainerNamespaceRouter,
} from "../standby-runner-contract.ts";
import type {
  UserRunnerDurableObjectStubLike,
  WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";

export class UserRunnerDurableObject extends DurableObject implements UserRunnerDurableObjectStubLike {
  private readonly activationTiming: {
    userRunnerConstructorStartedAtEpochMs: number;
    userRunnerConstructorFinishedAtEpochMs: number;
  };
  private userRunnerFirstEnsureRuntimeProcessingAtEpochMs: number | null = null;
  private initializedRunner: HostedUserRunner | undefined;
  private readonly trackedState: DurableObjectStateLike;
  private readonly migrationFreeze: LegacyRuntimeFreeze;
  private readonly source: WorkerEnvironmentSource;
  private readonly migrationState: DurableObjectStateLike;

  constructor(
    state: DurableObjectStateLike,
    env: WorkerEnvironmentSource,
    runner?: HostedUserRunner,
  ) {
    const userRunnerConstructorStartedAtEpochMs = Date.now();
    super(state as never, env as never);
    this.source = env;
    this.migrationState = state;
    this.migrationFreeze = new LegacyRuntimeFreeze(state);
    this.trackedState = { storage: state.storage, waitUntil: promise => {
      state.waitUntil(this.migrationFreeze.track(promise));
    } };
    this.initializedRunner = runner;
    this.activationTiming = {
      userRunnerConstructorStartedAtEpochMs,
      userRunnerConstructorFinishedAtEpochMs: Date.now(),
    };
  }

  private get runner(): HostedUserRunner {
    return this.initializedRunner ??= createHostedUserRunner(this.trackedState, this.source);
  }

  async inspectPostgresMigration() {
    const observation = await observeLegacyRuntime(this.migrationState);
    return { ...observation, freeze: await this.migrationFreeze.observe() };
  }

  async bindUser(userId: string): Promise<{ userId: string }> {
    return this.migrationFreeze.run(() => this.runner.bindUser(userId));
  }

  async deleteHostedUserData(userId: string): ReturnType<HostedUserRunner["deleteHostedUserData"]> {
    return this.migrationFreeze.run(() => this.runner.deleteHostedUserData(userId));
  }

  async reconcileRuntimeHealthDataConsentForUser(
    userId: string,
  ): ReturnType<HostedUserRunner["reconcileRuntimeHealthDataConsentForUser"]> {
    return this.migrationFreeze.run(() => this.runner.reconcileRuntimeHealthDataConsentForUser(userId));
  }

  async publishHostedPrivateMedia(
    input: Parameters<HostedUserRunner["publishHostedPrivateMedia"]>[0],
  ): ReturnType<HostedUserRunner["publishHostedPrivateMedia"]> {
    return this.migrationFreeze.run(() => this.runner.publishHostedPrivateMedia(input));
  }

  async runnerStatus(input?: { logLimit?: number }): Promise<HostedRunnerStatusResponse> {
    return this.migrationFreeze.run(() => this.runner.runnerStatus(input));
  }

  async ensureRuntimeProcessingForUser(
    input: HostedRuntimeEnsureProcessingRequest & {
      commandStartedAtEpochMs?: number;
      commandTimeoutMs?: number;
      orchestration?: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> | null;
      userId: string;
    },
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    const userRunnerRpcStartedAtEpochMs = Date.now();
    const firstEnsureAt = this.userRunnerFirstEnsureRuntimeProcessingAtEpochMs ??=
      userRunnerRpcStartedAtEpochMs;

    const gate = await commandHostedRuntimeOwner({ source: this.source, userId: input.userId, command: { operation: "reconcile" } });
    if (gate.cutover !== "legacy") return { kind: "retry_later", retryAt: new Date(Date.now() + 3_000).toISOString() };
    return this.migrationFreeze.runAdmission(() => this.runner.ensureRuntimeProcessingForUser({
      ...input,
      orchestration: {
        ...(input.orchestration ?? {}),
        ...this.activationTiming,
        userRunnerFirstEnsureRuntimeProcessingAtEpochMs: firstEnsureAt,
        userRunnerRpcStartedAtEpochMs,
      },
    })).catch((error: unknown) => {
      if (!(error instanceof LegacyRuntimeFrozenError)) throw error;
      return { kind: "retry_later", retryAt: new Date(Date.now() + 3_000).toISOString() };
    });
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean> {
    return this.migrationFreeze.run(() => this.runner.validateRuntimeWriteFence(input));
  }

  async admitHostedMediaRead(
    input: Parameters<HostedUserRunner["admitHostedMediaRead"]>[0],
  ): ReturnType<HostedUserRunner["admitHostedMediaRead"]> {
    return this.migrationFreeze.run(() => this.runner.admitHostedMediaRead(input));
  }

  async recordHostedMediaAsset(
    input: Parameters<HostedUserRunner["recordHostedMediaAsset"]>[0],
  ): ReturnType<HostedUserRunner["recordHostedMediaAsset"]> {
    return this.migrationFreeze.run(() => this.runner.recordHostedMediaAsset(input));
  }

  async forgetHostedMediaAsset(
    input: Parameters<HostedUserRunner["forgetHostedMediaAsset"]>[0],
  ): ReturnType<HostedUserRunner["forgetHostedMediaAsset"]> {
    return this.migrationFreeze.run(() => this.runner.forgetHostedMediaAsset(input));
  }

  async revokeActiveRuntimePlatformAiUsage(
    input: Parameters<HostedUserRunner["revokeActiveRuntimePlatformAiUsage"]>[0],
  ): ReturnType<HostedUserRunner["revokeActiveRuntimePlatformAiUsage"]> {
    return this.migrationFreeze.run(() => this.runner.revokeActiveRuntimePlatformAiUsage(input));
  }

  async recordRunnerContainerRetired(
    input: Parameters<HostedUserRunner["recordRunnerContainerRetired"]>[0],
  ): ReturnType<HostedUserRunner["recordRunnerContainerRetired"]> {
    return this.migrationFreeze.run(() => this.runner.recordRunnerContainerRetired(input));
  }

  async recordRuntimeCompletionFromContainer(
    input: Parameters<HostedUserRunner["recordRuntimeCompletionFromContainer"]>[0],
  ): ReturnType<HostedUserRunner["recordRuntimeCompletionFromContainer"]> {
    return this.migrationFreeze.run(() => this.runner.recordRuntimeCompletionFromContainer(input));
  }

  async validateRuntimeProviderEgressToken(input: {
    providerEgressToken: string;
    userId: string;
  }): ReturnType<HostedUserRunner["validateRuntimeProviderEgressToken"]> {
    return this.migrationFreeze.run(() => this.runner.validateRuntimeProviderEgressToken(input));
  }

  async validateRuntimeProviderEgressCredential(input: {
    providerKind: string;
    runnerContainerName: string;
    userId: string;
  }): ReturnType<HostedUserRunner["validateRuntimeProviderEgressCredential"]> {
    return this.migrationFreeze.run(() => this.runner.validateRuntimeProviderEgressCredential(input));
  }

  async createHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["createHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["createHostedWorkspaceSnapshotUploadSession"]> {
    return this.migrationFreeze.run(() => this.runner.createHostedWorkspaceSnapshotUploadSession(input));
  }

  async manageHostedWorkspaceSnapshotUpload(input: Parameters<HostedUserRunner["manageHostedWorkspaceSnapshotUpload"]>[0]) {
    return this.migrationFreeze.run(() => this.runner.manageHostedWorkspaceSnapshotUpload(input));
  }

  async heartbeatHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["heartbeatHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["heartbeatHostedWorkspaceSnapshotUploadSession"]> {
    return this.migrationFreeze.run(() => this.runner.heartbeatHostedWorkspaceSnapshotUploadSession(input));
  }

  async completeHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["completeHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["completeHostedWorkspaceSnapshotUploadSession"]> {
    return this.migrationFreeze.run(() => this.runner.completeHostedWorkspaceSnapshotUploadSession(input));
  }

  async rememberHostedWorkspaceSnapshotReplacedRef(
    input: Parameters<HostedUserRunner["rememberHostedWorkspaceSnapshotReplacedRef"]>[0],
  ): ReturnType<HostedUserRunner["rememberHostedWorkspaceSnapshotReplacedRef"]> {
    return this.migrationFreeze.run(() => this.runner.rememberHostedWorkspaceSnapshotReplacedRef(input));
  }

  async rememberHostedWorkspaceSnapshotPresignedPut(
    input: Parameters<HostedUserRunner["rememberHostedWorkspaceSnapshotPresignedPut"]>[0],
  ): ReturnType<HostedUserRunner["rememberHostedWorkspaceSnapshotPresignedPut"]> {
    return this.migrationFreeze.run(() => this.runner.rememberHostedWorkspaceSnapshotPresignedPut(input));
  }

  async admitHostedBrowserVaultReplicaDirectPut(
    input: Parameters<HostedUserRunner["admitHostedBrowserVaultReplicaDirectPut"]>[0],
  ): ReturnType<HostedUserRunner["admitHostedBrowserVaultReplicaDirectPut"]> {
    return this.migrationFreeze.run(() => this.runner.admitHostedBrowserVaultReplicaDirectPut(input));
  }

  async releaseHostedBrowserVaultReplicaDirectPut(
    input: Parameters<HostedUserRunner["releaseHostedBrowserVaultReplicaDirectPut"]>[0],
  ): ReturnType<HostedUserRunner["releaseHostedBrowserVaultReplicaDirectPut"]> {
    return this.migrationFreeze.run(() => this.runner.releaseHostedBrowserVaultReplicaDirectPut(input));
  }

  async readHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["readHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["readHostedWorkspaceSnapshotUploadSession"]> {
    return this.migrationFreeze.run(() => this.runner.readHostedWorkspaceSnapshotUploadSession(input));
  }

  async deleteHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["deleteHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["deleteHostedWorkspaceSnapshotUploadSession"]> {
    return this.migrationFreeze.run(() => this.runner.deleteHostedWorkspaceSnapshotUploadSession(input));
  }

  async recordHostedWorkspaceSnapshotOrphanCandidate(
    input: Parameters<HostedUserRunner["recordHostedWorkspaceSnapshotOrphanCandidate"]>[0],
  ): ReturnType<HostedUserRunner["recordHostedWorkspaceSnapshotOrphanCandidate"]> {
    return this.migrationFreeze.run(() => this.runner.recordHostedWorkspaceSnapshotOrphanCandidate(input));
  }

  async recordHostedBrowserVaultReplicaOrphanCandidate(
    input: Parameters<HostedUserRunner["recordHostedBrowserVaultReplicaOrphanCandidate"]>[0],
  ): ReturnType<HostedUserRunner["recordHostedBrowserVaultReplicaOrphanCandidate"]> {
    return this.migrationFreeze.run(() => this.runner.recordHostedBrowserVaultReplicaOrphanCandidate(input));
  }

  async freezeForPostgresMigration(): Promise<{ frozen: boolean }> {
    const result = await commandHostedRuntimeMigration({ source: this.source, command: { operation: "status" } });
    const gate = result.gate;
    if (!gate || typeof gate !== "object" || !("phase" in gate) || gate.phase !== "draining") {
      throw new Error("Legacy freeze requires the durable draining gate.");
    }
    // The legacy fleet protocol initialized the schema on construction. Keep
    // that mutation at its authorized freeze entry, never at live inspection.
    const runner = this.runner;
    // Derive identity from this exact object, including resource-only records.
    return { frozen: await this.migrationFreeze.freeze({
      stop: async () => {
        const { userId } = await readLegacyRuntimeMigrationIdentity(this.migrationState);
        if (userId) await runner.stopLegacyRuntimeForMigration(userId);
      },
      drained: async () => {
        const { userId } = await readLegacyRuntimeMigrationIdentity(this.migrationState);
        const drained = userId === null || await runner.legacyRuntimeUploadsDrained(userId);
        await requireLegacyRuntimeStorageCoverage(this.migrationState, true);
        return drained;
      },
    }) };
  }

  async exportPostgresMigrationPage(cursor: LegacyRuntimeExportCursor) {
    await this.migrationFreeze.assertFrozen();
    return readLegacyRuntimeExportPage(this.migrationState, cursor);
  }

  async fetch(): Promise<Response> {
    return notFound();
  }

  async alarm(): Promise<void> {
    try { await this.migrationFreeze.run(() => this.runner.alarm()); }
    catch (error) { if (!(error instanceof LegacyRuntimeFrozenError)) throw error; }
  }
}

function createHostedUserRunner(
  state: DurableObjectStateLike,
  env: WorkerEnvironmentSource,
): HostedUserRunner {
  const runnerContainerNamespace = createHostedRunnerContainerNamespaceRouter({
    exactUser: env.RUNNER_CONTAINER,
    next: env.NEXT_RUNNER_CONTAINER,
    small: env.SMALL_RUNNER_CONTAINER,
    standby: env.STANDBY_RUNNER_CONTAINER ?? null,
  });
  return new HostedUserRunner(
    state,
    readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
    env.BUNDLES,
    env,
    runnerContainerNamespace,
    env.HOSTED_RUNTIME_RETRY_ANALYTICS ?? null,
    env.STANDBY_COORDINATOR ?? null,
  );
}
