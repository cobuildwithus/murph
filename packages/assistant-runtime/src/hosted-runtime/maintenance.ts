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
  createAssistantFoodAutoLogHooks,
} from "@murphai/assistant-engine";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import {
  getAssistantCronStatus,
  runAssistantAutomation,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";

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
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeDeviceSyncPort,
} from "./platform.ts";

const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_MAX_PARSER_JOBS = 50;

interface HostedAssistantAutomationReadiness {
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
    configStatus: assistantState.assistantConfigStatus,
    configured: assistantState.assistantConfigured,
    provider: assistantState.assistantProvider,
    shouldRun: assistantState.assistantConfigured && !input.skipAssistantAutomation,
  };
}

function reportHostedAssistantAutomationSkipped(
  dispatch: HostedExecutionDispatchRequest,
  configStatus: HostedAssistantAutomationReadiness["configStatus"],
  provider: "openai-compatible" | null,
): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch,
    level: "warn",
    message:
      configStatus === "invalid"
        ? "Hosted assistant automation skipped because the saved hosted assistant config is invalid."
        : configStatus === "missing"
          ? "Hosted assistant automation skipped because no explicit hosted assistant profile is configured."
          : provider
            ? `Hosted assistant automation skipped because the active hosted assistant profile (${provider}) is not ready.`
            : "Hosted assistant automation skipped because the hosted assistant config is not ready.",
    phase: "dispatch.running",
  });
}

export async function runHostedMaintenanceLoop(input: {
  artifactMaterializer?: HostedWorkspaceArtifactMaterializer | null;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  dispatch: HostedExecutionDispatchRequest;
  executionContext: AssistantExecutionContext;
  requestId: string;
  resolvedConfig: {
    deviceSync: HostedAssistantRuntimeDeviceSyncConfig | null;
  };
  skipAssistantAutomation?: boolean;
  timeoutMs: number | null;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const parserResult = await drainHostedParserQueue({
    artifactMaterializer: input.artifactMaterializer ?? null,
    vaultRoot: input.vaultRoot,
  });
  const assistantAutomation = await resolveHostedAssistantAutomationReadiness({
    skipAssistantAutomation: input.skipAssistantAutomation ?? false,
  });

  if (!assistantAutomation.configured) {
    reportHostedAssistantAutomationSkipped(
      input.dispatch,
      assistantAutomation.configStatus,
      assistantAutomation.provider,
    );
  }

  if (assistantAutomation.shouldRun) {
    await runHostedAssistantAutomation(
      input.vaultRoot,
      input.requestId,
      input.executionContext,
    );
  }

  const assistantNextWakeAt = assistantAutomation.shouldRun
    ? (await getAssistantCronStatus(input.vaultRoot)).nextRunAt
    : null;
  const deviceSyncResult = await runHostedDeviceSyncPass(
    input.dispatch,
    input.vaultRoot,
    input.resolvedConfig.deviceSync,
    input.deviceSyncPort,
    input.timeoutMs,
  );

  return {
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: earliestHostedWakeAt(
      assistantNextWakeAt,
      deviceSyncResult.nextWakeAt,
    ),
    parserProcessed: parserResult.processedJobs,
  };
}

export async function drainHostedParserQueue(input: {
  artifactMaterializer?: HostedWorkspaceArtifactMaterializer | null;
  vaultRoot: string;
}): Promise<{ processedJobs: number }> {
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
      processedJobs: results.length,
    };
  } finally {
    runtime.close();
  }
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
): Promise<void> {
  const inboxServices = createIntegratedInboxServices();
  const vaultServices = createIntegratedVaultServices({
    foodAutoLogHooks: createAssistantFoodAutoLogHooks(),
  });

  try {
    await runAssistantAutomation({
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
      executionContext,
      inboxServices,
      vaultServices,
      once: true,
      requestId,
      startDaemon: false,
      vault: vaultRoot,
    });
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "INBOX_NOT_INITIALIZED"
    ) {
      return;
    }

    throw error;
  }
}

export async function runHostedDeviceSyncPass(
  dispatch: HostedExecutionDispatchRequest,
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
  const failHardOnControlPlaneError = dispatch.event.kind === "device-sync.wake";

  try {
    if (secret) {
      try {
        syncState = await syncHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          dispatch,
          secret,
          service,
          timeoutMs,
        });
        controlPlaneSynced = true;
      } catch (error) {
        if (failHardOnControlPlaneError) {
          throw error;
        }

        reportHostedDeviceSyncControlPlaneFailure("sync", dispatch, error);
      }
    }

    await service.runSchedulerOnce();
    const processedJobs = await service.drainWorker(HOSTED_MAX_DEVICE_SYNC_JOBS);

    if (secret && controlPlaneSynced) {
      try {
        await reconcileHostedDeviceSyncControlPlaneState({
          deviceSyncPort,
          dispatch,
          secret,
          service,
          state: syncState,
          timeoutMs,
        });
      } catch (error) {
        if (failHardOnControlPlaneError) {
          throw error;
        }

        reportHostedDeviceSyncControlPlaneFailure("reconcile", dispatch, error);
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

function reportHostedDeviceSyncControlPlaneFailure(
  phase: "reconcile" | "sync",
  dispatch: HostedExecutionDispatchRequest,
  error: unknown,
): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    dispatch,
    error,
    level: "warn",
    message: `Hosted device-sync control-plane ${phase} failed; continuing hosted job.`,
    phase: "dispatch.running",
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
