import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerRequest,
  type HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";

import {
  createHostedCliRuntime,
  createHostedDeviceSyncRuntime,
  createHostedInboxdRuntime,
  createHostedParsersRuntime,
} from "./runtime-adapter.js";

const HOSTED_MAX_PARSER_JOBS = 50;
const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;

export async function runHostedExecutionJob(
  input: HostedExecutionRunnerRequest,
): Promise<HostedExecutionRunnerResult> {
  const cli = createHostedCliRuntime();
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-hosted-runner-"));

  try {
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(input.bundles.agentState),
      vaultBundle: decodeHostedBundleBase64(input.bundles.vault),
      workspaceRoot,
    });
    const requestId = input.dispatch.eventId;

    return await withHostedProcessEnvironment(
      {
        operatorHomeRoot: restored.operatorHomeRoot,
        vaultRoot: restored.vaultRoot,
      },
      async () => {
        await ensureHostedBootstrap(restored.vaultRoot, input.dispatch, cli);

        switch (input.dispatch.event.kind) {
          case "member.activated":
            break;
          case "linq.message.received":
            await ingestHostedLinqMessage(restored.vaultRoot, {
              ...input.dispatch,
              event: input.dispatch.event,
            });
            break;
          case "assistant.cron.tick":
          case "device-sync.wake":
            break;
          default:
            assertNever(input.dispatch.event);
        }

        const parserResult = await drainHostedParserQueue(restored.vaultRoot);
        await runHostedAssistantAutomation(restored.vaultRoot, requestId, cli);
        const deviceSyncResult = await runHostedDeviceSyncPass(restored.vaultRoot);
        const bundles = await snapshotHostedExecutionContext({
          operatorHomeRoot: restored.operatorHomeRoot,
          vaultRoot: restored.vaultRoot,
        });

        return {
          bundles: {
            agentState: encodeHostedBundleBase64(bundles.agentStateBundle),
            vault: encodeHostedBundleBase64(bundles.vaultBundle),
          },
          result: {
            eventsHandled: 1,
            summary: summarizeDispatch(input.dispatch, {
              deviceSyncProcessed: deviceSyncResult.processedJobs,
              deviceSyncSkipped: deviceSyncResult.skipped,
              parserProcessed: parserResult.processedJobs,
            }),
          },
        };
      },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

async function ensureHostedBootstrap(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
  cli: ReturnType<typeof createHostedCliRuntime>,
): Promise<void> {
  const requestId = dispatch.eventId;
  const inboxServices = cli.createIntegratedInboxCliServices();
  const vaultServices = cli.createIntegratedVaultCliServices();

  await vaultServices.core.init({
    requestId,
    vault: vaultRoot,
  });
  await inboxServices.init({
    rebuild: false,
    requestId,
    vault: vaultRoot,
  });
  const automationState = await cli.readAssistantAutomationState(vaultRoot);
  const autoReplyChannels = automationState.autoReplyChannels.includes("linq")
    ? automationState.autoReplyChannels
    : [...automationState.autoReplyChannels, "linq"];

  await cli.saveAssistantAutomationState(vaultRoot, {
    ...automationState,
    autoReplyChannels,
    updatedAt: new Date().toISOString(),
  });
}

async function ingestHostedLinqMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "linq.message.received" }>;
  },
): Promise<void> {
  const inboxd = createHostedInboxdRuntime();
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot,
  });

  try {
    await inboxd.rebuildRuntimeFromVault({
      runtime,
      vaultRoot,
    });
    const event = inboxd.parseLinqWebhookEvent(JSON.stringify(dispatch.event.linqEvent));
    const capture = await inboxd.normalizeLinqWebhookEvent({
      defaultAccountId: dispatch.event.normalizedPhoneNumber,
      event,
    });
    const pipeline = await inboxd.createInboxPipeline({
      runtime,
      vaultRoot,
    });

    try {
      await pipeline.processCapture(capture);
    } finally {
      pipeline.close();
    }
  } finally {
    runtime.close();
  }
}

async function runHostedAssistantAutomation(
  vaultRoot: string,
  requestId: string,
  cli: ReturnType<typeof createHostedCliRuntime>,
): Promise<void> {
  const inboxServices = cli.createIntegratedInboxCliServices();
  const vaultServices = cli.createIntegratedVaultCliServices();

  try {
    await cli.runAssistantAutomation({
      inboxServices,
      once: true,
      requestId,
      startDaemon: false,
      vault: vaultRoot,
      vaultServices,
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "INBOX_NOT_INITIALIZED"
    ) {
      return;
    }

    throw error;
  }
}

async function drainHostedParserQueue(vaultRoot: string): Promise<{ processedJobs: number }> {
  const inboxd = createHostedInboxdRuntime();
  const parsers = createHostedParsersRuntime();
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot,
  });

  try {
    await inboxd.rebuildRuntimeFromVault({
      runtime,
      vaultRoot,
    });
    const configured = await parsers.createConfiguredParserRegistry({
      vaultRoot,
    });
    const parserService = parsers.createInboxParserService({
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

async function runHostedDeviceSyncPass(
  vaultRoot: string,
): Promise<{ processedJobs: number; skipped: boolean }> {
  const service = createHostedDeviceSyncRuntime({
    vaultRoot,
  });

  if (!service) {
    return {
      processedJobs: 0,
      skipped: true,
    };
  }

  try {
    await service.runSchedulerOnce();
    return {
      processedJobs: await service.drainWorker(HOSTED_MAX_DEVICE_SYNC_JOBS),
      skipped: false,
    };
  } finally {
    service.close();
  }
}

function summarizeDispatch(
  dispatch: HostedExecutionDispatchRequest,
  metrics: {
    deviceSyncProcessed: number;
    deviceSyncSkipped: boolean;
    parserProcessed: number;
  },
): string {
  const suffix = ` Parser jobs: ${metrics.parserProcessed}. Device sync jobs: ${metrics.deviceSyncProcessed}${metrics.deviceSyncSkipped ? " (skipped: providers not configured)." : "."}`;

  switch (dispatch.event.kind) {
    case "member.activated":
      return `Initialized hosted member bundles and ran the hosted maintenance loop.${suffix}`;
    case "linq.message.received":
      return `Persisted Linq capture and ran the hosted maintenance loop.${suffix}`;
    case "assistant.cron.tick":
      return `Processed assistant cron tick (${dispatch.event.reason}) and ran the hosted maintenance loop.${suffix}`;
    case "device-sync.wake":
      return `Processed device-sync wake (${dispatch.event.reason}) and ran the hosted maintenance loop.${suffix}`;
    default:
      return assertNever(dispatch.event);
  }
}

async function withHostedProcessEnvironment<T>(
  input: {
    operatorHomeRoot: string;
    vaultRoot: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  const previousHome = process.env.HOME;
  const previousVault = process.env.VAULT;

  process.env.HOME = input.operatorHomeRoot;
  process.env.VAULT = input.vaultRoot;

  try {
    return await run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousVault === undefined) {
      delete process.env.VAULT;
    } else {
      process.env.VAULT = previousVault;
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}
