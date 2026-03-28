import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importSharePackIntoVault } from "@murph/core";
import {
  createDeviceSyncRegistry,
  createDeviceSyncService,
  createOuraDeviceSyncProvider,
  createWhoopDeviceSyncProvider,
} from "@murph/device-syncd";
import {
  createInboxPipeline,
  normalizeLinqWebhookEvent,
  openInboxRuntime,
  parseLinqWebhookEvent,
  rebuildRuntimeFromVault,
} from "@murph/inboxd";
import { normalizeParsedEmailMessage } from "@murph/inboxd/connectors/email/normalize-parsed";
import { parseRawEmailMessage } from "@murph/inboxd/connectors/email/parsed";
import {
  createConfiguredParserRegistry,
  createInboxParserService,
} from "@murph/parsers";
import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  restoreHostedExecutionContext,
  snapshotHostedExecutionContext,
} from "@murph/runtime-state";
import {
  buildHostedAssistantDeliverySideEffect,
  parseHostedExecutionSharePackResponse,
  parseHostedExecutionSideEffects,
  readHostedEmailCapabilities,
  resolveHostedEmailSelfAddresses,
  type HostedExecutionBundleRef,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerRequest,
  type HostedExecutionRunnerResult,
  type HostedExecutionSideEffect,
  type HostedExecutionSideEffectRecord,
} from "@murph/hosted-execution";
import {
  createIntegratedInboxCliServices,
} from "murph/inbox-services";
import {
  createIntegratedVaultCliServices,
} from "murph/vault-cli-services";
import {
  runAssistantAutomation,
} from "murph/assistant/automation";
import {
  getAssistantCronStatus,
} from "murph/assistant/cron";
import {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
} from "murph/assistant/outbox";
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from "murph/assistant/store";
import {
  refreshAssistantStatusSnapshot,
} from "murph/assistant/status";
import {
  buildHostedRunnerEmailMessageUrl,
  createHostedEmailChannelDependencies,
  normalizeHostedEmailBaseUrl,
} from "./hosted-email.ts";
import { reconcileHostedVerifiedEmailSelfTarget } from "./hosted-email-route.ts";

const HOSTED_MAX_PARSER_JOBS = 50;
const HOSTED_MAX_DEVICE_SYNC_JOBS = 20;
const HOSTED_MAX_COMMITTED_SIDE_EFFECTS = 20;
const HOSTED_RUNTIME_CHILD_RESULT_PREFIX = "__HB_ASSISTANT_RUNTIME_RESULT__";
const HOSTED_RUNNER_COMMIT_BASE_URL = "http://commit.worker";
const HOSTED_RUNNER_SIDE_EFFECTS_BASE_URL = "http://side-effects.worker";

export interface HostedExecutionCommitCallback {
  bundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
}

export interface HostedAssistantRuntimeConfig {
  commitBaseUrl?: string | null;
  commitTimeoutMs?: number | null;
  emailBaseUrl?: string | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  outboxBaseUrl?: string | null;
  sharePackBaseUrl?: string | null;
  sharePackToken?: string | null;
  sideEffectsBaseUrl?: string | null;
  userEnv?: Readonly<Record<string, string>>;
}

export interface HostedAssistantRuntimeJobRequest extends HostedExecutionRunnerRequest {
  commit?: HostedExecutionCommitCallback | null;
  resume?: {
    committedResult: {
      result: HostedExecutionRunnerResult["result"];
      sideEffects: HostedExecutionSideEffect[];
    };
  } | null;
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

interface HostedBootstrapResult {
  emailAutoReplyEnabled: boolean;
  vaultCreated: boolean;
}

interface NormalizedHostedAssistantRuntimeConfig {
  commitBaseUrl: string;
  commitTimeoutMs: number | null;
  emailBaseUrl: string;
  forwardedEnv: Record<string, string>;
  sharePackBaseUrl: string | null;
  sharePackToken: string | null;
  sideEffectsBaseUrl: string;
  userEnv: Record<string, string>;
}

interface HostedCommittedExecutionState {
  committedResult: HostedExecutionRunnerResult;
  committedSideEffects: HostedExecutionSideEffect[];
}

interface HostedDispatchExecutionMetrics {
  bootstrapResult: HostedBootstrapResult | null;
  shareImportResult: Awaited<ReturnType<typeof importSharePackIntoVault>> | null;
  shareImportTitle: string | null;
}

type HostedDispatchEvent = HostedExecutionDispatchRequest["event"];
type HostedRestoredExecutionContext = Awaited<ReturnType<typeof restoreHostedExecutionContext>>;

export async function runHostedAssistantRuntimeJobInProcess(
  input: HostedAssistantRuntimeJobInput,
): Promise<HostedExecutionRunnerResult> {
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime);
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-"));

  try {
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(input.request.bundles.agentState),
      vaultBundle: decodeHostedBundleBase64(input.request.bundles.vault),
      workspaceRoot,
    });
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
        const committedExecution = input.request.resume?.committedResult
          ? resumeHostedCommittedExecution(input.request)
          : await executeHostedDispatchForCommit({
              request: input.request,
              restored,
              runtime,
              runtimeEnv,
            });

        if (!input.request.resume?.committedResult) {
          await commitHostedExecutionResult({
            commit: input.request.commit ?? null,
            dispatch: input.request.dispatch,
            result: committedExecution.committedResult,
            sideEffects: committedExecution.committedSideEffects,
            runtime,
          });
        }
        return await completeHostedExecutionAfterCommit({
          commit: input.request.commit ?? null,
          dispatch: input.request.dispatch,
          runtime,
          restored,
          committedExecution,
        });
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
): NormalizedHostedAssistantRuntimeConfig {
  return {
    commitBaseUrl: normalizeCallbackBaseUrl(
      input?.commitBaseUrl,
      HOSTED_RUNNER_COMMIT_BASE_URL,
    ),
    commitTimeoutMs: input?.commitTimeoutMs ?? null,
    emailBaseUrl: normalizeHostedEmailBaseUrl(input?.emailBaseUrl),
    forwardedEnv: { ...(input?.forwardedEnv ?? {}) },
    sharePackBaseUrl: normalizeOptionalCallbackBaseUrl(
      input?.sharePackBaseUrl
        ?? input?.forwardedEnv?.HOSTED_ONBOARDING_PUBLIC_BASE_URL
        ?? null,
    ),
    sharePackToken: normalizeOptionalString(
      input?.sharePackToken
        ?? input?.forwardedEnv?.HOSTED_SHARE_INTERNAL_TOKEN
        ?? null,
    ),
    sideEffectsBaseUrl: normalizeCallbackBaseUrl(
      input?.sideEffectsBaseUrl ?? input?.outboxBaseUrl,
      HOSTED_RUNNER_SIDE_EFFECTS_BASE_URL,
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

function resumeHostedCommittedExecution(
  request: HostedAssistantRuntimeJobRequest,
): HostedCommittedExecutionState {
  return {
    committedResult: {
      bundles: {
        agentState: request.bundles.agentState,
        vault: request.bundles.vault,
      },
      result: request.resume!.committedResult.result,
    },
    committedSideEffects: parseHostedExecutionSideEffects(
      request.resume!.committedResult.sideEffects,
    ),
  };
}

async function executeHostedDispatchForCommit(input: {
  request: HostedAssistantRuntimeJobRequest;
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "emailBaseUrl" | "sharePackBaseUrl" | "sharePackToken"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
}): Promise<HostedCommittedExecutionState> {
  const requestId = input.request.dispatch.eventId;
  const dispatchMetrics = await executeHostedDispatchEvent({
    dispatch: input.request.dispatch,
    emailBaseUrl: input.runtime.emailBaseUrl,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    vaultRoot: input.restored.vaultRoot,
  });
  const parserResult = await drainHostedParserQueue(input.restored.vaultRoot);
  await runHostedAssistantAutomation(input.restored.vaultRoot, requestId);
  const assistantCronStatus = await getAssistantCronStatus(input.restored.vaultRoot);
  const deviceSyncResult = await runHostedDeviceSyncPass(input.restored.vaultRoot, input.runtimeEnv);
  const committedSnapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot: input.restored.operatorHomeRoot,
    vaultRoot: input.restored.vaultRoot,
  });
  const committedSideEffects = await collectHostedExecutionSideEffects(input.restored.vaultRoot);

  return {
    committedResult: {
      bundles: {
        agentState: encodeHostedBundleBase64(committedSnapshot.agentStateBundle),
        vault: encodeHostedBundleBase64(committedSnapshot.vaultBundle),
      },
      result: {
        eventsHandled: 1,
        nextWakeAt: assistantCronStatus.nextRunAt,
        summary: summarizeDispatch(input.request.dispatch, {
          bootstrapResult: dispatchMetrics.bootstrapResult,
          deviceSyncProcessed: deviceSyncResult.processedJobs,
          deviceSyncSkipped: deviceSyncResult.skipped,
          parserProcessed: parserResult.processedJobs,
          shareImportResult: dispatchMetrics.shareImportResult,
          shareImportTitle: dispatchMetrics.shareImportTitle,
        }),
      },
    },
    committedSideEffects,
  };
}

async function completeHostedExecutionAfterCommit(input: {
  commit: HostedExecutionCommitCallback | null;
  dispatch: HostedExecutionDispatchRequest;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitBaseUrl" | "commitTimeoutMs" | "emailBaseUrl" | "sideEffectsBaseUrl" | "userEnv"
  >;
  restored: HostedRestoredExecutionContext;
  committedExecution: HostedCommittedExecutionState;
}): Promise<HostedExecutionRunnerResult> {
  await drainHostedCommittedSideEffectsAfterCommit({
    commit: input.commit,
    commitTimeoutMs: input.runtime.commitTimeoutMs,
    dispatch: input.dispatch,
    emailBaseUrl: input.runtime.emailBaseUrl,
    sideEffectsBaseUrl: input.runtime.sideEffectsBaseUrl,
    sideEffects: input.committedExecution.committedSideEffects,
    vaultRoot: input.restored.vaultRoot,
  });
  await reconcileHostedVerifiedEmailSelfTarget({
    operatorHomeRoot: input.restored.operatorHomeRoot,
    source: input.runtime.userEnv,
    vaultRoot: input.restored.vaultRoot,
  });
  await refreshAssistantStatusSnapshot(input.restored.vaultRoot);

  const finalSnapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot: input.restored.operatorHomeRoot,
    vaultRoot: input.restored.vaultRoot,
  });
  const finalResult: HostedExecutionRunnerResult = {
    bundles: {
      agentState: encodeHostedBundleBase64(finalSnapshot.agentStateBundle),
      vault: encodeHostedBundleBase64(finalSnapshot.vaultBundle),
    },
    result: input.committedExecution.committedResult.result,
  };

  await finalizeHostedExecutionResult({
    commit: input.commit,
    committedResult: input.committedExecution.committedResult,
    dispatch: input.dispatch,
    finalResult,
    runtime: input.runtime,
  });

  return finalResult;
}

async function commitHostedExecutionResult(input: {
  commit: HostedExecutionCommitCallback | null;
  dispatch: HostedExecutionDispatchRequest;
  result: HostedExecutionRunnerResult;
  sideEffects: HostedExecutionSideEffect[];
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
      input.dispatch.eventId,
      "commit",
    ).toString(),
    {
      body: JSON.stringify({
        currentBundleRefs: input.commit.bundleRefs,
        ...input.result,
        sideEffects: input.sideEffects,
      }),
      headers: {
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
      input.dispatch.eventId,
      "finalize",
    ).toString(),
    {
      body: JSON.stringify({
        bundles: input.finalResult.bundles,
      }),
      headers: {
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

async function prepareHostedDispatchContext(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
  runtimeEnv: Readonly<Record<string, string>>,
): Promise<HostedBootstrapResult | null> {
  const bootstrapResult = dispatch.event.kind === "member.activated"
    ? await bootstrapHostedMemberContext(vaultRoot, dispatch, runtimeEnv)
    : null;

  await requireHostedBootstrapForDispatch(vaultRoot, dispatch);
  await prepareHostedLocalRuntime(vaultRoot, dispatch.eventId);
  return bootstrapResult;
}

async function executeHostedDispatchEvent(input: {
  dispatch: HostedExecutionDispatchRequest;
  emailBaseUrl: string;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "sharePackBaseUrl" | "sharePackToken">;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<HostedDispatchExecutionMetrics> {
  const bootstrapResult = await prepareHostedDispatchContext(
    input.vaultRoot,
    input.dispatch,
    input.runtimeEnv,
  );
  const dispatchEffect = await handleHostedDispatchEvent({
    dispatch: input.dispatch,
    emailBaseUrl: input.emailBaseUrl,
    runtime: input.runtime,
    vaultRoot: input.vaultRoot,
  });

  return {
    bootstrapResult,
    shareImportResult: dispatchEffect.shareImportResult,
    shareImportTitle: dispatchEffect.shareImportTitle,
  };
}

async function handleHostedDispatchEvent(input: {
  dispatch: HostedExecutionDispatchRequest;
  emailBaseUrl: string;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "sharePackBaseUrl" | "sharePackToken">;
  vaultRoot: string;
}): Promise<Pick<HostedDispatchExecutionMetrics, "shareImportResult" | "shareImportTitle">> {
  const dispatch = input.dispatch;

  switch (dispatch.event.kind) {
    case "member.activated":
      return {
        shareImportResult: null,
        shareImportTitle: null,
      };
    case "linq.message.received":
      await ingestHostedLinqMessage(input.vaultRoot, {
        ...dispatch,
        event: dispatch.event,
      });
      return {
        shareImportResult: null,
        shareImportTitle: null,
      };
    case "email.message.received":
      await ingestHostedEmailMessage(
        input.vaultRoot,
        {
          ...dispatch,
          event: dispatch.event,
        },
        input.emailBaseUrl,
      );
      return {
        shareImportResult: null,
        shareImportTitle: null,
      };
    case "assistant.cron.tick":
    case "device-sync.wake":
      return {
        shareImportResult: null,
        shareImportTitle: null,
      };
    case "vault.share.accepted":
      return await handleHostedShareAcceptedDispatch({
        dispatch: {
          ...dispatch,
          event: dispatch.event,
        },
        runtime: input.runtime,
        vaultRoot: input.vaultRoot,
      });
    default:
      return assertNever(dispatch.event);
  }
}

async function handleHostedShareAcceptedDispatch(
  input: {
    dispatch: HostedExecutionDispatchRequest & {
      event: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>;
    };
    runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "sharePackBaseUrl" | "sharePackToken">;
    vaultRoot: string;
  },
): Promise<Pick<HostedDispatchExecutionMetrics, "shareImportResult" | "shareImportTitle">> {
  const sharePayload = await fetchHostedSharePayload(
    input.dispatch.event.share,
    input.runtime,
  );

  return {
    shareImportResult: await importSharePackIntoVault({
      vaultRoot: input.vaultRoot,
      pack: sharePayload.pack,
    }),
    shareImportTitle: sharePayload.pack.title,
  };
}

async function fetchHostedSharePayload(
  share: Extract<HostedDispatchEvent, { kind: "vault.share.accepted" }>["share"],
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "sharePackBaseUrl" | "sharePackToken">,
): Promise<ReturnType<typeof parseHostedExecutionSharePackResponse>> {
  if (!runtime.sharePackBaseUrl || !runtime.sharePackToken) {
    throw new Error("Hosted share payload fetch is not configured.");
  }

  const url = new URL(
    `/api/hosted-share/internal/${encodeURIComponent(share.shareId)}/payload`,
    runtime.sharePackBaseUrl,
  );
  url.searchParams.set("shareCode", share.shareCode);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${runtime.sharePackToken}`,
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Hosted share payload fetch failed with HTTP ${response.status}${
        text ? `: ${text.slice(0, 500)}` : ""
      }.`,
    );
  }

  const payload = text.trim() ? JSON.parse(text) as unknown : null;
  return parseHostedExecutionSharePackResponse(payload);
}

async function bootstrapHostedMemberContext(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
  runtimeEnv: Readonly<Record<string, string>>,
): Promise<HostedBootstrapResult> {
  const requestId = dispatch.eventId;
  const vaultServices = createIntegratedVaultCliServices();
  const vaultMetadataPath = path.join(vaultRoot, "vault.json");
  const vaultCreated = !existsSync(vaultMetadataPath);

  if (vaultCreated) {
    await vaultServices.core.init({
      requestId,
      vault: vaultRoot,
    });
  }

  const automationState = await readAssistantAutomationState(vaultRoot);
  const nextAutoReplyChannels = [...automationState.autoReplyChannels];
  const emailAutoReplyEnabled = readHostedEmailCapabilities(runtimeEnv).sendReady
    && !nextAutoReplyChannels.includes("email");
  if (emailAutoReplyEnabled) {
    nextAutoReplyChannels.push("email");
  }

  if (emailAutoReplyEnabled) {
    await saveAssistantAutomationState(vaultRoot, {
      ...automationState,
      autoReplyChannels: nextAutoReplyChannels,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    emailAutoReplyEnabled,
    vaultCreated,
  };
}
async function requireHostedBootstrapForDispatch(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest,
): Promise<void> {
  if (existsSync(path.join(vaultRoot, "vault.json"))) {
    return;
  }

  if (dispatch.event.kind === "member.activated") {
    return;
  }

  throw new Error(
    `Hosted execution for ${dispatch.event.kind} requires member.activated bootstrap first.`,
  );
}

async function prepareHostedLocalRuntime(
  vaultRoot: string,
  requestId: string,
): Promise<void> {
  const inboxServices = createIntegratedInboxCliServices();
  await inboxServices.init({
    rebuild: false,
    requestId,
    vault: vaultRoot,
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
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

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
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot,
    });
    await pipeline.processCapture(capture);
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
  }
}

async function ingestHostedEmailMessage(
  vaultRoot: string,
  dispatch: HostedExecutionDispatchRequest & {
    event: Extract<HostedExecutionDispatchRequest["event"], { kind: "email.message.received" }>;
  },
  emailBaseUrl: string,
): Promise<void> {
  const response = await fetch(
    buildHostedRunnerEmailMessageUrl(emailBaseUrl, dispatch.event.rawMessageKey).toString(),
  );

  if (!response.ok) {
    throw new Error(
      `Hosted email message fetch failed for ${dispatch.event.userId}/${dispatch.event.rawMessageKey} with HTTP ${response.status}.`,
    );
  }

  const runtime = await openInboxRuntime({
    vaultRoot,
  });
  let pipeline: Awaited<ReturnType<typeof createInboxPipeline>> | null = null;

  try {
    await rebuildRuntimeFromVault({
      runtime,
      vaultRoot,
    });
    const capture = await normalizeParsedEmailMessage({
      accountAddress: dispatch.event.identityId,
      accountId: dispatch.event.identityId,
      message: parseRawEmailMessage(new Uint8Array(await response.arrayBuffer())),
      selfAddresses: resolveHostedEmailSelfAddresses({
        envelopeTo: dispatch.event.envelopeTo,
        senderIdentity: dispatch.event.identityId,
      }),
      source: "email",
      threadTarget: dispatch.event.threadTarget,
    });
    pipeline = await createInboxPipeline({
      runtime,
      vaultRoot,
    });
    await pipeline.processCapture(capture);
  } finally {
    if (pipeline) {
      pipeline.close();
    } else {
      runtime.close();
    }
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

async function collectHostedExecutionSideEffects(
  vaultRoot: string,
): Promise<HostedExecutionSideEffect[]> {
  const now = new Date();
  const intents = await listAssistantOutboxIntents(vaultRoot);

  return intents
    .filter((intent: Awaited<ReturnType<typeof listAssistantOutboxIntents>>[number]) =>
      shouldDispatchAssistantOutboxIntent(intent, now),
    )
    .slice(0, HOSTED_MAX_COMMITTED_SIDE_EFFECTS)
    .map((intent: Awaited<ReturnType<typeof listAssistantOutboxIntents>>[number]) =>
      buildHostedAssistantDeliverySideEffect({
        dedupeKey: intent.dedupeKey,
        intentId: intent.intentId,
      }),
    );
}

async function drainHostedCommittedSideEffectsAfterCommit(input: {
  commit: HostedExecutionCommitCallback | null;
  commitTimeoutMs: number | null;
  dispatch: HostedExecutionDispatchRequest;
  emailBaseUrl: string;
  sideEffectsBaseUrl: string;
  sideEffects: HostedExecutionSideEffect[];
  vaultRoot: string;
}): Promise<void> {
  for (const sideEffect of input.sideEffects) {
    await dispatchHostedCommittedSideEffect({
      commit: input.commit,
      commitTimeoutMs: input.commitTimeoutMs,
      emailBaseUrl: input.emailBaseUrl,
      sideEffect,
      sideEffectsBaseUrl: input.sideEffectsBaseUrl,
      userId: input.dispatch.event.userId,
      vaultRoot: input.vaultRoot,
    });
  }
}

async function dispatchHostedCommittedSideEffect(input: {
  commit: HostedExecutionCommitCallback;
  commitTimeoutMs: number | null;
  emailBaseUrl: string;
  sideEffect: HostedExecutionSideEffect;
  sideEffectsBaseUrl: string;
  userId: string;
  vaultRoot: string;
} | {
  commit: null;
  commitTimeoutMs: number | null;
  emailBaseUrl: string;
  sideEffect: HostedExecutionSideEffect;
  sideEffectsBaseUrl: string;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await dispatchAssistantOutboxIntent({
    dependencies: createHostedEmailChannelDependencies({
      emailBaseUrl: input.emailBaseUrl,
    }),
    dispatchHooks: input.commit
      ? createHostedAssistantDeliveryDispatchHooks({
          commit: input.commit,
          commitTimeoutMs: input.commitTimeoutMs,
          sideEffectsBaseUrl: input.sideEffectsBaseUrl,
          userId: input.userId,
        })
      : undefined,
    intentId: input.sideEffect.intentId,
    vault: input.vaultRoot,
  });
}

function createHostedAssistantDeliveryDispatchHooks(input: {
  commit: HostedExecutionCommitCallback;
  commitTimeoutMs: number | null;
  sideEffectsBaseUrl: string;
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
      await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        commitTimeoutMs: input.commitTimeoutMs,
        method: "PUT",
        record: {
          delivery,
          effectId: intent.intentId,
          fingerprint: intent.dedupeKey,
          intentId: intent.intentId,
          kind: "assistant.delivery",
          recordedAt: delivery.sentAt,
        },
        sideEffectsBaseUrl: input.sideEffectsBaseUrl,
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
      const record = await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        commitTimeoutMs: input.commitTimeoutMs,
        method: "GET",
        sideEffect: buildHostedAssistantDeliverySideEffect({
          dedupeKey: intent.dedupeKey,
          intentId: intent.intentId,
        }),
        sideEffectsBaseUrl: input.sideEffectsBaseUrl,
        userId: input.userId,
      });

      return record?.kind === "assistant.delivery" ? record.delivery : null;
    },
  };
}

async function callHostedRunnerSideEffectJournal(input:
  | {
      commit: HostedExecutionCommitCallback;
      commitTimeoutMs: number | null;
      method: "GET";
      sideEffect: HostedExecutionSideEffect;
      sideEffectsBaseUrl: string;
      userId: string;
    }
  | {
      commit: HostedExecutionCommitCallback;
      commitTimeoutMs: number | null;
      method: "PUT";
      record: HostedExecutionSideEffectRecord;
      sideEffectsBaseUrl: string;
      userId: string;
    }): Promise<HostedExecutionSideEffectRecord | null> {
  const sideEffect = input.method === "GET"
    ? input.sideEffect
    : buildHostedAssistantDeliverySideEffect({
        dedupeKey: input.record.fingerprint,
        intentId: input.record.intentId,
      });
  const url = buildHostedRunnerSideEffectUrl(input.sideEffectsBaseUrl, sideEffect.effectId);
  url.searchParams.set("fingerprint", sideEffect.fingerprint);
  url.searchParams.set("kind", sideEffect.kind);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      body: input.method === "PUT" ? JSON.stringify(input.record) : undefined,
      headers: {
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
    throw createHostedRunnerSideEffectJournalError(input, null, error);
  }

  if (!response.ok) {
    throw createHostedRunnerSideEffectJournalError(input, response.status);
  }

  const payload = (await response.json()) as {
    effectId: string;
    record: HostedExecutionSideEffectRecord | null;
  };

  return payload.record;
}

function normalizeOptionalCallbackBaseUrl(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? new URL(normalized).toString() : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCallbackBaseUrl(value: string | null | undefined, fallback: string): string {
  const candidate = value && value.trim().length > 0 ? value : fallback;
  return new URL(candidate).toString();
}

function buildHostedRunnerCommitUrl(
  baseUrl: string,
  eventId: string,
  action: "commit" | "finalize",
): URL {
  return new URL(`/events/${encodeURIComponent(eventId)}/${action}`, baseUrl);
}

function buildHostedRunnerSideEffectUrl(baseUrl: string, effectId: string): URL {
  return new URL(`/effects/${encodeURIComponent(effectId)}`, baseUrl);
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
    bootstrapResult: HostedBootstrapResult | null;
    deviceSyncProcessed: number;
    deviceSyncSkipped: boolean;
    parserProcessed: number;
    shareImportResult: Awaited<ReturnType<typeof importSharePackIntoVault>> | null;
    shareImportTitle: string | null;
  },
): string {
  const suffix = ` Parser jobs: ${metrics.parserProcessed}. Device sync jobs: ${metrics.deviceSyncProcessed}${metrics.deviceSyncSkipped ? " (skipped: providers not configured)." : "."}`;

  switch (dispatch.event.kind) {
    case "member.activated": {
      const bootstrapDetail = metrics.bootstrapResult
        ? [
            metrics.bootstrapResult.vaultCreated
              ? "created the canonical vault"
              : "reused the canonical vault",
            metrics.bootstrapResult.emailAutoReplyEnabled
              ? "enabled hosted email auto-reply"
              : "kept hosted email auto-reply unchanged",
          ].join("; ")
        : "bootstrap state unavailable";
      return `Processed member activation (${bootstrapDetail}) and ran the hosted maintenance loop.${suffix}`;
    }
    case "linq.message.received":
      return `Persisted Linq capture and ran the hosted maintenance loop.${suffix}`;
    case "email.message.received":
      return `Persisted hosted email capture and ran the hosted maintenance loop.${suffix}`;
    case "assistant.cron.tick":
      return `Processed assistant cron tick (${dispatch.event.reason}) and ran the hosted maintenance loop.${suffix}`;
    case "device-sync.wake":
      return `Processed device-sync wake (${dispatch.event.reason}) and ran the hosted maintenance loop.${suffix}`;
    case "vault.share.accepted": {
      const importedFoods = metrics.shareImportResult?.foods.length ?? 0;
      const importedProtocols = metrics.shareImportResult?.protocols.length ?? 0;
      const importedRecipes = metrics.shareImportResult?.recipes.length ?? 0;
      const loggedMeal = metrics.shareImportResult?.meal ? " Logged one meal entry from the shared food." : "";
      const title = metrics.shareImportTitle ?? dispatch.event.share.shareId;
      return `Imported share pack "${title}" (${importedFoods} foods, ${importedProtocols} protocols, ${importedRecipes} recipes).${loggedMeal}${suffix}`;
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

function createHostedRunnerSideEffectJournalError(
  input:
    | {
        method: "GET";
        sideEffect: HostedExecutionSideEffect;
        userId: string;
      }
    | {
        method: "PUT";
        record: HostedExecutionSideEffectRecord;
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
  const effectId = input.method === "GET" ? input.sideEffect.effectId : input.record.effectId;
  const error = new Error(
    status === null
      ? `Hosted runner side-effect journal ${input.method} failed for ${input.userId}/${effectId}.`
      : `Hosted runner side-effect journal ${input.method} failed for ${input.userId}/${effectId} with HTTP ${status}.`,
  ) as Error & {
    code: string;
    context: {
      retryable: true;
      status: number | null;
    };
    cause?: unknown;
    retryable: true;
  };

  error.code = "HOSTED_SIDE_EFFECT_JOURNAL_FAILED";
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
