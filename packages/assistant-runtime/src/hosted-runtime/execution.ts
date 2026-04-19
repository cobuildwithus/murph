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
  HostedExecutionRunnerResult,
  HostedWakeMaterializationHints,
  HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
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
import { executeHostedWakeEvent } from "./events.ts";
import {
  runHostedAssistantCronWakeLane,
  runHostedDeviceSyncWakeLane,
  runHostedNoopSystemWakeLane,
} from "./maintenance.ts";
import type {
  HostedAssistantRuntimeCompletedJobResult,
  HostedAssistantRuntimeJobRequest,
  HostedCommittedExecutionState,
  HostedRestoredExecutionContext,
  HostedWakeFollowupExecution,
  HostedMaintenanceMetrics,
  NormalizedHostedAssistantRuntimeConfig,
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { summarizeWake } from "./summary.ts";
import { exportHostedPendingAssistantUsage } from "./usage.ts";
import { exportHostedBrowserVaultSnapshot } from "./browser-vault.ts";
import { resolveHostedWake } from "./utils.ts";

export async function executeHostedWakeForCommit(input: {
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
  const wake = resolveHostedWake(input.request);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake,
    details: {
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
    },
    message: "Hosted runtime executing wake handlers.",
    phase: "wake.running",
    run: input.request.run ?? null,
  });
  const wakeHandlingStartedAtMs = Date.now();
  const wakeExecutionContext = await resolveHostedWakeExecutionContext(
    input.executionContext,
  );
  const wakeMetrics = await executeHostedWakeEvent({
    wake,
    executionContext: wakeExecutionContext,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    sharePack: input.request.sharePack ?? null,
    vaultRoot: input.restored.vaultRoot,
  });
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake,
    details: {
      wakeHandlerLatencyMs: Date.now() - wakeHandlingStartedAtMs,
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
    },
    message: "Hosted runtime finished wake handlers.",
    phase: "wake.running",
    run: input.request.run ?? null,
  });
  const maintenanceMetrics = await runHostedWakeFollowupExecution({
    artifactMaterializer: input.artifactMaterializer ?? null,
    bootstrapResult: wakeMetrics.bootstrapResult,
    conversationMetrics: wakeMetrics.conversationMetrics,
    executionContext: wakeExecutionContext,
    followupExecution: wakeMetrics.followupExecution,
    requestId: wake.eventId,
    run: input.request.run ?? null,
    runtime: input.runtime,
    vaultRoot: input.restored.vaultRoot,
    wake,
  });
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
    wake,
    details: {
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
      snapshotLatencyMs: Date.now() - snapshotStartedAtMs,
    },
    message: "Hosted runtime snapshotted execution context.",
    phase: "commit.recorded",
    run: input.request.run ?? null,
  });
  const committedAssistantDeliveryEffects = await collectHostedAssistantDeliverySideEffects(
    input.restored.vaultRoot,
  );
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake,
    details: {
      committedAssistantDeliveryEffectCount: String(committedAssistantDeliveryEffects.length),
      runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
    },
    message: "Hosted runtime collected committed assistant delivery effects.",
    phase: "commit.recorded",
    run: input.request.run ?? null,
  });
  const committedGatewayProjectionSnapshot = await exportGatewayProjectionSnapshotLocal(
    input.restored.vaultRoot,
    {
      sourceReader: assistantGatewayLocalProjectionSourceReader,
    },
  ).catch((error: unknown) => {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      wake,
      error,
      level: "warn",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.request.run ?? null),
      },
      message:
        "Hosted runtime could not export the committed gateway projection snapshot; continuing without it.",
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
        eventsHandled: 1,
        nextWakeAt: maintenanceMetrics.nextWakeAt,
        ...(maintenanceMetrics.wakeMaterializationHints
          ? { wakeMaterializationHints: maintenanceMetrics.wakeMaterializationHints }
          : {}),
        summary: summarizeWake(wake, {
          ...wakeMetrics,
          ...maintenanceMetrics,
        }),
      },
    },
    committedAssistantDeliveryEffects,
  };
}

async function resolveHostedWakeExecutionContext(
  executionContext: AssistantExecutionContext,
): Promise<AssistantExecutionContext> {
  return hydrateHostedExecutionDefaultTarget(executionContext);
}

async function runHostedWakeFollowupExecution(input: {
  artifactMaterializer: HostedWorkspaceArtifactMaterializer | null;
  bootstrapResult: Awaited<ReturnType<typeof executeHostedWakeEvent>>["bootstrapResult"];
  conversationMetrics: Awaited<ReturnType<typeof executeHostedWakeEvent>>["conversationMetrics"];
  executionContext: AssistantExecutionContext;
  followupExecution: HostedWakeFollowupExecution;
  requestId: string;
  run?: HostedExecutionRunContext | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig"
  >;
  vaultRoot: string;
  wake: HostedExecutionWake;
}): Promise<HostedMaintenanceMetrics> {
  switch (input.followupExecution) {
    case "conversation-message":
      return runHostedConversationWakeFollowupExecution({
        conversationMetrics: input.conversationMetrics,
        run: input.run ?? null,
        runtime: input.runtime,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
    case "assistant-cron":
    case "device-sync":
    case "member-activated":
    case "member-channels-updated":
    case "vault-share-accepted":
      return runHostedSystemWakeFollowupExecution({
        executionContext: input.executionContext,
        requestId: input.requestId,
        run: input.run ?? null,
        runtime: input.runtime,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
  }
}

async function runHostedSystemWakeFollowupExecution(input: {
  wake: HostedExecutionWake;
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
  const wakeExecutionContext = await resolveHostedWakeExecutionContext(
    input.executionContext,
  );
  const maintenanceMetrics = await (() => {
    switch (input.wake.kind) {
      case "assistant.cron.tick":
        return runHostedAssistantCronWakeLane({
          executionContext: wakeExecutionContext,
          requestId: input.requestId,
          vaultRoot: input.vaultRoot,
          wake: input.wake,
        });
      case "device-sync.wake":
        return runHostedDeviceSyncWakeLane({
          deviceSyncPort: input.runtime.platform.deviceSyncPort,
          resolvedConfig: input.runtime.resolvedConfig,
          timeoutMs: input.runtime.commitTimeoutMs,
          vaultRoot: input.vaultRoot,
          wake: input.wake,
        });
      case "member.activated":
      case "member.channels.updated":
      case "vault.share.accepted":
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
  wake: HostedExecutionWake;
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
    wakeMaterializationHints: createHostedWakeMaterializationHints({
      deviceSyncWakeAt,
    }),
  };
}

async function resolveHostedConversationPreservedWakeMetrics(input: {
  wake: HostedExecutionWake;
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

async function runHostedConversationWakeFollowupExecution(input: {
  conversationMetrics: Awaited<ReturnType<typeof executeHostedWakeEvent>>["conversationMetrics"];
  run?: HostedExecutionRunContext | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "resolvedConfig"
  >;
  vaultRoot: string;
  wake: HostedExecutionWake;
}): Promise<HostedMaintenanceMetrics> {
  const assistantWakeAt = new Date().toISOString();
  const preservedMetrics = await resolveHostedConversationPreservedWakeMetrics({
    wake: input.wake,
    run: input.run ?? null,
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
  });

  return {
    ...preservedMetrics,
    nextWakeAt: earliestHostedWakeAt(
      input.conversationMetrics?.nextWakeAt,
      assistantWakeAt,
      preservedMetrics.nextWakeAt,
    ),
    parserProcessed: input.conversationMetrics?.parserProcessed ?? 0,
    wakeMaterializationHints: createHostedWakeMaterializationHints({
      assistantWakeAt,
      deviceSyncWakeAt:
        preservedMetrics.wakeMaterializationHints?.deviceSyncWakeAt
        ?? preservedMetrics.nextWakeAt,
    }),
  };
}

async function resolveHostedDeviceSyncWakeAt(input: {
  deviceSyncConfig: NormalizedHostedAssistantRuntimeConfig["resolvedConfig"]["deviceSync"];
  wake: HostedExecutionWake;
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

function createHostedWakeMaterializationHints(input: {
  assistantWakeAt?: string | null;
  deviceSyncWakeAt?: string | null;
}): HostedWakeMaterializationHints | null {
  const hints: HostedWakeMaterializationHints = {
    ...(input.assistantWakeAt === undefined ? {} : { assistantWakeAt: input.assistantWakeAt }),
    ...(input.deviceSyncWakeAt === undefined ? {} : { deviceSyncWakeAt: input.deviceSyncWakeAt }),
  };

  return Object.keys(hints).length > 0 ? hints : null;
}

function earliestHostedWakeAt(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
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

export async function completeHostedExecutionAfterCommit(input: {
  materializedArtifactPaths?: ReadonlySet<string>;
  run?: HostedExecutionRunContext | null;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "platform" | "resolvedConfig" | "userEnv"
  >;
  restored: HostedRestoredExecutionContext;
  committedExecution: HostedCommittedExecutionState;
  wake: HostedExecutionWake;
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
  const browserVaultSnapshot = await exportHostedBrowserVaultSnapshot({
    sourceVersion: sha256HostedBundleHex(finalSnapshot.bundle),
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
        "Hosted runtime could not export the browser vault snapshot; returning the final bundle without it.",
      phase: "completed",
      run: input.run ?? null,
    });
    return null;
  });

  return {
    assistantDeliveryOutcomes,
    browserVaultSnapshot,
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

function computeHostedRunElapsedMs(
  run: HostedAssistantRuntimeJobRequest["run"] | null | undefined,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
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
