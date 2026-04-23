import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  listHostedBundleArtifacts,
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
  type HostedBundleArtifactLocation,
} from "@murphai/runtime-state/node";
import type {
  HostedExecutionRunContext,
  HostedRuntimeEvent,
  HostedExecutionRunnerResult,
  HostedRuntimeDrainRequest,
  HostedIngressEnvelope,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
  isHostedRuntimeTimerWake,
} from "@murphai/hosted-execution";
import {
  refreshAssistantStatusSnapshot,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import { assistantGatewayLocalProjectionSourceReader } from "@murphai/assistant-engine/gateway-local-adapter";
import { createConfiguredDeviceSyncProvidersFromConfigs } from "@murphai/device-syncd/config";
import { createDeviceSyncRegistry } from "@murphai/device-syncd/registry";
import { createDeviceSyncService } from "@murphai/device-syncd/service";
import { exportGatewayProjectionSnapshotLocal } from "@murphai/gateway-local";

import { createHostedArtifactUploadSink } from "./artifacts.ts";
import {
  collectHostedAssistantDeliverySideEffects,
  drainHostedCommittedAssistantDeliveriesAfterCommit,
} from "./callbacks.ts";
import {
  hydrateHostedExecutionDefaultTarget,
} from "./context.ts";
import { executeHostedIngressEvent } from "./events.ts";
import {
  runHostedAssistantRuntimeTimerLane,
  runHostedDeviceSyncWakeLane,
  runHostedNoopSystemWakeLane,
} from "./maintenance.ts";
import type {
  HostedAssistantRuntimeCompletedJobResult,
  HostedAssistantRuntimeJobRequest,
  HostedCommittedExecutionState,
  HostedRestoredExecutionContext,
  HostedMaintenanceMetrics,
  HostedRunDrainMetrics,
  NormalizedHostedAssistantRuntimeConfig,
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { exportHostedPendingAssistantRuntimeIssues } from "./issues.ts";
import { exportHostedPendingAssistantUsage } from "./usage.ts";
import { exportHostedBrowserVaultReplica } from "./browser-vault.ts";
import { stopExecutorOwnedHostedRunMessagingActivityAfterDelivery } from "./typing.ts";
import { computeHostedRunElapsedMs, resolveHostedWake } from "./utils.ts";

const HOSTED_IMMEDIATE_MAINTENANCE_PASS_BUDGET = 8;

interface HostedImmediateMaintenanceDrainState {
  assistantRuntimeNextWakeAt: string | null;
  assistantPending: boolean;
  deviceSyncNextWakeAt: string | null;
  deviceSyncPending: boolean;
}

export async function executeHostedRunDrainForCommit(input: {
  artifactMaterializer?: HostedWorkspaceArtifactMaterializer | null;
  executionContext: AssistantExecutionContext;
  materializedArtifactPaths?: ReadonlySet<string>;
  request: HostedAssistantRuntimeJobRequest;
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
}): Promise<HostedCommittedExecutionState> {
  const { runDrain } = input.request;
  const primaryWake = resolveHostedWake(runDrain);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake: primaryWake,
    details: {
      eventCount: runDrain.events.length,
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
      runTriggerKind: runDrain.triggerKind,
    },
    message: "Hosted runtime executing run drain.",
    phase: "wake.running",
    run: input.request.run ?? null,
  });

  const runExecutionContext = await resolveHostedRunExecutionContext(
    input.executionContext,
  );
  const metrics = createHostedRunDrainMetrics();
  const drainState = createHostedImmediateMaintenanceDrainState(runDrain);

  for (const event of runDrain.events) {
    const wakeHandlingStartedAtMs = Date.now();
    if (isHostedRuntimeTimerWake(event.wake)) {
      metrics.eventsHandled += 1;
      drainState.assistantPending = true;
      drainState.deviceSyncPending = true;
      emitHostedExecutionStructuredLog({
        component: "runtime",
        wake: event.wake,
        details: {
          runDrainRunId: runDrain.runId,
          runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
          wakeHandlerLatencyMs: Date.now() - wakeHandlingStartedAtMs,
          wakeSeq: event.seq,
        },
        message: "Hosted runtime consumed an internal runtime-timer wake.",
        phase: "wake.running",
        run: input.request.run ?? null,
      });
      continue;
    }

    const ingressMetrics = await executeHostedIngressEvent({
      wake: event.wake,
      executionContext: runExecutionContext,
      runtime: input.runtime,
      runtimeEnv: input.runtimeEnv,
      sharePack: event.sharePack ?? null,
      vaultRoot: input.restored.vaultRoot,
      vaultSyncImport: event.vaultSyncImport ?? null,
    });
    mergeHostedRunDrainWakeMetrics(metrics, ingressMetrics);
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake: event.wake,
      details: {
        runDrainRunId: runDrain.runId,
        runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
        wakeHandlerLatencyMs: Date.now() - wakeHandlingStartedAtMs,
        wakeSeq: event.seq,
      },
      message: "Hosted runtime finished run-drain wake handlers.",
      phase: "wake.running",
      run: input.request.run ?? null,
    });

    if (ingressMetrics.ingressLane === "conversation-message") {
      drainState.assistantPending = true;
      const preservedMetrics = await resolveHostedConversationPreservedWakeMetrics({
        wake: event.wake,
        run: input.request.run ?? null,
        runtime: input.runtime,
        vaultRoot: input.restored.vaultRoot,
      });
      mergeHostedRunDrainMaintenanceMetrics(metrics, preservedMetrics);
      drainState.deviceSyncNextWakeAt = earliestHostedWakeAt(
        drainState.deviceSyncNextWakeAt,
        preservedMetrics.nextWakeAt,
      );
      continue;
    }

    if (
      ingressMetrics.ingressLane === "member-activated"
      || ingressMetrics.ingressLane === "member-channels-updated"
    ) {
      drainState.assistantPending = true;
    }

    const maintenanceMetrics = await runHostedSystemWakeFollowupExecution({
      executionContext: runExecutionContext,
      requestId: event.wake.eventId,
      run: input.request.run ?? null,
      runtime: input.runtime,
      vaultRoot: input.restored.vaultRoot,
      wake: event.wake,
    });
    mergeHostedRunDrainMaintenanceMetrics(metrics, maintenanceMetrics);
    if (event.wake.kind === "device-sync.wake") {
      drainState.deviceSyncNextWakeAt = earliestHostedWakeAt(
        drainState.deviceSyncNextWakeAt,
        maintenanceMetrics.nextWakeAt,
      );
    }
  }

  await drainHostedImmediateMaintenanceUntilIdleOrBudget({
    drainState,
    executionContext: runExecutionContext,
    metrics,
    run: input.request.run ?? null,
    runDrain,
    runtime: input.runtime,
    vaultRoot: input.restored.vaultRoot,
    wake: primaryWake,
  });
  metrics.nextWakeAt = earliestHostedWakeAt(
    metrics.nextWakeAt,
    drainState.assistantRuntimeNextWakeAt,
    drainState.deviceSyncNextWakeAt,
  );

  const snapshotStartedAtMs = Date.now();
  const committedSnapshot = await snapshotHostedExecutionContext({
    artifactSink: createHostedArtifactUploadSink({
      artifactStore: input.runtime.platform.artifactStore,
      knownArtifactHashes: collectHostedBundleArtifactHashes(
        decodeHostedBundleBase64(input.request.bundle),
      ),
    }),
    operatorHomeRoot: input.restored.operatorHomeRoot,
    preservedArtifacts: collectPreservedHostedArtifacts({
      bytes: decodeHostedBundleBase64(input.request.bundle),
      materializedArtifactPaths: input.materializedArtifactPaths ?? new Set(),
    }),
    vaultRoot: input.restored.vaultRoot,
  });
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake: primaryWake,
    details: {
      eventsHandled: metrics.eventsHandled,
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
      snapshotLatencyMs: Date.now() - snapshotStartedAtMs,
    },
    message: "Hosted runtime snapshotted run-drain execution context.",
    phase: "commit.recorded",
    run: input.request.run ?? null,
  });
  const committedAssistantDeliveryEffects = await collectHostedAssistantDeliverySideEffects(
    input.restored.vaultRoot,
  );
  const committedGatewayProjectionSnapshot = await exportGatewayProjectionSnapshotLocal(
    input.restored.vaultRoot,
    {
      sourceReader: assistantGatewayLocalProjectionSourceReader,
    },
  ).catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake: primaryWake,
      error,
      level: "warn",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
      },
      message:
        "Hosted runtime could not export the committed gateway projection snapshot for a run drain; continuing without it.",
      phase: "commit.recorded",
      run: input.request.run ?? null,
    });
    return null;
  });

  return {
    committedGatewayProjectionSnapshot,
    committedResult: {
      bundle: encodeHostedBundleBase64(committedSnapshot.bundle),
      result: {
        eventsHandled: metrics.eventsHandled,
        nextWakeAt: metrics.nextWakeAt,
        redactedDetails: buildHostedRunDrainRedactedDetails(metrics),
        ...(metrics.redactedLogEntries.length === 0
          ? {}
          : { redactedLogEntries: metrics.redactedLogEntries }),
        summary: summarizeHostedRunDrain(runDrain, metrics),
      },
    },
    committedAssistantDeliveryEffects,
  };
}

export async function completeHostedRunDrainAfterCommit(input: {
  materializedArtifactPaths?: ReadonlySet<string>;
  run?: HostedExecutionRunContext | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "resolvedConfig" | "userEnv"
  >;
  restored: HostedRestoredExecutionContext;
  request: HostedAssistantRuntimeJobRequest;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantRuntimeCompletedJobResult> {
  const { runDrain } = input.request;

  const committedAssistantDeliveryEffects = await collectHostedAssistantDeliverySideEffects(
    input.restored.vaultRoot,
  );

  return finalizeHostedCommittedRunAfterCommit({
    materializedArtifactPaths: input.materializedArtifactPaths,
    run: input.run ?? null,
    runtime: input.runtime,
    restored: input.restored,
    committedExecution: {
      committedAssistantDeliveryEffects,
      committedGatewayProjectionSnapshot: null,
        committedResult: {
          bundle: input.request.bundle,
          result: {
            eventsHandled: runDrain.events.length,
            summary: "Finalized committed hosted run side effects.",
          },
        },
    },
    wake: input.wake,
  });
}

async function resolveHostedRunExecutionContext(
  executionContext: AssistantExecutionContext,
): Promise<AssistantExecutionContext> {
  return hydrateHostedExecutionDefaultTarget(executionContext);
}

function createHostedRunDrainMetrics(): HostedRunDrainMetrics {
  return {
    bootstrapResult: null,
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    eventsHandled: 0,
    nextWakeAt: null,
    parserProcessed: 0,
    redactedLogEntries: [],
    shareImportResult: null,
    shareImportTitle: null,
    vaultSyncImportResult: null,
    vaultSyncImportResults: [],
  };
}

function createHostedImmediateMaintenanceDrainState(
  runDrain: HostedRuntimeDrainRequest,
): HostedImmediateMaintenanceDrainState {
  const pendingRuntimeTimerWork = runDrain.events.length === 0
    && runDrain.triggerKind === "runtime_timer";

  return {
    assistantRuntimeNextWakeAt: null,
    assistantPending: pendingRuntimeTimerWork,
    deviceSyncNextWakeAt: null,
    deviceSyncPending: pendingRuntimeTimerWork,
  };
}

function mergeHostedRunDrainWakeMetrics(
  target: HostedRunDrainMetrics,
  metrics: Awaited<ReturnType<typeof executeHostedIngressEvent>>,
): void {
  target.bootstrapResult ??= metrics.bootstrapResult;
  target.eventsHandled += 1;
  target.parserProcessed += metrics.conversationMetrics?.parserProcessed ?? 0;
  target.nextWakeAt = earliestHostedWakeAt(
    target.nextWakeAt,
    metrics.conversationMetrics?.nextWakeAt ?? null,
  );
  const redactedLogEntries = metrics.redactedLogEntries ?? [];
  if (redactedLogEntries.length > 0) {
    target.redactedLogEntries.push(...redactedLogEntries);
  }

  if (metrics.shareImportResult) {
    target.shareImportResult = metrics.shareImportResult;
    target.shareImportTitle = metrics.shareImportTitle;
  }

  if (metrics.vaultSyncImportResult) {
    target.vaultSyncImportResult = metrics.vaultSyncImportResult;
    target.vaultSyncImportResults.push(metrics.vaultSyncImportResult);
  }
}

function mergeHostedRunDrainMaintenanceMetrics(
  target: HostedRunDrainMetrics,
  metrics: HostedMaintenanceMetrics,
): void {
  target.deviceSyncProcessed += metrics.deviceSyncProcessed;
  target.deviceSyncSkipped = target.deviceSyncSkipped && metrics.deviceSyncSkipped;
  target.parserProcessed += metrics.parserProcessed;
}

async function drainHostedImmediateMaintenanceUntilIdleOrBudget(input: {
  drainState: HostedImmediateMaintenanceDrainState;
  executionContext: AssistantExecutionContext;
  metrics: HostedRunDrainMetrics;
  run?: HostedExecutionRunContext | null;
  runDrain: HostedRuntimeDrainRequest;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig"
  >;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<void> {
  let remainingPassBudget = HOSTED_IMMEDIATE_MAINTENANCE_PASS_BUDGET;

  while (remainingPassBudget > 0) {
    let ranPass = false;

    if (
      input.drainState.assistantPending
      || isHostedWakeDueNow(input.drainState.assistantRuntimeNextWakeAt)
    ) {
      ranPass = true;
      remainingPassBudget -= 1;
      input.drainState.assistantPending = false;
      input.drainState.assistantRuntimeNextWakeAt = null;

      const assistantMetrics = await runHostedAssistantRuntimeTimerLane({
        executionContext: input.executionContext,
        requestId: `${input.runDrain.runId}:assistant`,
        runtime: {
          platform: input.runtime.platform,
        },
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
      mergeHostedRunDrainMaintenanceMetrics(input.metrics, assistantMetrics);
      input.drainState.assistantRuntimeNextWakeAt = assistantMetrics.nextWakeAt;
    }

    if (
      remainingPassBudget > 0
      && (
        input.drainState.deviceSyncPending
        || isHostedWakeDueNow(input.drainState.deviceSyncNextWakeAt)
      )
    ) {
      ranPass = true;
      remainingPassBudget -= 1;
      input.drainState.deviceSyncPending = false;
      input.drainState.deviceSyncNextWakeAt = null;

      const deviceSyncMetrics = await runHostedDeviceSyncWakeLane({
        deviceSyncPort: input.runtime.platform.deviceSyncPort,
        resolvedConfig: input.runtime.resolvedConfig,
        timeoutMs: input.runtime.commitTimeoutMs,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
      mergeHostedRunDrainMaintenanceMetrics(input.metrics, deviceSyncMetrics);
      input.drainState.deviceSyncNextWakeAt = deviceSyncMetrics.nextWakeAt;
    }

    if (!ranPass) {
      return;
    }
  }

  if (!hasHostedImmediateMaintenanceWork(input.drainState)) {
    return;
  }

  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake: input.wake,
    level: "warn",
    details: {
      assistantRuntimeNextWakeAt: input.drainState.assistantRuntimeNextWakeAt,
      assistantPending: input.drainState.assistantPending,
      deviceSyncNextWakeAt: input.drainState.deviceSyncNextWakeAt,
      deviceSyncPending: input.drainState.deviceSyncPending,
      passBudget: HOSTED_IMMEDIATE_MAINTENANCE_PASS_BUDGET,
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
      runDrainRunId: input.runDrain.runId,
    },
    message:
      "Hosted runtime exhausted the immediate maintenance drain budget; leaving remaining internal work on nextWakeAt.",
    phase: "wake.running",
    run: input.run ?? null,
  });
}

function hasHostedImmediateMaintenanceWork(
  drainState: HostedImmediateMaintenanceDrainState,
): boolean {
  return (
    drainState.assistantPending ||
    drainState.deviceSyncPending ||
    isHostedWakeDueNow(drainState.assistantRuntimeNextWakeAt) ||
    isHostedWakeDueNow(drainState.deviceSyncNextWakeAt)
  );
}


function buildHostedRunDrainRedactedDetails(
  metrics: HostedRunDrainMetrics,
): Record<string, unknown> | null {
  const details: Record<string, unknown> = {};

  if (metrics.vaultSyncImportResults.length > 0) {
    const vaultSyncImports = metrics.vaultSyncImportResults.map((result) => ({
      conflictCount: result.conflicts.length,
      conflictManifestPath: result.conflictManifestPath,
      imported: result.imported,
      sessionId: result.sessionId,
      skipped: result.skipped,
    }));
    details.vaultSyncImports = vaultSyncImports;
    details.vaultSyncImport = vaultSyncImports[0] ?? null;
  }

  return Object.keys(details).length > 0 ? details : null;
}

function summarizeHostedRunDrain(
  runDrain: HostedRuntimeDrainRequest,
  metrics: HostedRunDrainMetrics,
): string {
  const eventKinds = Array.from(
    new Set(runDrain.events.map((event) => event.wake.kind)),
  ).sort();
  const eventKindsSummary = eventKinds.length > 0 ? eventKinds.join(",") : "none";
  const nextWakeAtSummary = metrics.nextWakeAt ? ` Next wake: ${metrics.nextWakeAt}.` : "";

  return `Processed hosted run ${runDrain.runId} (${runDrain.triggerKind}; events=${metrics.eventsHandled}; kinds=${eventKindsSummary}; parserJobs=${metrics.parserProcessed}; deviceSyncJobs=${metrics.deviceSyncProcessed}).${nextWakeAtSummary}`;
}

async function runHostedSystemWakeFollowupExecution(input: {
  wake: HostedIngressEnvelope;
  executionContext: AssistantExecutionContext;
  requestId: string;
  run?: HostedExecutionRunContext | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig"
  >;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const maintenanceStartedAtMs = Date.now();
  const maintenanceMetrics = await (() => {
    switch (input.wake.kind) {
      case "device-sync.wake":
        return runHostedDeviceSyncWakeLane({
          deviceSyncPort: input.runtime.platform.deviceSyncPort,
          resolvedConfig: input.runtime.resolvedConfig,
          timeoutMs: input.runtime.commitTimeoutMs,
          vaultRoot: input.vaultRoot,
          wake: input.wake,
        });
      case "assistant.notification.requested":
      case "member.activated":
      case "member.channels.updated":
      case "vault.share.accepted":
      case "vault.sync.import":
        return Promise.resolve(runHostedNoopSystemWakeLane());
      case "conversation.message":
        throw new TypeError("Hosted system wake follow-up does not support conversation wakes.");
    }
  })();
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake: input.wake,
    details: {
      lane: input.wake.kind,
      maintenanceLatencyMs: Date.now() - maintenanceStartedAtMs,
      nextWakeAt: maintenanceMetrics.nextWakeAt,
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
    },
    message: "Hosted runtime finished system maintenance follow-up.",
    phase: "wake.running",
    run: input.run ?? null,
  });
  return maintenanceMetrics;
}

async function resolveHostedPreservedWakeMetrics(input: {
  deviceSyncConfig: NormalizedHostedAssistantRuntimeConfig["resolvedConfig"]["deviceSync"];
  includeDeviceSync?: boolean;
  referenceMs?: number;
  run?: HostedExecutionRunContext | null;
  vaultRoot: string;
  wake: HostedIngressEnvelope;
}): Promise<HostedMaintenanceMetrics> {
  const referenceMs = input.referenceMs ?? Date.now();
  const deviceSyncWakeAt = input.includeDeviceSync === false
    ? null
    : await resolveHostedDeviceSyncWakeAt({
        deviceSyncConfig: input.deviceSyncConfig,
        wake: input.wake,
        referenceMs,
        run: input.run ?? null,
        vaultRoot: input.vaultRoot,
      });

  return {
    deviceSyncProcessed: 0,
    deviceSyncSkipped: input.includeDeviceSync === false,
    nextWakeAt: deviceSyncWakeAt,
    parserProcessed: 0,
  };
}

async function resolveHostedConversationPreservedWakeMetrics(input: {
  wake: HostedIngressEnvelope;
  run?: HostedExecutionRunContext | null;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "resolvedConfig">;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const preservedMetrics = await resolveHostedPreservedWakeMetrics({
    deviceSyncConfig: input.runtime.resolvedConfig.deviceSync,
    run: input.run ?? null,
    vaultRoot: input.vaultRoot,
    wake: input.wake,
  });

  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake: input.wake,
    details: {
      nextWakeAt: preservedMetrics.nextWakeAt,
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
    },
    message:
      "Hosted runtime resolved preserved device-sync wakes after conversation wake handling.",
    phase: "wake.running",
    run: input.run ?? null,
  });

  return preservedMetrics;
}


async function resolveHostedDeviceSyncWakeAt(input: {
  deviceSyncConfig: NormalizedHostedAssistantRuntimeConfig["resolvedConfig"]["deviceSync"];
  wake: HostedIngressEnvelope;
  referenceMs: number;
  run?: HostedExecutionRunContext | null;
  vaultRoot: string;
}): Promise<string | null> {
  if (!input.deviceSyncConfig) {
    return null;
  }

  try {
    const registry = createDeviceSyncRegistry(
      createConfiguredDeviceSyncProvidersFromConfigs(
        input.deviceSyncConfig.providerConfigs,
      ),
    );

    if (registry.list().length === 0) {
      return null;
    }

    const service = createDeviceSyncService({
      secret: input.deviceSyncConfig.secret,
      config: {
        publicBaseUrl: input.deviceSyncConfig.publicBaseUrl,
        vaultRoot: input.vaultRoot,
      },
      registry,
    });

    try {
      return normalizeHostedWakeAt(service.getNextWakeAt(), input.referenceMs);
    } finally {
      service.close();
    }
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake: input.wake,
      error,
        level: "warn",
        message:
          "Hosted runtime could not resolve the preserved device-sync wake after conversation wake handling; continuing without it.",
        phase: "wake.running",
        run: input.run ?? null,
      });
    return null;
  }
}

function earliestHostedWakeAt(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

function isHostedWakeDueNow(
  wakeAt: string | null | undefined,
  referenceMs = Date.now(),
): boolean {
  if (!wakeAt) {
    return false;
  }

  const wakeAtMs = Date.parse(wakeAt);
  return Number.isFinite(wakeAtMs) && wakeAtMs <= referenceMs;
}

function normalizeHostedWakeAt(
  value: string | null | undefined,
  referenceMs = Date.now(),
): string | null {
  if (!value) {
    return null;
  }

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(Math.max(parsedMs, referenceMs)).toISOString();
}

async function finalizeHostedCommittedRunAfterCommit(input: {
  materializedArtifactPaths?: ReadonlySet<string>;
  run?: HostedExecutionRunContext | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "resolvedConfig" | "userEnv"
  >;
  restored: HostedRestoredExecutionContext;
  committedExecution: HostedCommittedExecutionState;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantRuntimeCompletedJobResult> {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake: input.wake,
    details: {
      assistantDeliveryEffectCount: String(
        input.committedExecution.committedAssistantDeliveryEffects.length,
      ),
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
    },
    message: "Hosted runtime draining committed side effects.",
    phase: "side-effects.draining",
    run: input.run ?? null,
  });
  const sideEffectsStartedAtMs = Date.now();
  const assistantDeliveryOutcomes = await drainHostedCommittedAssistantDeliveriesAfterCommit({
    effectsPort: input.runtime.platform.effectsPort,
    assistantDeliveryEffects: input.committedExecution.committedAssistantDeliveryEffects,
    vaultRoot: input.restored.vaultRoot,
    wake: input.wake,
  });
  await stopExecutorOwnedHostedRunMessagingActivityAfterDelivery({
    component: "runtime",
    runtimeEnv: {
      ...input.runtime.forwardedEnv,
      ...input.runtime.userEnv,
    },
    run: input.run ?? null,
    wake: input.wake,
  });
  await exportHostedPendingAssistantUsage({
    usageExportPort: input.runtime.platform.usageExportPort,
    vaultRoot: input.restored.vaultRoot,
  }).catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake: input.wake,
      error,
      level: "warn",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
      },
      message:
        "Hosted runtime could not export pending assistant usage after draining side effects; leaving the pending usage records in the final bundle.",
      phase: "side-effects.draining",
      run: input.run ?? null,
    });
  });
  await exportHostedPendingAssistantRuntimeIssues({
    issueExportPort: input.runtime.platform.issueExportPort,
    vaultRoot: input.restored.vaultRoot,
  }).catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake: input.wake,
      error,
      level: "warn",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
      },
      message:
        "Hosted runtime could not export pending assistant runtime issues after draining side effects; leaving the pending issue records in the final bundle.",
      phase: "side-effects.draining",
      run: input.run ?? null,
    });
  });
  await refreshAssistantStatusSnapshot(input.restored.vaultRoot).catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake: input.wake,
      error,
      level: "warn",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
      },
      message:
        "Hosted runtime could not refresh the assistant status snapshot after draining side effects; continuing with the final bundle snapshot.",
      phase: "side-effects.draining",
      run: input.run ?? null,
    });
  });
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake: input.wake,
    details: {
      assistantDeliveryOutcomeSummary: summarizeHostedAssistantDeliveryOutcomes(
        assistantDeliveryOutcomes,
      ),
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
      sideEffectsDrainLatencyMs: Date.now() - sideEffectsStartedAtMs,
    },
    message: "Hosted runtime drained committed side effects.",
    phase: "side-effects.draining",
    run: input.run ?? null,
  });

  const finalSnapshotStartedAtMs = Date.now();
  const finalSnapshot = await snapshotHostedExecutionContext({
    artifactSink: createHostedArtifactUploadSink({
      artifactStore: input.runtime.platform.artifactStore,
      knownArtifactHashes: collectHostedBundleArtifactHashes(
        decodeHostedBundleBase64(input.committedExecution.committedResult.bundle),
      ),
    }),
    operatorHomeRoot: input.restored.operatorHomeRoot,
    preservedArtifacts: collectPreservedHostedArtifacts({
      bytes: decodeHostedBundleBase64(input.committedExecution.committedResult.bundle),
      materializedArtifactPaths: input.materializedArtifactPaths ?? new Set(),
    }),
    vaultRoot: input.restored.vaultRoot,
  });
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake: input.wake,
    details: {
      finalSnapshotLatencyMs: Date.now() - finalSnapshotStartedAtMs,
      runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
    },
    message: "Hosted runtime snapshotted final execution state.",
    phase: "completed",
    run: input.run ?? null,
  });
  const finalGatewayProjectionSnapshot = await exportGatewayProjectionSnapshotLocal(
    input.restored.vaultRoot,
    {
      sourceReader: assistantGatewayLocalProjectionSourceReader,
    },
  ).catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake: input.wake,
      error,
      level: "warn",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
      },
      message:
        "Hosted runtime could not export the final gateway projection snapshot; returning the final bundle without it.",
      phase: "completed",
      run: input.run ?? null,
    });
    return null;
  });
  const finalResult: HostedExecutionRunnerResult = {
    bundle: encodeHostedBundleBase64(finalSnapshot.bundle),
    result: input.committedExecution.committedResult.result,
  };
  const browserVaultReplica = await exportHostedBrowserVaultReplica({
    sourceBundleHash: sha256HostedBundleHex(finalSnapshot.bundle),
    vaultRoot: input.restored.vaultRoot,
  }).catch((error) => {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake: input.wake,
      error,
      level: "warn",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run ?? null),
      },
      message:
        "Hosted runtime could not export the browser vault replica; returning the final bundle without it.",
      phase: "completed",
      run: input.run ?? null,
    });
    return null;
  });

  return {
    assistantDeliveryOutcomes,
    browserVaultReplica,
    finalGatewayProjectionSnapshot,
    phase: "completed",
    result: finalResult,
  };
}

function collectHostedBundleArtifactHashes(bytes: Uint8Array | null): Set<string> {
  if (!bytes) {
    return new Set();
  }

  try {
    return new Set(
      listHostedBundleArtifacts({
        bytes,
        expectedKind: "vault",
      }).map((artifact) => artifact.ref.sha256),
    );
  } catch {
    return new Set();
  }
}

function collectPreservedHostedArtifacts(input: {
  bytes: Uint8Array | null;
  materializedArtifactPaths: ReadonlySet<string>;
}): HostedBundleArtifactLocation[] {
  if (!input.bytes) {
    return [];
  }

  try {
    return listHostedBundleArtifacts({
      bytes: input.bytes,
      expectedKind: "vault",
    }).filter((artifact) => !input.materializedArtifactPaths.has(artifact.path));
  } catch {
    return [];
  }
}

function summarizeHostedAssistantDeliveryOutcomes(
  outcomes: ReadonlyArray<{ deliveryChannel: string | null; deliveryStatus: string }>,
): string {
  if (outcomes.length === 0) {
    return "none";
  }

  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    const key = `${outcome.deliveryChannel ?? "unknown"}:${outcome.deliveryStatus}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(",");
}
