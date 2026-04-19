import { createConfiguredDeviceSyncProvidersFromConfigs } from "@murphai/device-syncd/config";
import { createDeviceSyncRegistry } from "@murphai/device-syncd/registry";
import { createDeviceSyncService } from "@murphai/device-syncd/service";
import {
  openInboxRuntime,
  rebuildRuntimeFromVault,
} from "@murphai/inboxd/runtime";
import {
  createConfiguredParserRegistry,
  createInboxParserService,
} from "@murphai/parsers";
import {
  type AssistantExecutionContext,
  createAssistantFoodAutoLogHooks,
  readAssistantAutomationState,
  runAssistantAutomationPass,
} from "@murphai/assistant-engine";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";

import type {
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedMaintenanceMetrics,
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import {
  reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState,
  type HostedDeviceSyncRuntimeSyncState,
} from "../hosted-device-sync-runtime.ts";
import { readHostedAssistantRuntimeState } from "./context.ts";
import type {
  HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeDeviceSyncPort,
} from "./platform.ts";

const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_MAX_MAINTENANCE_PASSES = 10;
const HOSTED_MAX_PARSER_JOBS = 50;

interface HostedAssistantAutomationReadiness {
  activeProfileId: string | null;
  activeProfileManagedBy: "member" | "platform" | null;
  activeProfileReady: boolean;
  configInvalid: boolean;
  configPresent: boolean;
  configStatus: "hosted-env" | "invalid" | "missing" | "saved" | "unready";
  configured: boolean;
  provider: "openai-compatible" | null;
  shouldRun: boolean;
}

async function resolveHostedAssistantAutomationReadiness(input: {
  skipAssistantAutomation: boolean;
}): Promise<HostedAssistantAutomationReadiness> {
  const assistantState = await readHostedAssistantRuntimeState();

  return {
    activeProfileId: assistantState.assistantActiveProfileId,
    activeProfileManagedBy: assistantState.assistantActiveProfileManagedBy,
    activeProfileReady: assistantState.assistantActiveProfileReady,
    configInvalid: assistantState.assistantConfigInvalid,
    configPresent: assistantState.assistantConfigPresent,
    configStatus: assistantState.assistantConfigStatus,
    configured: assistantState.assistantConfigured,
    provider: assistantState.assistantProvider,
    shouldRun: assistantState.assistantConfigured && !input.skipAssistantAutomation,
  };
}

function reportHostedAssistantAutomationSkipped(
  wake: HostedExecutionWake,
  readiness: HostedAssistantAutomationReadiness,
): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      activeProfileId: readiness.activeProfileId,
      activeProfileManagedBy: readiness.activeProfileManagedBy,
      activeProfileReady: readiness.activeProfileReady,
      assistantConfigured: readiness.configured,
      configInvalid: readiness.configInvalid,
      configPresent: readiness.configPresent,
      configStatus: readiness.configStatus,
      provider: readiness.provider,
    },
    wake,
    level: "warn",
    message:
      readiness.configStatus === "invalid"
        ? "Hosted assistant automation skipped because the saved hosted assistant config is invalid."
        : readiness.configStatus === "missing"
          ? "Hosted assistant automation skipped because no explicit hosted assistant profile is configured."
          : readiness.provider
            ? `Hosted assistant automation skipped because the active hosted assistant profile (${readiness.provider}) is not ready.`
            : "Hosted assistant automation skipped because the hosted assistant config is not ready.",
    phase: "wake.running",
  });
}

export async function runHostedAssistantCronWakeLane(input: {
  wake: HostedExecutionWake;
  executionContext: AssistantExecutionContext;
  requestId: string;
  skipAssistantAutomation?: boolean;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const assistantAutomation = await resolveHostedAssistantAutomationReadiness({
    skipAssistantAutomation: input.skipAssistantAutomation ?? false,
  });

  if (!assistantAutomation.configured) {
    reportHostedAssistantAutomationSkipped(input.wake, assistantAutomation);
  }

  const assistantResult = assistantAutomation.shouldRun
    ? await runHostedAssistantAutomation(
        input.vaultRoot,
        input.requestId,
        input.executionContext,
        input.wake,
      )
    : {
        nextWakeAt: null,
        progressed: false,
      };

  return {
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: assistantResult.nextWakeAt
      ?? (assistantResult.progressed ? new Date().toISOString() : null),
    parserProcessed: 0,
    wakeMaterializationHints: null,
  };
}

export async function drainHostedParserQueue(input: {
  artifactMaterializer?: HostedWorkspaceArtifactMaterializer | null;
  vaultRoot: string;
}): Promise<{ nextWakeAt: string | null; processedJobs: number }> {
  const runtime = await openInboxRuntime({
    vaultRoot: input.vaultRoot,
  });

  try {
    await rebuildRuntimeFromVault({
      runtime,
      vaultRoot: input.vaultRoot,
    });
    if (input.artifactMaterializer) {
      await hydratePendingHostedParserArtifacts({
        artifactMaterializer: input.artifactMaterializer,
        runtime,
      });
    }
    const configured = await createConfiguredParserRegistry({
      vaultRoot: input.vaultRoot,
    });
    const parserService = createInboxParserService({
      ffmpeg: configured.ffmpeg,
      registry: configured.registry,
      runtime,
      vaultRoot: input.vaultRoot,
    });
    const results = await parserService.drain({
      maxJobs: HOSTED_MAX_PARSER_JOBS,
    });

    return {
      nextWakeAt: null,
      processedJobs: results.length,
    };
  } finally {
    runtime.close();
  }
}

export async function drainHostedParserQueueUntilSettled(input: {
  artifactMaterializer?: HostedWorkspaceArtifactMaterializer | null;
  vaultRoot: string;
}): Promise<{ nextWakeAt: string | null; processedJobs: number }> {
  let processedJobs = 0;

  for (let pass = 0; pass < HOSTED_MAX_MAINTENANCE_PASSES; pass += 1) {
    const passResult = await drainHostedParserQueue(input);
    processedJobs += passResult.processedJobs;

    if (passResult.processedJobs === 0) {
      return {
        nextWakeAt: passResult.nextWakeAt,
        processedJobs,
      };
    }

    if (pass === HOSTED_MAX_MAINTENANCE_PASSES - 1) {
      return {
        nextWakeAt: earliestHostedWakeAt(
          new Date().toISOString(),
          passResult.nextWakeAt,
        ),
        processedJobs,
      };
    }
  }

  return {
    nextWakeAt: null,
    processedJobs,
  };
}

async function hydratePendingHostedParserArtifacts(input: {
  artifactMaterializer: HostedWorkspaceArtifactMaterializer;
  runtime: Awaited<ReturnType<typeof openInboxRuntime>>;
}): Promise<void> {
  const relativePaths = new Set<string>();

  for (const job of input.runtime.listAttachmentParseJobs({
    limit: HOSTED_MAX_PARSER_JOBS,
    state: "pending",
  })) {
    const capture = input.runtime.getCapture(job.captureId);
    const attachment = capture?.attachments.find((candidate) => candidate.attachmentId === job.attachmentId);
    if (!attachment?.storedPath) {
      continue;
    }

    relativePaths.add(attachment.storedPath);
  }

  if (relativePaths.size === 0) {
    return;
  }

  await input.artifactMaterializer([...relativePaths]);
}

export async function runHostedAssistantAutomation(
  vaultRoot: string,
  requestId: string,
  executionContext: AssistantExecutionContext,
  wake: HostedExecutionWake,
): Promise<{ nextWakeAt: string | null; progressed: boolean }> {
  const inboxServices = createIntegratedInboxServices();
  const vaultServices = createIntegratedVaultServices({
    foodAutoLogHooks: createAssistantFoodAutoLogHooks(),
  });
  const beforeState = await readAssistantAutomationState(vaultRoot);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      autoReplyChannels: beforeState.autoReply.map((entry) => entry.channel).join(","),
      autoReplyCursorSummary: beforeState.autoReply.map((entry) =>
        `${entry.channel}:${entry.cursor?.captureId ?? "null"}`
      ).join(","),
      inboxScanCursor: beforeState.inboxScanCursor?.captureId ?? null,
      requestId,
    },
    wake,
    message: "Hosted assistant automation pass starting.",
    phase: "wake.running",
  });

  try {
    const result = await runAssistantAutomationPass({
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
      executionContext,
      inboxServices,
      onEvent: (event) => {
        emitHostedExecutionStructuredLog({
          component: "runtime",
          details: {
            captureId: "captureId" in event ? (event.captureId ?? null) : null,
            details: event.details ?? null,
            requestId,
            type: event.type,
          },
          wake,
          message: `Hosted assistant automation event: ${event.type}.`,
          phase: "wake.running",
        });
      },
      vaultServices,
      requestId,
      vault: vaultRoot,
    });
    const afterState = await readAssistantAutomationState(vaultRoot);
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        autoReplyChannels: afterState.autoReply.map((entry) => entry.channel).join(","),
        autoReplyCursorSummary: afterState.autoReply.map((entry) =>
          `${entry.channel}:${entry.cursor?.captureId ?? "null"}`
        ).join(","),
        inboxScanCursor: afterState.inboxScanCursor?.captureId ?? null,
        nextWakeAt: result.nextWakeAt,
        progressed: result.progressed,
        requestId,
      },
      wake,
      message: "Hosted assistant automation pass finished.",
      phase: "wake.running",
    });
    return result;
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "INBOX_NOT_INITIALIZED"
    ) {
      emitHostedExecutionStructuredLog({
        component: "runtime",
        details: {
          requestId,
        },
        wake,
        message: "Hosted assistant automation skipped because the inbox runtime is not initialized yet.",
        phase: "wake.running",
      });
      return {
        nextWakeAt: null,
        progressed: false,
      };
    }

    throw error;
  }
}

export async function runHostedConversationAssistantAutomation(input: {
  executionContext: AssistantExecutionContext;
  requestId: string;
  vaultRoot: string;
  wake: HostedExecutionWake;
}): Promise<{ nextWakeAt: string | null; progressed: boolean }> {
  const assistantAutomation = await resolveHostedAssistantAutomationReadiness({
    skipAssistantAutomation: false,
  });

  if (!assistantAutomation.shouldRun) {
    reportHostedAssistantAutomationSkipped(input.wake, assistantAutomation);
    return {
      nextWakeAt: null,
      progressed: false,
    };
  }

  return runHostedAssistantAutomation(
    input.vaultRoot,
    input.requestId,
    input.executionContext,
    input.wake,
  );
}

export async function runHostedDeviceSyncPass(
  wake: HostedExecutionWake,
  vaultRoot: string,
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null,
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined,
  timeoutMs: number | null,
): Promise<{ nextWakeAt: string | null; processedJobs: number; skipped: boolean }> {
  const service = createHostedDeviceSyncRuntime({
    deviceSyncConfig,
    vaultRoot,
  });

  if (!service) {
    return {
      nextWakeAt: null,
      processedJobs: 0,
      skipped: true,
    };
  }

  const secret = deviceSyncConfig?.secret ?? null;
  let syncState: HostedDeviceSyncRuntimeSyncState = {
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    snapshot: null,
  };
  let controlPlaneSynced = false;
  const failHardOnControlPlaneError = wake.kind === "device-sync.wake";

  try {
    if (secret) {
      try {
        syncState = await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          wake,
          secret,
          service,
        });
        controlPlaneSynced = true;
      } catch (error) {
        if (failHardOnControlPlaneError) {
          throw error;
        }

        reportHostedDeviceSyncControlPlaneFailure("sync", wake, error);
      }
    }

    await service.runSchedulerOnce();
    const processedJobs = await service.drainWorker(HOSTED_MAX_DEVICE_SYNC_JOBS);

    if (secret && controlPlaneSynced) {
      try {
        await reconcileHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          wake,
          secret,
          service,
          state: syncState,
        });
      } catch (error) {
        if (failHardOnControlPlaneError) {
          throw error;
        }

        reportHostedDeviceSyncControlPlaneFailure("reconcile", wake, error);
      }
    }

    return {
      nextWakeAt: service.getNextWakeAt(),
      processedJobs,
      skipped: false,
    };
  } finally {
    service.close();
  }
}

export async function runHostedDeviceSyncWakeLane(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  wake: HostedExecutionWake;
  resolvedConfig: {
    deviceSync: HostedAssistantRuntimeDeviceSyncConfig | null;
  };
  timeoutMs: number | null;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const deviceSyncResult = await runHostedDeviceSyncPass(
    input.wake,
    input.vaultRoot,
    input.resolvedConfig.deviceSync,
    input.deviceSyncPort,
    input.timeoutMs,
  );

  return {
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: deviceSyncResult.nextWakeAt,
    parserProcessed: 0,
    wakeMaterializationHints: null,
  };
}

export function runHostedNoopSystemWakeLane(): HostedMaintenanceMetrics {
  return {
    deviceSyncProcessed: 0,
    deviceSyncSkipped: true,
    nextWakeAt: null,
    parserProcessed: 0,
    wakeMaterializationHints: null,
  };
}

function reportHostedDeviceSyncControlPlaneFailure(
  phase: "reconcile" | "sync",
  wake: HostedExecutionWake,
  error: unknown,
): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    wake,
    error,
    level: "warn",
    message: `Hosted device-sync control-plane ${phase} failed; continuing hosted job.`,
    phase: "wake.running",
  });
}

function createHostedDeviceSyncRuntime(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  vaultRoot: string;
}) {
  if (!input.deviceSyncConfig) {
    return null;
  }

  const registry = createDeviceSyncRegistry(
    createConfiguredDeviceSyncProvidersFromConfigs(input.deviceSyncConfig.providerConfigs),
  );

  if (registry.list().length === 0) {
    return null;
  }

  return createDeviceSyncService({
    secret: input.deviceSyncConfig.secret,
    config: {
      publicBaseUrl: input.deviceSyncConfig.publicBaseUrl,
      vaultRoot: input.vaultRoot,
    },
    registry,
  });
}

function earliestHostedWakeAt(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}
