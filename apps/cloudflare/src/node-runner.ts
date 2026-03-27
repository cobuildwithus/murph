import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importSharePackIntoVault } from "@healthybob/core";
import type { AssistantChannelDelivery, AssistantOutboxDispatchHooks } from "healthybob";

import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerRequest,
  type HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";

import type { HostedExecutionRunnerCommitRequest } from "./execution-journal.js";
import {
  createHostedCliRuntime,
  createHostedDeviceSyncRuntime,
  createHostedInboxdRuntime,
  createHostedParsersRuntime,
} from "./runtime-adapter.js";
import { loadHostedUserEnvForRunner } from "./user-env.js";

const HOSTED_MAX_PARSER_JOBS = 50;
const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_MAX_OUTBOX_DRAIN = 20;
let hostedExecutionRunQueue: Promise<void> = Promise.resolve();
let hostedExecutionRunStartHookForTests: (() => void) | null = null;

export interface HostedExecutionRunnerJobRequest extends HostedExecutionRunnerRequest {
  commit?: HostedExecutionRunnerCommitRequest | null;
}

export function setHostedExecutionRunStartHookForTests(hook: (() => void) | null): void {
  hostedExecutionRunStartHookForTests = hook;
}

export async function runHostedExecutionJob(
  input: HostedExecutionRunnerJobRequest,
): Promise<HostedExecutionRunnerResult> {
  return withHostedExecutionRunLock(async () => {
    const cli = createHostedCliRuntime();
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-hosted-runner-"));

    try {
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(input.bundles.agentState),
        vaultBundle: decodeHostedBundleBase64(input.bundles.vault),
        workspaceRoot,
      });
      const requestId = input.dispatch.eventId;
      const userEnvOverrides = await loadHostedUserEnvForRunner(restored.operatorHomeRoot, process.env);

      return await withHostedProcessEnvironment(
        {
          envOverrides: userEnvOverrides,
          hostedMemberId: input.dispatch.event.userId,
          operatorHomeRoot: restored.operatorHomeRoot,
          vaultRoot: restored.vaultRoot,
        },
        async () => {
          await ensureHostedBootstrap(restored.vaultRoot, input.dispatch, cli);
          let shareImportResult: Awaited<ReturnType<typeof importSharePackIntoVault>> | null = null;

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
            case "vault.share.accepted":
              shareImportResult = await importSharePackIntoVault({
                vaultRoot: restored.vaultRoot,
                pack: input.dispatch.event.pack,
              });
              break;
            default:
              assertNever(input.dispatch.event);
          }

          const parserResult = await drainHostedParserQueue(restored.vaultRoot);
          await runHostedAssistantAutomation(restored.vaultRoot, requestId, cli);
          const assistantCronStatus = await cli.getAssistantCronStatus(restored.vaultRoot);
          const deviceSyncResult = await runHostedDeviceSyncPass(restored.vaultRoot);
          const committedSnapshot = await snapshotHostedExecutionContext({
            operatorHomeRoot: restored.operatorHomeRoot,
            vaultRoot: restored.vaultRoot,
          });

          const committedResult: HostedExecutionRunnerResult = {
            bundles: {
              agentState: encodeHostedBundleBase64(committedSnapshot.agentStateBundle),
              vault: encodeHostedBundleBase64(committedSnapshot.vaultBundle),
            },
            result: {
              eventsHandled: 1,
              nextWakeAt: assistantCronStatus.nextRunAt,
              summary: summarizeDispatch(input.dispatch, {
                deviceSyncProcessed: deviceSyncResult.processedJobs,
                deviceSyncSkipped: deviceSyncResult.skipped,
                parserProcessed: parserResult.processedJobs,
                shareImportResult,
              }),
            },
          };

          await commitHostedExecutionResult({
            commit: input.commit ?? null,
            dispatch: input.dispatch,
            result: committedResult,
          });

          await drainHostedAssistantOutboxAfterCommit({
            cli,
            commit: input.commit ?? null,
            dispatch: input.dispatch,
            vaultRoot: restored.vaultRoot,
          });
          await cli.refreshAssistantStatusSnapshot(restored.vaultRoot);

          const finalSnapshot = await snapshotHostedExecutionContext({
            operatorHomeRoot: restored.operatorHomeRoot,
            vaultRoot: restored.vaultRoot,
          });
          const finalResult: HostedExecutionRunnerResult = {
            bundles: {
              agentState: encodeHostedBundleBase64(finalSnapshot.agentStateBundle),
              vault: encodeHostedBundleBase64(finalSnapshot.vaultBundle),
            },
            result: committedResult.result,
          };

          await finalizeHostedExecutionResult({
            commit: input.commit ?? null,
            dispatch: input.dispatch,
            committedResult,
            finalResult,
          });

          return finalResult;
        },
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
}

async function withHostedExecutionRunLock<T>(run: () => Promise<T>): Promise<T> {
  const previousRun = hostedExecutionRunQueue;
  let release: (() => void) | null = null;

  hostedExecutionRunQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previousRun.catch(() => {});

  try {
    hostedExecutionRunStartHookForTests?.();
    return await run();
  } finally {
    release?.();
  }
}

async function commitHostedExecutionResult(input: {
  commit: HostedExecutionRunnerCommitRequest | null;
  dispatch: HostedExecutionDispatchRequest;
  result: HostedExecutionRunnerResult;
}): Promise<void> {
  if (!input.commit) {
    return;
  }

  const response = await fetch(input.commit.url, {
    body: JSON.stringify({
      currentBundleRefs: input.commit.bundleRefs,
      ...input.result,
    }),
    headers: {
      ...(input.commit.token
        ? {
            authorization: `Bearer ${input.commit.token}`,
          }
        : {}),
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
    signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs()),
  });

  if (!response.ok) {
    throw new Error(
      `Hosted runner durable commit failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}.`,
    );
  }
}

async function finalizeHostedExecutionResult(input: {
  commit: HostedExecutionRunnerCommitRequest | null;
  committedResult: HostedExecutionRunnerResult;
  dispatch: HostedExecutionDispatchRequest;
  finalResult: HostedExecutionRunnerResult;
}): Promise<void> {
  if (!input.commit || sameHostedExecutionBundles(input.committedResult, input.finalResult)) {
    return;
  }

  const finalizeUrl = new URL(input.commit.url);
  finalizeUrl.pathname = finalizeUrl.pathname.replace(/\/commit$/u, "/finalize");
  const response = await fetch(finalizeUrl, {
    body: JSON.stringify({
      bundles: input.finalResult.bundles,
    }),
    headers: {
      ...(input.commit.token
        ? {
            authorization: `Bearer ${input.commit.token}`,
          }
        : {}),
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
    signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs()),
  });

  if (!response.ok) {
    throw new Error(
      `Hosted runner durable finalize failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}.`,
    );
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
      deliveryDispatchMode: "queue-only",
      drainOutbox: false,
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

async function drainHostedAssistantOutboxAfterCommit(input: {
  cli: ReturnType<typeof createHostedCliRuntime>;
  commit: HostedExecutionRunnerCommitRequest | null;
  dispatch: HostedExecutionDispatchRequest;
  vaultRoot: string;
}): Promise<void> {
  await input.cli.drainAssistantOutbox({
    dispatchHooks: input.commit
      ? createHostedAssistantOutboxDispatchHooks({
          commit: input.commit,
          userId: input.dispatch.event.userId,
        })
      : undefined,
    limit: HOSTED_MAX_OUTBOX_DRAIN,
    vault: input.vaultRoot,
  });
}

function createHostedAssistantOutboxDispatchHooks(input: {
  commit: HostedExecutionRunnerCommitRequest;
  userId: string;
}): AssistantOutboxDispatchHooks {
  return {
    persistDeliveredIntent: async ({ delivery, intent }) => {
      await callHostedRunnerOutboxJournal({
        commit: input.commit,
        delivery,
        intent,
        method: "PUT",
        userId: input.userId,
      });
    },
    resolveDeliveredIntent: async ({ intent }) => {
      const payload = await callHostedRunnerOutboxJournal({
        commit: input.commit,
        intent,
        method: "GET",
        userId: input.userId,
      });

      return payload.delivery;
    },
  };
}

async function callHostedRunnerOutboxJournal(input: {
  commit: HostedExecutionRunnerCommitRequest;
  delivery?: AssistantChannelDelivery;
  intent: {
    dedupeKey: string;
    intentId: string;
  };
  method: "GET" | "PUT";
  userId: string;
}): Promise<{ delivery: AssistantChannelDelivery | null; intentId: string }> {
  const commitUrl = new URL(input.commit.url);
  const url = new URL(
    `/internal/runner-outbox/${encodeURIComponent(input.userId)}/${encodeURIComponent(input.intent.intentId)}`,
    `${commitUrl.protocol}//${commitUrl.host}`,
  );
  url.searchParams.set("dedupeKey", input.intent.dedupeKey);

  let response: Response
  try {
    response = await fetch(url, {
      body: input.method === "PUT"
        ? JSON.stringify({
            dedupeKey: input.intent.dedupeKey,
            delivery: input.delivery,
          })
        : undefined,
      headers: {
        ...(input.commit.token
          ? {
              authorization: `Bearer ${input.commit.token}`,
            }
          : {}),
        ...(input.method === "PUT"
          ? {
              "content-type": "application/json; charset=utf-8",
            }
          : {}),
      },
      method: input.method,
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs()),
    });
  } catch (error) {
    throw createHostedRunnerOutboxJournalError(input, null, error);
  }

  if (!response.ok) {
    throw createHostedRunnerOutboxJournalError(input, response.status);
  }

  return (await response.json()) as {
    delivery: AssistantChannelDelivery | null;
    intentId: string;
  };
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
    shareImportResult: Awaited<ReturnType<typeof importSharePackIntoVault>> | null;
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
    case "vault.share.accepted": {
      const importedFoods = metrics.shareImportResult?.foods.length ?? 0;
      const importedProtocols = metrics.shareImportResult?.protocols.length ?? 0;
      const importedRecipes = metrics.shareImportResult?.recipes.length ?? 0;
      const loggedMeal = metrics.shareImportResult?.meal ? " Logged one meal entry from the shared food." : "";
      return `Imported share pack "${dispatch.event.pack.title}" (${importedFoods} foods, ${importedProtocols} protocols, ${importedRecipes} recipes).${loggedMeal}${suffix}`;
    }
    default:
      return assertNever(dispatch.event);
  }
}

async function withHostedProcessEnvironment<T>(
  input: {
    envOverrides: Record<string, string>;
    hostedMemberId: string;
    operatorHomeRoot: string;
    vaultRoot: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  const previousValues = new Map<string, string | undefined>();
  const nextValues: Record<string, string> = {
    ...input.envOverrides,
    HOSTED_MEMBER_ID: input.hostedMemberId,
    HOME: input.operatorHomeRoot,
    VAULT: input.vaultRoot,
  };

  for (const [key, value] of Object.entries(nextValues)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const [key, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}

function sameHostedExecutionBundles(
  left: HostedExecutionRunnerResult,
  right: HostedExecutionRunnerResult,
): boolean {
  return (
    left.bundles.agentState === right.bundles.agentState
    && left.bundles.vault === right.bundles.vault
  );
}

function createHostedRunnerOutboxJournalError(
  input: {
    intent: {
      intentId: string;
    };
    method: "GET" | "PUT";
    userId: string;
  },
  status: number | null,
  cause?: unknown,
): Error & {
  code: string;
  context: {
    retryable: true;
    status: number | null;
  };
  retryable: true;
} {
  const error = new Error(
    status === null
      ? `Hosted runner outbox journal ${input.method} failed for ${input.userId}/${input.intent.intentId}.`
      : `Hosted runner outbox journal ${input.method} failed for ${input.userId}/${input.intent.intentId} with HTTP ${status}.`,
  ) as Error & {
    code: string;
    context: {
      retryable: true;
      status: number | null;
    };
    cause?: unknown;
    retryable: true;
  };

  error.code = "HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED";
  error.context = {
    retryable: true,
    status,
  };
  error.retryable = true;
  if (cause !== undefined) {
    error.cause = cause;
  }

  return error;
}

function readHostedRunnerCommitTimeoutMs(
  source: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return parsePositiveInteger(
    source.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS,
    30_000,
    "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
  );
}

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return parsed;
}
