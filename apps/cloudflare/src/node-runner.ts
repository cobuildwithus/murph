import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerRequest,
  type HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";

import { createHostedCliRuntime, createHostedInboxdRuntime } from "./runtime-adapter.js";

export async function runHostedExecutionJob(
  input: HostedExecutionRunnerRequest,
): Promise<HostedExecutionRunnerResult> {
  const cli = createHostedCliRuntime();
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-hosted-runner-"));

  try {
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeBundleBytes(input.bundles.agentState),
      vaultBundle: decodeBundleBytes(input.bundles.vault),
      workspaceRoot,
    });
    const requestId = input.dispatch.eventId;

    await ensureHostedBootstrap(restored.vaultRoot, input.dispatch, cli);

    switch (input.dispatch.event.kind) {
      case "member.activated":
        break;
      case "linq.message.received":
        await ingestHostedLinqMessage(restored.vaultRoot, {
          ...input.dispatch,
          event: input.dispatch.event,
        });
        await runHostedAssistantAutomation(restored.vaultRoot, requestId, cli);
        break;
      case "assistant.cron.tick":
        await runHostedAssistantAutomation(restored.vaultRoot, requestId, cli);
        break;
      default:
        assertNever(input.dispatch.event);
    }

    const bundles = await snapshotHostedExecutionContext({
      vaultRoot: restored.vaultRoot,
    });

    return {
      bundles: {
        agentState: encodeBundleBytes(bundles.agentStateBundle),
        vault: encodeBundleBytes(bundles.vaultBundle),
      },
      result: {
        eventsHandled: 1,
        summary: summarizeDispatch(input.dispatch),
      },
    };
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
  const vaultServices = cli.createIntegratedVaultCliServices();

  await vaultServices.core.init({
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

  await cli.runAssistantAutomation({
    inboxServices,
    once: true,
    requestId,
    startDaemon: false,
    vault: vaultRoot,
    vaultServices,
  });
}

function summarizeDispatch(dispatch: HostedExecutionDispatchRequest): string {
  switch (dispatch.event.kind) {
    case "member.activated":
      return "Initialized hosted member bundles.";
    case "linq.message.received":
      return "Persisted Linq capture and ran assistant automation once.";
    case "assistant.cron.tick":
      return `Processed assistant cron tick (${dispatch.event.reason}).`;
    default:
      return assertNever(dispatch.event);
  }
}

function encodeBundleBytes(value: Uint8Array | null): string | null {
  return value ? Buffer.from(value).toString("base64") : null;
}

function decodeBundleBytes(value: string | null): Uint8Array | null {
  return value ? Uint8Array.from(Buffer.from(value, "base64")) : null;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}
