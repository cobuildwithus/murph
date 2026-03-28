import {
  createDeviceSyncRegistry,
  createDeviceSyncService,
  createOuraDeviceSyncProvider,
  createWhoopDeviceSyncProvider,
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

import type { HostedMaintenanceMetrics } from "./models.ts";
import {
  reconcileHostedDeviceSyncControlPlaneState,
  syncHostedDeviceSyncControlPlaneState,
  type HostedDeviceSyncRuntimeSyncState,
} from "../hosted-device-sync-runtime.ts";
import type { HostedExecutionDispatchRequest } from "@murph/hosted-execution";

const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_MAX_PARSER_JOBS = 50;

export async function runHostedMaintenanceLoop(input: {
  dispatch: HostedExecutionDispatchRequest;
  requestId: string;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const parserResult = await drainHostedParserQueue(input.vaultRoot);
  await runHostedAssistantAutomation(input.vaultRoot, input.requestId);
  const assistantCronStatus = await getAssistantCronStatus(input.vaultRoot);
  const deviceSyncResult = await runHostedDeviceSyncPass(
    input.dispatch,
    input.vaultRoot,
    input.runtimeEnv,
  );

  return {
    deviceSyncProcessed: deviceSyncResult.processedJobs,
    deviceSyncSkipped: deviceSyncResult.skipped,
    nextWakeAt: assistantCronStatus.nextRunAt,
    parserProcessed: parserResult.processedJobs,
  };
}

export async function drainHostedParserQueue(
  vaultRoot: string,
): Promise<{ processedJobs: number }> {
  const runtime = await openInboxRuntime({
    vaultRoot,
  });

  try {
    await rebuildRuntimeFromVault({
      runtime,
      vaultRoot,
    });
    const configured = await createConfiguredParserRegistry({
      vaultRoot,
    });
    const parserService = createInboxParserService({
      ffmpeg: configured.ffmpeg,
      registry: configured.registry,
      runtime,
      vaultRoot,
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
): Promise<{ processedJobs: number; skipped: boolean }> {
  const service = createHostedDeviceSyncRuntime({
    env,
    vaultRoot,
  });

  if (!service) {
    return {
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

  try {
    if (secret) {
      syncState = await syncHostedDeviceSyncControlPlaneState({
        dispatch,
        env,
        secret,
        service,
      });
    }

    await service.runSchedulerOnce();
    const processedJobs = await service.drainWorker(HOSTED_MAX_DEVICE_SYNC_JOBS);

    if (secret) {
      await reconcileHostedDeviceSyncControlPlaneState({
        dispatch,
        env,
        secret,
        service,
        state: syncState,
      });
    }

    return {
      processedJobs,
      skipped: false,
    };
  } finally {
    service.close();
  }
}

function createHostedDeviceSyncRuntime(input: {
  env: Readonly<Record<string, string>>;
  vaultRoot: string;
}) {
  const registry = createDeviceSyncRegistry();

  if (input.env.WHOOP_CLIENT_ID && input.env.WHOOP_CLIENT_SECRET) {
    registry.register(
      createWhoopDeviceSyncProvider({
        clientId: input.env.WHOOP_CLIENT_ID,
        clientSecret: input.env.WHOOP_CLIENT_SECRET,
      }),
    );
  }

  if (input.env.OURA_CLIENT_ID && input.env.OURA_CLIENT_SECRET) {
    registry.register(
      createOuraDeviceSyncProvider({
        clientId: input.env.OURA_CLIENT_ID,
        clientSecret: input.env.OURA_CLIENT_SECRET,
      }),
    );
  }

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
