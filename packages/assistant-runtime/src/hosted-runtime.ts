import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importSharePackIntoVault } from "@healthybob/core";
import {
  createDeviceSyncRegistry,
  createDeviceSyncService,
  createOuraDeviceSyncProvider,
  createWhoopDeviceSyncProvider,
} from "@healthybob/device-syncd";
import {
  createInboxPipeline,
  normalizeLinqWebhookEvent,
  openInboxRuntime,
  parseLinqWebhookEvent,
  rebuildRuntimeFromVault,
} from "@healthybob/inboxd";
import {
  createConfiguredParserRegistry,
  createInboxParserService,
} from "@healthybob/parsers";
import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
  type HostedExecutionBundleRef,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerRequest,
  type HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";
import {
  createIntegratedInboxCliServices,
  createIntegratedVaultCliServices,
  drainAssistantOutbox,
  getAssistantCronStatus,
  readAssistantAutomationState,
  refreshAssistantStatusSnapshot,
  runAssistantAutomation,
  saveAssistantAutomationState,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
} from "healthybob";

const HOSTED_MAX_PARSER_JOBS = 50;
const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_MAX_OUTBOX_DRAIN = 20;
const HOSTED_RUNTIME_CHILD_RESULT_PREFIX = "__HB_ASSISTANT_RUNTIME_RESULT__";
const HOSTED_RUNNER_COMMIT_BASE_URL = "http://commit.worker";
const HOSTED_RUNNER_OUTBOX_BASE_URL = "http://outbox.worker";

export interface HostedExecutionCommitCallback {
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
  token: string | null;
  url: string;
}

export interface HostedAssistantRuntimeConfig {
  commitBaseUrl?: string | null;
  commitTimeoutMs?: number | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  outboxBaseUrl?: string | null;
  userEnv?: Readonly<Record<string, string>>;
}

export interface HostedAssistantRuntimeJobRequest extends HostedExecutionRunnerRequest {
  commit?: HostedExecutionCommitCallback | null;
}

export interface HostedAssistantRuntimeJobInput {
  request: HostedAssistantRuntimeJobRequest;
  runtime?: HostedAssistantRuntimeConfig;
}

interface HostedAssistantRuntimeChildResult {
  ok: boolean;
  error?: {
    message: string;
    stack?: string | null;
  };
  result?: HostedExecutionRunnerResult;
}

export async function runHostedAssistantRuntimeJobInProcess(
  input: HostedAssistantRuntimeJobInput,
): Promise<HostedExecutionRunnerResult> {
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime);
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "healthybob-hosted-runner-"));

  try {
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(input.request.bundles.agentState),
      vaultBundle: decodeHostedBundleBase64(input.request.bundles.vault),
      workspaceRoot,
    });
    const requestId = input.request.dispatch.eventId;
    const runtimeEnv = {
      ...runtime.forwardedEnv,
      ...runtime.userEnv,
    };

    return await withHostedProcessEnvironment(
      {
        envOverrides: runtimeEnv,
        hostedMemberId: input.request.dispatch.event.userId,
        operatorHomeRoot: restored.operatorHomeRoot,
        vaultRoot: restored.vaultRoot,
      },
      async () => {
        await ensureHostedBootstrap(restored.vaultRoot, input.request.dispatch);
        let shareImportResult: Awaited<ReturnType<typeof importSharePackIntoVault>> | null = null;

        switch (input.request.dispatch.event.kind) {
          case "member.activated":
            break;
          case "linq.message.received":
            await ingestHostedLinqMessage(restored.vaultRoot, {
              ...input.request.dispatch,
              event: input.request.dispatch.event,
            });
            break;
          case "assistant.cron.tick":
          case "device-sync.wake":
            break;
          case "vault.share.accepted":
            shareImportResult = await importSharePackIntoVault({
              vaultRoot: restored.vaultRoot,
              pack: input.request.dispatch.event.pack,
            });
            break;
          default:
            assertNever(input.request.dispatch.event);
        }

        const parserResult = await drainHostedParserQueue(restored.vaultRoot);
        await runHostedAssistantAutomation(restored.vaultRoot, requestId);
        const assistantCronStatus = await getAssistantCronStatus(restored.vaultRoot);
        const deviceSyncResult = await runHostedDeviceSyncPass(restored.vaultRoot, runtimeEnv);
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
            summary: summarizeDispatch(input.request.dispatch, {
              deviceSyncProcessed: deviceSyncResult.processedJobs,
              deviceSyncSkipped: deviceSyncResult.skipped,
              parserProcessed: parserResult.processedJobs,
              shareImportResult,
            }),
          },
        };

        await commitHostedExecutionResult({
          commit: input.request.commit ?? null,
          dispatch: input.request.dispatch,
          result: committedResult,
          runtime,
        });

        await drainHostedAssistantOutboxAfterCommit({
          commit: input.request.commit ?? null,
          commitBaseUrl: runtime.commitBaseUrl,
          dispatch: input.request.dispatch,
          commitTimeoutMs: runtime.commitTimeoutMs,
          outboxBaseUrl: runtime.outboxBaseUrl,
          vaultRoot: restored.vaultRoot,
        });
        await refreshAssistantStatusSnapshot(restored.vaultRoot);

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
          commit: input.request.commit ?? null,
          committedResult,
          dispatch: input.request.dispatch,
          finalResult,
          runtime,
        });

        return finalResult;
      },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

export async function runHostedAssistantRuntimeJobIsolated(
  input: HostedAssistantRuntimeJobInput,
): Promise<HostedExecutionRunnerResult> {
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime);
  const childEntry = resolveHostedRuntimeChildEntry();
  const isTypeScriptChild = childEntry.endsWith(".ts");
  const childArgs = isTypeScriptChild
    ? ["--import", "tsx", childEntry]
    : [childEntry];

  return await new Promise<HostedExecutionRunnerResult>((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...runtime.forwardedEnv,
        ...(isTypeScriptChild
          ? {
              TSX_TSCONFIG_PATH: resolveHostedRuntimeTsconfigPath(),
            }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const settleError = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settleError(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      try {
        const payload = parseHostedRuntimeChildResult(stdout);

        if (!payload.ok) {
          settleError(
            new Error(
              payload.error?.message
                ?? `Hosted assistant runtime child exited with code ${code ?? "unknown"}.`,
            ),
          );
          return;
        }

        settled = true;
        resolve(payload.result as HostedExecutionRunnerResult);
      } catch (error) {
        settleError(
          new Error(
            [
              `Hosted assistant runtime child failed${code === null ? "" : ` with exit code ${code}`}.`,
              stderr.trim(),
              stdout.trim(),
              error instanceof Error ? error.message : String(error),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
      }
    });

    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ request: input.request, runtime }));
  });
}

export function formatHostedRuntimeChildResult(
  payload: HostedAssistantRuntimeChildResult,
): string {
  return `${HOSTED_RUNTIME_CHILD_RESULT_PREFIX}${Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64")}`;
}

export function parseHostedRuntimeChildResult(output: string): HostedAssistantRuntimeChildResult {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const encoded = [...lines]
    .reverse()
    .find((line) => line.startsWith(HOSTED_RUNTIME_CHILD_RESULT_PREFIX));

  if (!encoded) {
    throw new Error("Hosted assistant runtime child did not emit a result payload.");
  }

  return JSON.parse(
    Buffer.from(
      encoded.slice(HOSTED_RUNTIME_CHILD_RESULT_PREFIX.length),
      "base64",
    ).toString("utf8"),
  ) as HostedAssistantRuntimeChildResult;
}

function normalizeHostedAssistantRuntimeConfig(
  input: HostedAssistantRuntimeConfig | undefined,
): Required<Pick<HostedAssistantRuntimeConfig, "forwardedEnv" | "userEnv">> & {
  commitBaseUrl: string;
  commitTimeoutMs: number | null;
  outboxBaseUrl: string;
} {
  return {
    commitBaseUrl: normalizeCallbackBaseUrl(
      input?.commitBaseUrl,
      HOSTED_RUNNER_COMMIT_BASE_URL,
    ),
    commitTimeoutMs: input?.commitTimeoutMs ?? null,
    forwardedEnv: { ...(input?.forwardedEnv ?? {}) },
    outboxBaseUrl: normalizeCallbackBaseUrl(
      input?.outboxBaseUrl,
      HOSTED_RUNNER_OUTBOX_BASE_URL,
    ),
    userEnv: { ...(input?.userEnv ?? {}) },
  };
}

function resolveHostedRuntimeChildEntry(): string {
  const builtPath = fileURLToPath(new URL("./hosted-runtime-child.js", import.meta.url));

  if (existsSync(builtPath)) {
    return builtPath;
  }

  return fileURLToPath(new URL("./hosted-runtime-child.ts", import.meta.url));
}

function resolveHostedRuntimeTsconfigPath(): string {
  return fileURLToPath(new URL("../../../tsconfig.base.json", import.meta.url));
}

async function commitHostedExecutionResult(input: {
  commit: HostedExecutionCommitCallback | null;
  dispatch: HostedExecutionDispatchRequest;
  result: HostedExecutionRunnerResult;
  runtime: {
    commitBaseUrl: string;
    commitTimeoutMs: number | null;
  };
}): Promise<void> {
  if (!input.commit) {
    return;
  }

  const response = await fetch(
    buildHostedRunnerCommitUrl(
      input.runtime.commitBaseUrl,
      input.dispatch.event.userId,
      input.dispatch.eventId,
      "commit",
    ).toString(),
    {
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
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.runtime.commitTimeoutMs)),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Hosted runner durable commit failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}.`,
    );
  }
}

async function finalizeHostedExecutionResult(input: {
  commit: HostedExecutionCommitCallback | null;
  committedResult: HostedExecutionRunnerResult;
  dispatch: HostedExecutionDispatchRequest;
  finalResult: HostedExecutionRunnerResult;
  runtime: {
    commitBaseUrl: string;
    commitTimeoutMs: number | null;
  };
}): Promise<void> {
  if (!input.commit || sameHostedExecutionBundles(input.committedResult, input.finalResult)) {
    return;
  }

  const response = await fetch(
    buildHostedRunnerCommitUrl(
      input.runtime.commitBaseUrl,
      input.dispatch.event.userId,
      input.dispatch.eventId,
      "finalize",
    ).toString(),
    {
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
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.runtime.commitTimeoutMs)),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Hosted runner durable finalize failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}.`,
    );
  }
}

async function ensureHostedBootstrap(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
): Promise<void> {
  const requestId = dispatch.eventId;
  const inboxServices = createIntegratedInboxCliServices();
  const vaultServices = createIntegratedVaultCliServices();

  await vaultServices.core.init({
    requestId,
    vault: vaultRoot,
  });
  await inboxServices.init({
    rebuild: false,
    requestId,
    vault: vaultRoot,
  });
  const automationState = await readAssistantAutomationState(vaultRoot);
  const autoReplyChannels = automationState.autoReplyChannels.includes("linq")
    ? automationState.autoReplyChannels
    : [...automationState.autoReplyChannels, "linq"];

  await saveAssistantAutomationState(vaultRoot, {
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
  const runtime = await openInboxRuntime({
    vaultRoot,
  });

  try {
    await rebuildRuntimeFromVault({
      runtime,
      vaultRoot,
    });
    const event = parseLinqWebhookEvent(JSON.stringify(dispatch.event.linqEvent));
    const capture = await normalizeLinqWebhookEvent({
      defaultAccountId: dispatch.event.normalizedPhoneNumber,
      event,
    });
    const pipeline = await createInboxPipeline({
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

async function drainHostedAssistantOutboxAfterCommit(input: {
  commit: HostedExecutionCommitCallback | null;
  commitBaseUrl: string;
  commitTimeoutMs: number | null;
  dispatch: HostedExecutionDispatchRequest;
  outboxBaseUrl: string;
  vaultRoot: string;
}): Promise<void> {
  await drainAssistantOutbox({
    dispatchHooks: input.commit
      ? createHostedAssistantOutboxDispatchHooks({
          commit: input.commit,
          commitBaseUrl: input.commitBaseUrl,
          commitTimeoutMs: input.commitTimeoutMs,
          outboxBaseUrl: input.outboxBaseUrl,
          userId: input.dispatch.event.userId,
        })
      : undefined,
    limit: HOSTED_MAX_OUTBOX_DRAIN,
    vault: input.vaultRoot,
  });
}

function createHostedAssistantOutboxDispatchHooks(input: {
  commit: HostedExecutionCommitCallback;
  commitBaseUrl: string;
  commitTimeoutMs: number | null;
  outboxBaseUrl: string;
  userId: string;
}): AssistantOutboxDispatchHooks {
  return {
    persistDeliveredIntent: async ({ delivery, intent }: {
      delivery: AssistantChannelDelivery;
      intent: {
        dedupeKey: string;
        intentId: string;
      };
      vault: string;
    }) => {
      await callHostedRunnerOutboxJournal({
        commit: input.commit,
        commitBaseUrl: input.commitBaseUrl,
        commitTimeoutMs: input.commitTimeoutMs,
        delivery,
        intent,
        method: "PUT",
        outboxBaseUrl: input.outboxBaseUrl,
        userId: input.userId,
      });
    },
    resolveDeliveredIntent: async ({ intent }: {
      intent: {
        dedupeKey: string;
        intentId: string;
      };
      vault: string;
    }) => {
      const payload = await callHostedRunnerOutboxJournal({
        commit: input.commit,
        commitBaseUrl: input.commitBaseUrl,
        commitTimeoutMs: input.commitTimeoutMs,
        intent,
        method: "GET",
        outboxBaseUrl: input.outboxBaseUrl,
        userId: input.userId,
      });

      return payload.delivery;
    },
  };
}

async function callHostedRunnerOutboxJournal(input: {
  commit: HostedExecutionCommitCallback;
  commitBaseUrl: string;
  commitTimeoutMs: number | null;
  delivery?: AssistantChannelDelivery;
  intent: {
    dedupeKey: string;
    intentId: string;
  };
  method: "GET" | "PUT";
  outboxBaseUrl: string;
  userId: string;
}): Promise<{ delivery: AssistantChannelDelivery | null; intentId: string }> {
  const url = buildHostedRunnerOutboxUrl(
    input.outboxBaseUrl,
    input.userId,
    input.intent.intentId,
  );
  url.searchParams.set("dedupeKey", input.intent.dedupeKey);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
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
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs)),
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

function normalizeCallbackBaseUrl(value: string | null | undefined, fallback: string): string {
  const candidate = value && value.trim().length > 0 ? value : fallback;
  return new URL(candidate).toString();
}

function buildHostedRunnerCommitUrl(
  baseUrl: string,
  userId: string,
  eventId: string,
  action: "commit" | "finalize",
): URL {
  return new URL(
    `/internal/runner-events/${encodeURIComponent(userId)}/${encodeURIComponent(eventId)}/${action}`,
    baseUrl,
  );
}

function buildHostedRunnerOutboxUrl(baseUrl: string, userId: string, intentId: string): URL {
  return new URL(
    `/internal/runner-outbox/${encodeURIComponent(userId)}/${encodeURIComponent(intentId)}`,
    baseUrl,
  );
}

async function drainHostedParserQueue(vaultRoot: string): Promise<{ processedJobs: number }> {
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

async function runHostedDeviceSyncPass(
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

async function withHostedProcessEnvironment<T>(input: {
  envOverrides: Record<string, string>;
  hostedMemberId: string;
  operatorHomeRoot: string;
  vaultRoot: string;
}, run: () => Promise<T>): Promise<T> {
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

function sameHostedExecutionBundles(
  left: HostedExecutionRunnerResult,
  right: HostedExecutionRunnerResult,
): boolean {
  return (
    left.bundles.agentState === right.bundles.agentState
    && left.bundles.vault === right.bundles.vault
  );
}

export function readHostedRunnerCommitTimeoutMs(timeoutMs: number | null): number {
  if (timeoutMs !== null && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  return 30_000;
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

function assertNever(value: never): never {
  throw new Error(`Unexpected hosted execution event: ${JSON.stringify(value)}`);
}
