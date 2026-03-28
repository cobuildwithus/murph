import {
  createConfiguredDeviceSyncProviders,
  createDeviceSyncRegistry,
  createDeviceSyncService,
} from "@murph/device-syncd";
import {
  openInboxRuntime,
  rebuildRuntimeFromVault,
} from "@murph/inboxd";
import {
  createConfiguredParserRegistry,
  createInboxParserService,
} from "@murph/parsers";
import {
  getAssistantCronStatus,
} from "@murph/assistant-services/cron";
import {
  createIntegratedInboxCliServices,
} from "@murph/assistant-services/inbox-services";
import {
  runAssistantAutomation,
} from "@murph/assistant-services/automation";

import type {
  HostedMaintenanceMetrics,
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import { hostedAssistantAutomationEnabledFromEnv } from "./environment.ts";
import {
  reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState,
  type HostedDeviceSyncRuntimeSyncState,
} from "../hosted-device-sync-runtime.ts";
import type {
  HostedExecutionDispatchRequest,
  HostedExecutionWebControlPlaneEnvironment,
} from "@murph/hosted-execution";
import {
  readHostedExecutionWebControlPlaneEnvironment,
} from "@murph/hosted-execution";

const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_MAX_PARSER_JOBS = 50;

export async function runHostedMaintenanceLoop(input: {
  artifactMaterializer?: HostedWorkspaceArtifactMaterializer | null;
  dispatch: HostedExecutionDispatchRequest;
  internalWorkerFetch?: typeof fetch;
  requestId: string;
  timeoutMs: number | null;
  runtimeEnv: Readonly<Record<string, string>>;
  webControlPlane?: HostedExecutionWebControlPlaneEnvironment;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const webControlPlane = input.webControlPlane
    ?? readHostedExecutionWebControlPlaneEnvironment(input.runtimeEnv);
  const parserResult = await drainHostedParserQueue({
    artifactMaterializer: input.artifactMaterializer ?? null,
    vaultRoot: input.vaultRoot,
  });
  if (hostedAssistantAutomationEnabledFromEnv(input.runtimeEnv)) {
    await runHostedAssistantAutomation(input.vaultRoot, input.requestId);
  }
  const assistantCronStatus = await getAssistantCronStatus(input.vaultRoot);
  const deviceSyncResult = await runHostedDeviceSyncPass(
    input.dispatch,
    input.vaultRoot,
    input.runtimeEnv,
    webControlPlane,
    input.internalWorkerFetch,
    input.timeoutMs,
  );

  return {
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: earliestHostedWakeAt(
      assistantCronStatus.nextRunAt,
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
): Promise<void> {
  const inboxServices = createIntegratedInboxCliServices();

  try {
    await runAssistantAutomation({
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
      inboxServices,
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
  env: Readonly<Record<string, string>>,
  webControlPlane: HostedExecutionWebControlPlaneEnvironment,
  fetchImpl: typeof fetch | undefined,
  timeoutMs: number | null,
): Promise<{ nextWakeAt: string | null; processedJobs: number; skipped: boolean }> {
  const service = createHostedDeviceSyncRuntime({
    env,
    vaultRoot,
  });

  if (!service) {
    return {
      nextWakeAt: null,
      processedJobs: 0,
      skipped: true,
    };
  }

  const secret = env.DEVICE_SYNC_SECRET ?? null;
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
          dispatch,
          fetchImpl,
          secret,
          service,
          timeoutMs,
          webControlPlane,
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
          dispatch,
          fetchImpl,
          secret,
          service,
          state: syncState,
          timeoutMs,
          webControlPlane,
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
  console.warn(
    "[hosted-runtime] device-sync control-plane failure; continuing hosted job",
    {
      error: error instanceof Error ? error.message : String(error),
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      phase,
      userId: dispatch.event.userId,
    },
  );
}

function createHostedDeviceSyncRuntime(input: {
  env: Readonly<Record<string, string>>;
  vaultRoot: string;
}) {
  const registry = createDeviceSyncRegistry(
    createConfiguredDeviceSyncProviders(input.env),
  );

  if (registry.list().length === 0) {
    return null;
  }

  const secret = input.env.DEVICE_SYNC_SECRET ?? null;
  const publicBaseUrl = input.env.DEVICE_SYNC_PUBLIC_BASE_URL ?? null;

  if (!secret || !publicBaseUrl) {
    return null;
  }

  return createDeviceSyncService({
    secret,
    config: {
      publicBaseUrl,
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
