import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

import { MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE } from "@murphai/contracts";
import { buildSharePackFromVault, initializeVault, listFoods, upsertFood, upsertProtocolItem } from "@murphai/core";
import { createInboxPipeline, openInboxRuntime, rebuildRuntimeFromVault } from "@murphai/inboxd";
import {
  decodeHostedBundleBase64,
  encodeHostedBundleBase64,
  listPendingAssistantUsageRecords,
  parseHostedEmailThreadTarget,
  resolveAssistantStatePaths,
  restoreHostedExecutionContext as restoreHostedExecutionContextActual,
  snapshotHostedExecutionContext as snapshotHostedExecutionContextActual,
  writePendingAssistantUsageRecord,
} from "@murphai/runtime-state/node";
import { assistantOutboxIntentSchema } from "@murphai/operator-config/assistant-cli-contracts";
import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
} from "@murphai/operator-config/hosted-assistant-config";
import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionRuntimeTimerWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionVaultShareAcceptedWake,
  type HostedExecutionBundlePayload,
  type HostedExecutionMemberChannels,
  type HostedExecutionRunnerSharePack,
  type HostedExecutionTelegramMessage,
  type HostedIngressEnvelope,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";

const hostedCliMocks = vi.hoisted(() => ({
  dispatchAssistantOutboxIntent: vi.fn(),
  runAssistantAutomation: vi.fn(),
}));
const ASSISTANT_AUTOMATION_STATE_FILENAME =
  path.basename(resolveAssistantStatePaths("/tmp/placeholder").automationStatePath);

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );
  return {
    ...actual,
    dispatchAssistantOutboxIntent: (...args: Parameters<typeof actual.dispatchAssistantOutboxIntent>) =>
      hostedCliMocks.dispatchAssistantOutboxIntent(...args),
    runAssistantAutomation: (...args: Parameters<typeof actual.runAssistantAutomation>) =>
      hostedCliMocks.runAssistantAutomation(...args),
  };
});

import {
  buildHostedExecutionJobRuntime,
  createHostedExecutionJobRunner,
} from "../src/node-runner.ts";
import { HOSTED_RUNNER_ENV_KEY_NAMES } from "../src/hosted-env-policy.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

const describe = baseDescribe.sequential;
const initialGlobalFetch = global.fetch;
const TEST_INTERNAL_WORKER_PROXY_TOKEN = 'test-hosted-proxy-token'
const HOSTED_DEVICE_SYNC_ENV_PREFIXES = [
  "DEVICE_SYNC_",
  "GARMIN_",
  "OURA_",
  "WHOOP_",
] as const;
const MEMBER_CHANNELS_NONE = {
  email: false,
  linq: false,
  telegram: false,
} as const;
const MEMBER_CHANNELS_EMAIL = {
  ...MEMBER_CHANNELS_NONE,
  email: true,
} as const;
const MEMBER_CHANNELS_LINQ = {
  ...MEMBER_CHANNELS_NONE,
  linq: true,
} as const;
const SIGNUP_WELCOME_INSTRUCTIONS = [
  "A new user has completed signup for Murph.",
  "Send exactly this message and nothing else:",
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
].join("\n\n");
let runHostedExecutionJobInternal = createHostedExecutionJobRunner({
  runMode: "in-process",
});

function createActivationWake(input: {
  eventId: string;
  memberChannels: HostedExecutionMemberChannels;
  occurredAt: string;
  userId: string;
}): HostedIngressEnvelope {
  return buildHostedExecutionMemberActivatedWake({
    eventId: input.eventId,
    memberChannels: input.memberChannels,
    memberId: input.userId,
    occurredAt: input.occurredAt,
  });
}

function createLinqThreadSignupWelcomeWake(input: {
  eventId: string;
  identityId: string;
  occurredAt: string;
  threadId: string;
  threadIsDirect: boolean;
  userId: string;
}): HostedIngressEnvelope {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: input.eventId,
    memberId: input.userId,
    notification: {
      deliveryDedupeToken: `signup-welcome:${input.userId}`,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: `signup-welcome:${input.userId}`,
      firstContact: {
        markSeenOnDeliveryAccepted: true,
      },
      instructions: SIGNUP_WELCOME_INSTRUCTIONS,
      responsePolicy: {
        kind: "require_send_exact_text",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      },
      route: {
        actorId: null,
        channel: "linq",
        delivery: {
          kind: "thread",
          target: input.threadId,
        },
        identityId: input.identityId,
        threadId: input.threadId,
        threadIsDirect: input.threadIsDirect,
      },
    },
    occurredAt: input.occurredAt,
  });
}

function createChannelsUpdatedWake(input: {
  eventId: string;
  memberChannels: HostedExecutionMemberChannels;
  occurredAt: string;
  userId: string;
}): HostedIngressEnvelope {
  return buildHostedExecutionMemberChannelsUpdatedWake({
    eventId: input.eventId,
    memberChannels: input.memberChannels,
    memberId: input.userId,
    occurredAt: input.occurredAt,
  });
}

function createCronWake(input: {
  eventId: string;
  occurredAt: string;
  reason: "alarm" | "manual" | "device-sync";
  userId: string;
}): HostedRuntimeEvent {
  return buildHostedExecutionRuntimeTimerWake({
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    triggerKind: "runtime_timer",
    userId: input.userId,
  });
}

function createRuntimeTimerWake(input: {
  eventId: string;
  occurredAt: string;
  triggerKind?: "manual_repair" | "retry_finalize" | "runtime_timer";
  userId: string;
}) {
  return buildHostedExecutionRuntimeTimerWake({
    eventId: input.eventId,
    occurredAt: input.occurredAt,
    triggerKind: input.triggerKind ?? "runtime_timer",
    userId: input.userId,
  });
}

function createTelegramWake(input: {
  eventId: string;
  occurredAt: string;
  telegramMessage: HostedExecutionTelegramMessage;
  userId: string;
}): HostedIngressEnvelope {
  return buildHostedExecutionTelegramConversationMessageWake(input);
}

function createEmailWake(input: {
  eventId: string;
  identityId: string | null;
  occurredAt: string;
  rawMessageKey: string;
  selfAddress?: string | null;
  userId: string;
}): HostedIngressEnvelope {
  return buildHostedExecutionEmailConversationMessageWake(input);
}

function createShareAcceptedWake(input: {
  eventId: string;
  occurredAt: string;
  ownerUserId: string;
  shareId: string;
  userId: string;
}): HostedIngressEnvelope {
  return buildHostedExecutionVaultShareAcceptedWake({
    eventId: input.eventId,
    memberId: input.userId,
    occurredAt: input.occurredAt,
    share: {
      ownerUserId: input.ownerUserId,
      shareId: input.shareId,
    },
  });
}

type NodeRunnerTestInput =
  Pick<
    HostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "userEnv"
  > & {
    internalWorkerProxyToken?: string | null;
    bundles:
      | HostedAssistantRuntimeJobInput["request"]["bundle"]
      | {
        agentState: HostedExecutionBundlePayload;
        vault: HostedExecutionBundlePayload;
      };
    commit?: {
      bundleRef?: HostedAssistantRuntimeJobInput["request"]["currentBundleRef"] | null;
      bundleRefs?: {
        agentState: null;
        vault: HostedAssistantRuntimeJobInput["request"]["currentBundleRef"] | null;
      };
    };
  } & Omit<
    HostedAssistantRuntimeJobInput["request"],
    "bundle" | "currentBundleRef" | "run" | "runDrain"
  > & {
    run?: HostedAssistantRuntimeJobInput["request"]["run"];
    runDrain?: HostedAssistantRuntimeJobInput["request"]["runDrain"];
    sharePack?: HostedExecutionRunnerSharePack | null;
    wake: HostedRuntimeEvent;
  };

async function snapshotHostedExecutionContext(
  input: Parameters<typeof snapshotHostedExecutionContextActual>[0],
) {
  const snapshot = await snapshotHostedExecutionContextActual(input);

  return {
    agentStateBundle: snapshot.bundle,
    bundle: snapshot.bundle,
    vaultBundle: snapshot.bundle,
  };
}

function normalizeFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Request {
  return input instanceof Request ? input : new Request(input, init)
}

async function readFetchRequestBody(request: Request): Promise<unknown> {
  const body = await request.text()
  return body.length > 0 ? JSON.parse(body) : null
}

function installSentAssistantOutboxDispatchMock(input: {
  delivery: Record<string, unknown>;
  intentId: string;
  sentAt: string;
}): void {
  hostedCliMocks.dispatchAssistantOutboxIntent.mockImplementationOnce(async ({ intentId, vault }) => {
    if (intentId !== input.intentId) {
      throw new Error(`Unexpected assistant outbox intent id: ${intentId}`);
    }

    const intentPath = path.join(resolveAssistantStatePaths(vault).outboxDirectory, `${intentId}.json`);
    const currentIntent = assistantOutboxIntentSchema.parse(
      JSON.parse(await readFile(intentPath, "utf8")),
    );
    const sentIntent = assistantOutboxIntentSchema.parse({
      ...currentIntent,
      attemptCount: currentIntent.attemptCount + 1,
      delivery: input.delivery,
      deliveryConfirmationPending: false,
      lastAttemptAt: input.sentAt,
      lastError: null,
      nextAttemptAt: null,
      sentAt: input.sentAt,
      status: "sent",
      updatedAt: input.sentAt,
    });
    await writeFile(intentPath, `${JSON.stringify(sentIntent)}\n`);

    return {
      deliveryError: null,
      intent: sentIntent,
      session: null,
    };
  });
}

async function restoreHostedExecutionContext(input: {
  agentStateBundle?: ArrayBuffer | Uint8Array | null;
  artifactResolver?: Parameters<typeof restoreHostedExecutionContextActual>[0]["artifactResolver"];
  bundle?: ArrayBuffer | Uint8Array | null;
  shouldRestoreArtifact?: Parameters<typeof restoreHostedExecutionContextActual>[0]["shouldRestoreArtifact"];
  vaultBundle?: ArrayBuffer | Uint8Array | null;
  workspaceRoot: string;
}) {
  return restoreHostedExecutionContextActual({
    ...(input.artifactResolver ? { artifactResolver: input.artifactResolver } : {}),
    bundle: input.bundle ?? input.vaultBundle ?? input.agentStateBundle ?? null,
    ...(input.shouldRestoreArtifact ? { shouldRestoreArtifact: input.shouldRestoreArtifact } : {}),
    workspaceRoot: input.workspaceRoot,
  });
}

async function readAssistantAutomationState(assistantStateRoot: string): Promise<{
  autoReplyChannels: string[];
}> {
  try {
    const automationStatePath = path.join(
      assistantStateRoot,
      ASSISTANT_AUTOMATION_STATE_FILENAME,
    );
    const parsed = JSON.parse(
      await readFile(automationStatePath, "utf8"),
    ) as {
      autoReply?: Array<{ channel?: string }>;
      autoReplyChannels?: string[];
    };
    return {
      autoReplyChannels: Array.isArray(parsed.autoReply)
        ? parsed.autoReply
            .map((entry) => (typeof entry?.channel === "string" ? entry.channel : ""))
            .filter((channel) => channel.length > 0)
        : Array.isArray(parsed.autoReplyChannels)
          ? parsed.autoReplyChannels
          : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        autoReplyChannels: [],
      };
    }

    throw error;
  }
}

async function runHostedExecutionJob(
  input: NodeRunnerTestInput,
  options?: {
    signal?: AbortSignal;
  },
): Promise<{
  finalGatewayProjectionSnapshot: HostedAssistantRuntimeJobResult["finalGatewayProjectionSnapshot"];
  bundles: {
    agentState: HostedExecutionBundlePayload;
    vault: HostedExecutionBundlePayload;
  };
  gatewayProjectionSnapshot: HostedAssistantRuntimeJobResult["finalGatewayProjectionSnapshot"];
  result: HostedAssistantRuntimeJobResult["result"]["result"];
  runnerResult: HostedAssistantRuntimeJobResult["result"];
}> {
  const {
    bundles,
    commitTimeoutMs,
    commit,
    forwardedEnv,
    internalWorkerProxyToken,
    userEnv,
    sharePack,
    wake,
    ...request
  } = input;
  const runtime: HostedAssistantRuntimeConfig = {
    ...(commitTimeoutMs === undefined ? {} : { commitTimeoutMs }),
    ...(forwardedEnv === undefined ? {} : { forwardedEnv }),
    ...(userEnv === undefined ? {} : { userEnv }),
  };
  const runDrain = request.runDrain ?? (
    wake.kind === "runtime.timer"
      ? {
          acquiredAt: "2026-03-26T12:00:00.000Z",
          events: [],
          inputCommittedSeq: "0",
          inputCursorVersion: "0",
          runId: request.run?.runId ?? "run_test",
          triggerKind: wake.triggerKind,
          userId: wake.userId,
        }
      : {
          acquiredAt: "2026-03-26T12:00:00.000Z",
          events: [
            {
              ...(sharePack === undefined ? {} : { sharePack }),
              seq: "0",
              wake,
              ingressEventId: `wake_${wake.eventId}`,
            },
          ],
          inputCommittedSeq: "0",
          inputCursorVersion: "0",
          runId: request.run?.runId ?? "run_test",
          triggerKind: "external_ingress" as const,
          userId: wake.userId,
        }
  );
  const run = request.run ?? {
    attempt: 1,
    runId: runDrain.runId,
    startedAt: "2026-03-26T12:00:00.000Z",
  };
  const normalizedRequest: HostedAssistantRuntimeJobInput["request"] = {
    ...request,
    bundle:
      bundles === null || typeof bundles === "string"
        ? bundles
        : (bundles.vault ?? bundles.agentState),
    run,
    runDrain,
    ...(commit === undefined ? {} : {
      currentBundleRef: commit.bundleRef ?? commit.bundleRefs?.vault ?? null,
    }),
  };
  const effectiveInternalWorkerProxyToken =
    internalWorkerProxyToken === undefined
      ? TEST_INTERNAL_WORKER_PROXY_TOKEN
      : internalWorkerProxyToken

  let result = await runHostedExecutionJobInternal({
    request: normalizedRequest,
    ...(Object.keys(runtime).length === 0 ? {} : { runtime }),
  }, {
    internalWorkerProxyToken: effectiveInternalWorkerProxyToken,
    ...options,
  });

  if (result.phase === "prepared" && normalizedRequest.runDrain?.resumeFinalize !== true) {
    result = await runHostedExecutionJobInternal({
      request: {
        ...normalizedRequest,
        bundle: result.result.bundle,
        runDrain: {
          acquiredAt: "2026-03-26T12:00:00.000Z",
          events: [],
          inputCommittedSeq: "0",
          inputCursorVersion: "0",
          resumeFinalize: true,
          runId: normalizedRequest.run.runId,
          triggerKind: "runtime_timer",
          userId: wake.userId,
        },
      },
      ...(Object.keys(runtime).length === 0 ? {} : { runtime }),
    }, {
      internalWorkerProxyToken: effectiveInternalWorkerProxyToken,
      ...options,
    });
  }

  if (result.phase === "prepared") {
    throw new Error("Expected the node-runner test helper to resolve a completed hosted result.");
  }

  return {
    finalGatewayProjectionSnapshot: result.finalGatewayProjectionSnapshot,
    bundles: {
      agentState: result.result.bundle,
      vault: result.result.bundle,
    },
    gatewayProjectionSnapshot: result.finalGatewayProjectionSnapshot,
    result: result.result.result,
    runnerResult: result.result,
  };
}

function installHostedFetchBaseUrlProxy(input: {
  artifactsBaseUrl?: string;
  resultsBaseUrl?: string;
}): () => void {
  const previousFetch = global.fetch;
  const delegateFetch = previousFetch ?? fetch;
  const baseUrlByHost = new Map<string, string>();

  if (input.artifactsBaseUrl) {
    baseUrlByHost.set("artifacts.worker", input.artifactsBaseUrl);
  }
  if (input.resultsBaseUrl) {
    baseUrlByHost.set("results.worker", input.resultsBaseUrl);
  }

  global.fetch = async (requestInput, init) => {
    const request = requestInput instanceof Request ? requestInput : new Request(requestInput, init);
    const url = new URL(request.url);
    const overrideBaseUrl = baseUrlByHost.get(url.host);

    if (!overrideBaseUrl) {
      return await delegateFetch(request);
    }

    const proxiedUrl = new URL(`${url.pathname}${url.search}`, overrideBaseUrl);
    return await delegateFetch(new Request(proxiedUrl.toString(), request));
  };

  return () => {
    if (previousFetch) {
      global.fetch = previousFetch;
      return;
    }

    delete (globalThis as { fetch?: typeof fetch }).fetch;
  };
}

describe("runHostedExecutionJob", () => {
  const FINALIZED_RUN_DRAIN_SUMMARY = "Finalized committed hosted run side effects.";
  const cleanupPaths: string[] = [];
  let previousHostedAssistantEnv: Record<string, string | undefined> = {};
  let previousHostedDeviceSyncEnv: Record<string, string | undefined> = {};
  let previousHostedExecutionWorkerEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    vi.restoreAllMocks();
    runHostedExecutionJobInternal = createHostedExecutionJobRunner({
      runMode: "in-process",
    });
    const requiredWorkerEnv = Object.fromEntries(
      Object.entries(createHostedExecutionTestEnv()).filter(([, value]) => typeof value === "string"),
    ) as Record<string, string>;
    previousHostedExecutionWorkerEnv = captureEnvVars(Object.keys(requiredWorkerEnv));
    restoreEnvVars(requiredWorkerEnv);
    previousHostedAssistantEnv = captureEnvVars(HOSTED_ASSISTANT_CONFIG_ENV_NAMES);
    restoreEnvVars(
      Object.fromEntries(
        HOSTED_ASSISTANT_CONFIG_ENV_NAMES.map((key) => [key, undefined]),
      ),
    );
    previousHostedDeviceSyncEnv = captureEnvVarsWithPrefixes(HOSTED_DEVICE_SYNC_ENV_PREFIXES);
    for (const key of Object.keys(previousHostedDeviceSyncEnv)) {
      restoreEnvVar(key, undefined);
    }
    const actualAssistantCore = await vi.importActual<typeof import("@murphai/assistant-engine")>(
      "@murphai/assistant-engine",
    );
    hostedCliMocks.dispatchAssistantOutboxIntent.mockImplementation((input) =>
      actualAssistantCore.dispatchAssistantOutboxIntent(input));
    hostedCliMocks.runAssistantAutomation.mockImplementation((input) =>
      actualAssistantCore.runAssistantAutomation(input));
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const request = normalizeFetchRequest(input, init)
      const url = new URL(request.url)

      if (url.hostname === 'results.worker') {
        if (request.method === 'GET') {
          return new Response(JSON.stringify({
            effectId: url.pathname.split('/').pop() ?? 'effect',
            record: null,
          }), { status: 200 })
        }

        if (request.method === 'PUT') {
          return new Response(JSON.stringify({
            effectId: url.pathname.split('/').pop() ?? 'effect',
            record: await readFetchRequestBody(request),
          }), { status: 200 })
        }
      }

      return initialGlobalFetch
        ? initialGlobalFetch(request)
        : Promise.reject(new Error(`Unexpected fetch URL: ${request.url}`))
    }));
  });

  afterEach(async () => {
    restoreEnvVars(previousHostedAssistantEnv);
    restoreEnvVars(previousHostedDeviceSyncEnv);
    restoreEnvVars(previousHostedExecutionWorkerEnv);
    if (initialGlobalFetch) {
      global.fetch = initialGlobalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { force: true, recursive: true })));
  });

  it("bootstraps a new hosted member context only during activation and records the result explicitly", async () => {
    const previousHostedAssistantEnv = clearHostedAssistantSeedEnv();

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_123", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_123" }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-test-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(automationState.autoReplyChannels).not.toContain("linq");
      expect(automationState.autoReplyChannels).not.toContain("email");
      await expect(
        readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
      ).rejects.toThrow();
      await expect(
        readFile(path.join(restored.operatorHomeRoot, ".murph", "hosted", "user-env.json"), "utf8"),
      ).rejects.toThrow();
      await expect(readFile(path.join(restored.vaultRoot, "vault.json"), "utf8")).resolves.toContain("{");
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("reuses the existing hosted member bootstrap on repeated activation", async () => {
    const previousHostedAssistantEnv = clearHostedAssistantSeedEnv();

    try {
      const firstActivation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_activation_first", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_123" }),
      });

      const secondActivation = await runHostedExecutionJob({
        bundles: firstActivation.bundles,
        wake: createActivationWake({ eventId: "evt_activation_second", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:05:00.000Z", userId: "member_123" }),
      });

      expect(secondActivation.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });


  it("does not bootstrap hosted email auto-reply when ingress is configured but send credentials are missing", async () => {
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("hosted-email");
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_activation_email_partial", memberChannels: MEMBER_CHANNELS_EMAIL, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_email_partial" }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-bootstrap-partial-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(automationState.autoReplyChannels).not.toContain("email");
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("bootstraps managed Linq auto-reply when activation enables the Linq channel", async () => {
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({
          eventId: "evt_activation_linq_bootstrap",
          memberChannels: MEMBER_CHANNELS_LINQ,
          occurredAt: "2026-03-26T12:00:00.000Z",
          userId: "member_linq_bootstrap",
        }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-linq-bootstrap-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(automationState.autoReplyChannels).toContain("linq");
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("preserves managed Linq auto-reply on repeated activation after Linq bootstrap", async () => {
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

    try {
      const firstActivation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({
          eventId: "evt_activation_linq_bootstrap_first",
          memberChannels: MEMBER_CHANNELS_LINQ,
          occurredAt: "2026-03-26T12:00:00.000Z",
          userId: "member_linq_bootstrap",
        }),
      });

      const secondActivation = await runHostedExecutionJob({
        bundles: firstActivation.bundles,
        wake: createActivationWake({ eventId: "evt_activation_linq_bootstrap_second", memberChannels: MEMBER_CHANNELS_LINQ, occurredAt: "2026-03-26T12:05:00.000Z", userId: "member_linq_bootstrap" }),
      });

      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-linq-bootstrap-replay-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(secondActivation.bundles.agentState),
        vaultBundle: Buffer.from(secondActivation.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(secondActivation.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(automationState.autoReplyChannels).toContain("linq");
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("syncs hosted managed auto-reply channels from explicit member channel update events", async () => {
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

    try {
      const activation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_activation_channel_sync", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_channel_sync" }),
      });

      const enabled = await runHostedExecutionJob({
        bundles: activation.bundles,
        wake: createChannelsUpdatedWake({ eventId: "evt_member_channels_enabled", memberChannels: MEMBER_CHANNELS_LINQ, occurredAt: "2026-03-26T12:05:00.000Z", userId: "member_channel_sync" }),
      });
      const enabledWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-channel-sync-enabled-"));
      cleanupPaths.push(enabledWorkspaceRoot);
      const enabledContext = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(enabled.bundles.agentState),
        vaultBundle: Buffer.from(enabled.bundles.vault!, "base64"),
        workspaceRoot: enabledWorkspaceRoot,
      });
      const enabledAutomationState = await readAssistantAutomationState(
        enabledContext.assistantStateRoot,
      );

      expect(enabled.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(enabledAutomationState.autoReplyChannels).toContain("linq");

      const disabled = await runHostedExecutionJob({
        bundles: enabled.bundles,
        wake: createChannelsUpdatedWake({ eventId: "evt_member_channels_disabled", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:10:00.000Z", userId: "member_channel_sync" }),
      });
      const disabledWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-channel-sync-disabled-"));
      cleanupPaths.push(disabledWorkspaceRoot);
      const disabledContext = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(disabled.bundles.agentState),
        vaultBundle: Buffer.from(disabled.bundles.vault!, "base64"),
        workspaceRoot: disabledWorkspaceRoot,
      });
      const disabledAutomationState = await readAssistantAutomationState(
        disabledContext.assistantStateRoot,
      );

      expect(disabled.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(disabledAutomationState.autoReplyChannels).not.toContain("linq");
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("persists hosted Telegram captures from webhook-style dispatches", async () => {
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("telegram");
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation_telegram_ingress", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_telegram_ingress" }),
    });

    const result = await runHostedExecutionJob({
      bundles: activation.bundles,
      wake: createTelegramWake({ eventId: "evt_telegram_ingress", occurredAt: "2026-03-26T12:05:00.000Z", telegramMessage: { messageId: "1", schema: "murph.hosted-telegram-message.v1", text: "hello from Telegram", threadId: "123" }, userId: "member_telegram_ingress" }),
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-telegram-ingress-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const runtime = await openInboxRuntime({
      vaultRoot: restored.vaultRoot,
    });

    try {
      await rebuildRuntimeFromVault({
        runtime,
        vaultRoot: restored.vaultRoot,
      });
      const capture = runtime.listCaptures({ limit: 1 })[0];

      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(capture?.actor.id).toBeNull();
      expect(capture?.actor.displayName).toBeNull();
      expect(capture?.text).toBe("hello from Telegram");
      expect(capture?.thread.title).toBeNull();
      expect(capture?.thread.isDirect).toBe(true);
      expect(capture?.thread.id).toBe("123");
      expect(capture?.externalId).toBe("evt_telegram_ingress");
      expect(capture?.raw).toEqual({
        message_id: "1",
        schema: "murph.telegram-capture.v1",
      });
    } finally {
      runtime.close();
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
    }
  });

  it("bootstraps hosted email auto-reply when the hosted email bridge is configured", async () => {
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailIngressReady = process.env.HOSTED_EMAIL_INGRESS_READY;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSendReady = process.env.HOSTED_EMAIL_SEND_READY;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("hosted-email");
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

    process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
    process.env.HOSTED_EMAIL_INGRESS_READY = "true";
    process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";
    process.env.HOSTED_EMAIL_SEND_READY = "true";
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_activation_email", memberChannels: MEMBER_CHANNELS_EMAIL, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_email" }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-bootstrap-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_INGRESS_READY", previousHostedEmailIngressReady);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SEND_READY", previousHostedEmailSendReady);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("does not bootstrap hosted email auto-reply when sender credentials exist without a hosted email domain", async () => {
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailFromAddress = process.env.HOSTED_EMAIL_FROM_ADDRESS;
    const previousHostedEmailSendReady = process.env.HOSTED_EMAIL_SEND_READY;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("hosted-email");
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();

    process.env.HOSTED_EMAIL_FROM_ADDRESS = "assistant@mail.example.test";
    process.env.HOSTED_EMAIL_SEND_READY = "true";
    delete process.env.HOSTED_EMAIL_DOMAIN;
    process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_activation_email_no_domain", memberChannels: MEMBER_CHANNELS_EMAIL, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_email_no_domain" }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-bootstrap-no-domain-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(automationState.autoReplyChannels).not.toContain("email");
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_FROM_ADDRESS", previousHostedEmailFromAddress);
      restoreEnvVar("HOSTED_EMAIL_SEND_READY", previousHostedEmailSendReady);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("does not enable hosted auto-reply on non-activation events after bootstrap", async () => {
    const previousHostedEmailDomain = process.env.HOSTED_EMAIL_DOMAIN;
    const previousHostedEmailIngressReady = process.env.HOSTED_EMAIL_INGRESS_READY;
    const previousHostedEmailLocalPart = process.env.HOSTED_EMAIL_LOCAL_PART;
    const previousHostedEmailSendReady = process.env.HOSTED_EMAIL_SEND_READY;
    const previousHostedEmailSigningSecret = process.env.HOSTED_EMAIL_SIGNING_SECRET;
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("hosted-email");
    const previousHostedAssistantEnv = clearHostedAssistantSeedEnv();

    delete process.env.HOSTED_EMAIL_DOMAIN;
    delete process.env.HOSTED_EMAIL_INGRESS_READY;
    delete process.env.HOSTED_EMAIL_LOCAL_PART;
    delete process.env.HOSTED_EMAIL_SEND_READY;
    delete process.env.HOSTED_EMAIL_SIGNING_SECRET;

    try {
      const activation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_activation_email_late_env", memberChannels: MEMBER_CHANNELS_EMAIL, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_email_late_env" }),
      });

      process.env.HOSTED_EMAIL_DOMAIN = "mail.example.test";
      process.env.HOSTED_EMAIL_INGRESS_READY = "true";
      process.env.HOSTED_EMAIL_LOCAL_PART = "assistant";
      process.env.HOSTED_EMAIL_SEND_READY = "true";
      process.env.HOSTED_EMAIL_SIGNING_SECRET = "email-secret";

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        wake: createCronWake({ eventId: "evt_tick_email_late_env", occurredAt: "2026-03-26T12:05:00.000Z", reason: "manual", userId: "member_email_late_env" }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-late-env-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const automationState = await readAssistantAutomationState(restored.assistantStateRoot);

      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(automationState.autoReplyChannels).not.toContain("email");
      await expect(
        readFile(path.join(restored.operatorHomeRoot, ".murph", "config.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
      restoreEnvVars(previousHostedAssistantEnv);
      restoreEnvVar("HOSTED_EMAIL_DOMAIN", previousHostedEmailDomain);
      restoreEnvVar("HOSTED_EMAIL_INGRESS_READY", previousHostedEmailIngressReady);
      restoreEnvVar("HOSTED_EMAIL_LOCAL_PART", previousHostedEmailLocalPart);
      restoreEnvVar("HOSTED_EMAIL_SEND_READY", previousHostedEmailSendReady);
      restoreEnvVar("HOSTED_EMAIL_SIGNING_SECRET", previousHostedEmailSigningSecret);
    }
  });

  it("fetches raw hosted email through the email worker bridge when processing inbound email events", async () => {
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("hosted-email");
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation_email_fetch", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_email_fetch" }),
    });

    const raw = [
      'From: Alice Example <alice@example.test>',
      'To: assistant@mail.example.test',
      'Subject: Hosted inbox hello',
      'Message-ID: <msg_email_fetch@example.test>',
      'Date: Thu, 26 Mar 2026 12:00:00 +0000',
      '',
      'Hello from a hosted inbound email.',
      '',
    ].join('\r\n');
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method ?? "GET"} ${request.url ?? ""}`);

      if (request.url === "/messages/raw_email_123") {
        response.statusCode = 200;
        response.setHeader("content-type", "message/rfc822");
        response.end(raw);
        return;
      }

      response.statusCode = 404;
      response.end("Not found");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted email test server to expose a TCP port.");
      }
      const restoreFetch = installHostedFetchBaseUrlProxy({
        resultsBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        wake: createEmailWake({ eventId: "evt_email_fetch", identityId: "assistant@mail.example.test", occurredAt: "2026-03-26T12:05:00.000Z", rawMessageKey: "raw_email_123", userId: "member_email_fetch" }),
      });

      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(requests).toEqual(["GET /messages/raw_email_123"]);
      restoreFetch();
    } finally {
      server.close();
      await once(server, "close");
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
    }
  });

  it("persists hosted stable-alias email captures with Reply-To-based thread targets", async () => {
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("hosted-email");
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation_email_alias", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_email_alias" }),
    });

    const raw = [
      'From: Alice Example <alice@example.test>',
      'Reply-To: Alice Replies <reply@example.test>, Team Replies <team@example.test>',
      'To: assistant+u-member_email_alias@mail.example.test',
      'Cc: assistant@mail.example.test',
      'Subject: Hosted alias hello',
      'Message-ID: <msg_email_alias@example.test>',
      'Date: Thu, 26 Mar 2026 12:00:00 +0000',
      '',
      'Hello from the hosted stable alias path.',
      '',
    ].join('\r\n');
    const server = createServer((request, response) => {
      if (request.url === "/messages/raw_email_alias") {
        response.statusCode = 200;
        response.setHeader("content-type", "message/rfc822");
        response.end(raw);
        return;
      }

      response.statusCode = 404;
      response.end("Not found");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted email test server to expose a TCP port.");
      }
      const restoreFetch = installHostedFetchBaseUrlProxy({
        resultsBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        wake: createEmailWake({ eventId: "evt_email_alias", identityId: "assistant@mail.example.test", occurredAt: "2026-03-26T12:05:00.000Z", rawMessageKey: "raw_email_alias", userId: "member_email_alias" }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-email-alias-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const runtime = await openInboxRuntime({
        vaultRoot: restored.vaultRoot,
      });

      try {
        await rebuildRuntimeFromVault({
          runtime,
          vaultRoot: restored.vaultRoot,
        });
        const capture = runtime.listCaptures({ limit: 1 })[0];

        expect(capture?.actor.id).toBe("alice@example.test");
        expect(capture?.thread.id).toBeTruthy();
        expect(capture?.thread.isDirect).toBe(false);
        restoreFetch();
      } finally {
        runtime.close();
      }
    } finally {
      server.close();
      await once(server, "close");
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
    }
  });

  it("persists hosted Telegram captures through the hosted runtime event seam", async () => {
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("telegram");
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation_telegram", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_telegram" }),
    });

    const result = await runHostedExecutionJob({
      bundles: activation.bundles,
      wake: createTelegramWake({ eventId: "evt_telegram", occurredAt: "2026-03-26T12:05:00.000Z", telegramMessage: { messageId: "789", schema: "murph.hosted-telegram-message.v1", text: "Hello from hosted Telegram.", threadId: "456" }, userId: "member_telegram" }),
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-telegram-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const runtime = await openInboxRuntime({
      vaultRoot: restored.vaultRoot,
    });

    try {
      await rebuildRuntimeFromVault({
        runtime,
        vaultRoot: restored.vaultRoot,
      });
      const capture = runtime.listCaptures({ limit: 1 })[0];

      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
      expect(capture?.source).toBe("telegram");
      expect(capture?.externalId).toBe("evt_telegram");
      expect(capture?.text).toBe("Hello from hosted Telegram.");
      expect(capture?.actor.id).toBeNull();
      expect(capture?.thread.title).toBeNull();
      expect(capture?.raw).toEqual({
        message_id: "789",
        schema: "murph.telegram-capture.v1",
      });
    } finally {
      runtime.close();
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
    }
  });

  it("hydrates hosted Telegram attachment bytes when runner Telegram env is present", async () => {
    const previousTelegramApiBaseUrl = process.env.TELEGRAM_API_BASE_URL;
    const previousTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const previousTelegramFileBaseUrl = process.env.TELEGRAM_FILE_BASE_URL;
    const previousRunnerEnvProfiles = setHostedRunnerEnvProfiles("telegram");
    process.env.TELEGRAM_API_BASE_URL = "https://telegram-api.example.test";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-token";
    process.env.TELEGRAM_FILE_BASE_URL = "https://telegram-files.example.test";

    const attachmentBytes = Uint8Array.from([1, 2, 3, 4]);
    const artifactBytesByUrl = new Map<string, Uint8Array>();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = normalizeFetchRequest(input, init);
      const url = request.url;
      if (url.startsWith("http://artifacts.worker/objects/")) {
        if (request.method === "PUT") {
          const bodyBytes = new Uint8Array(await request.arrayBuffer());
          artifactBytesByUrl.set(url, bodyBytes);
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          });
        }

        if (request.method === "GET") {
          const storedBytes = artifactBytesByUrl.get(url);
          if (!storedBytes) {
            return new Response("Not found", { status: 404 });
          }

          return new Response(Buffer.from(storedBytes), {
            headers: {
              "content-type": "application/octet-stream",
            },
            status: 200,
          });
        }
      }

      if (url === "https://telegram-api.example.test/bottelegram-token/getFile?file_id=file_123") {
        expect(request.method).toBe("GET");
        return new Response(JSON.stringify({
          ok: true,
          result: {
            file_id: "file_123",
            file_path: "photos/file_123.jpg",
            file_size: attachmentBytes.byteLength,
            file_unique_id: "photo_unique_123",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (url === "https://telegram-api.example.test/bottelegram-token/sendChatAction") {
        expect(request.method).toBe("POST");
        await expect(request.json()).resolves.toEqual({
          action: "typing",
          chat_id: "456",
        });
        return new Response(JSON.stringify({
          ok: true,
          result: true,
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }

      if (url === "https://telegram-files.example.test/bottelegram-token/photos/file_123.jpg") {
        expect(request.method).toBe("GET");
        return new Response(attachmentBytes, {
          headers: {
            "content-type": "image/jpeg",
          },
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const activation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_activation_telegram_attachment", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-29T09:00:00.000Z", userId: "member_telegram_attachment" }),
      });

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        wake: createTelegramWake({
          eventId: "evt_telegram_attachment",
          occurredAt: "2026-03-29T09:05:00.000Z",
          telegramMessage: {
            attachments: [
              {
                fileId: "file_123",
                fileSize: attachmentBytes.byteLength,
                fileUniqueId: "photo_unique_123",
                height: 20,
                kind: "photo",
                width: 20,
              },
            ],
            messageId: "790",
            schema: "murph.hosted-telegram-message.v1",
            text: "Photo from hosted Telegram.",
            threadId: "456",
          },
          userId: "member_telegram_attachment",
        }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-telegram-attachment-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        artifactResolver: async ({ ref }) => {
          const bytes = artifactBytesByUrl.get(`http://artifacts.worker/objects/${ref.sha256}`);
          if (!bytes) {
            throw new Error(`Missing artifact ${ref.sha256}.`);
          }

          return bytes;
        },
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const runtime = await openInboxRuntime({
        vaultRoot: restored.vaultRoot,
      });

      try {
        await rebuildRuntimeFromVault({
          runtime,
          vaultRoot: restored.vaultRoot,
        });
        const captureSummary = runtime.listCaptures({ limit: 1 })[0];
        expect(captureSummary).toBeDefined();
        const capture = runtime.getCapture(captureSummary!.captureId);
        const attachment = capture?.attachments[0];

        expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
        expect(capture?.text).toBe("Photo from hosted Telegram.");
        expect(attachment?.byteSize).toBe(attachmentBytes.byteLength);
        expect(attachment?.fileName).toBe("photo-photo_unique_123.jpg");
        expect(attachment?.storedPath).toBeTruthy();
        await expect(readFile(path.join(restored.vaultRoot, attachment!.storedPath!))).resolves.toEqual(
          Buffer.from(attachmentBytes),
        );
      } finally {
        runtime.close();
      }

      const telegramFetchCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).startsWith("https://telegram-"),
      );
      const telegramFetchUrls = telegramFetchCalls.map(([url]) => String(url));
      const telegramGetFileUrl =
        "https://telegram-api.example.test/bottelegram-token/getFile?file_id=file_123";
      const telegramFileDownloadUrl =
        "https://telegram-files.example.test/bottelegram-token/photos/file_123.jpg";
      expect(telegramFetchUrls.filter((url) => url === telegramGetFileUrl)).toHaveLength(1);
      expect(telegramFetchUrls.filter((url) => url === telegramFileDownloadUrl)).toHaveLength(1);
      expect(telegramFetchUrls.indexOf(telegramGetFileUrl)).toBeLessThan(
        telegramFetchUrls.indexOf(telegramFileDownloadUrl),
      );
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
      restoreEnvVar("TELEGRAM_API_BASE_URL", previousTelegramApiBaseUrl);
      restoreEnvVar("TELEGRAM_BOT_TOKEN", previousTelegramBotToken);
      restoreEnvVar("TELEGRAM_FILE_BASE_URL", previousTelegramFileBaseUrl);
      vi.unstubAllGlobals();
    }
  });

  it("rejects non-activation hosted events until member activation bootstrap has run", async () => {
    await expect(runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createChannelsUpdatedWake({
        eventId: "evt_channels_without_bootstrap",
        memberChannels: MEMBER_CHANNELS_NONE,
        occurredAt: "2026-03-26T12:00:00.000Z",
        userId: "member_123",
      }),
    })).rejects.toThrow(
      "Hosted execution for member.channels.updated requires member.activated bootstrap first.",
    );
  });

  it("runs follow-up hosted events without re-running durable bootstrap", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_123" }),
    });

    const followUp = await runHostedExecutionJob({
      bundles: activation.bundles,
      wake: createCronWake({ eventId: "evt_tick", occurredAt: "2026-03-26T12:05:00.000Z", reason: "manual", userId: "member_123" }),
    });

    expect(followUp.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
  });

  it("restores externalized raw artifacts and skips re-uploading unchanged hashes", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation_artifacts", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_artifacts" }),
    });
    const activationWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-activation-"));
    cleanupPaths.push(activationWorkspaceRoot);
    const restoredActivation = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(activation.bundles.agentState),
      vaultBundle: Buffer.from(activation.bundles.vault!, "base64"),
      workspaceRoot: activationWorkspaceRoot,
    });
    const rawAttachmentPath = path.join(
      restoredActivation.vaultRoot,
      "raw",
      "inbox",
      "2026-03-28",
      "capture_123",
      "attachments",
      "report.pdf",
    );
    await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
    await writeFile(rawAttachmentPath, Buffer.from("pdf-binary-artifact\n", "utf8"));

    const artifacts = new Map<string, Uint8Array>();
    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot: restoredActivation.operatorHomeRoot,
      vaultRoot: restoredActivation.vaultRoot,
    });
    const [artifactHash] = [...artifacts.keys()];
    expect(artifactHash).toBeDefined();

    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      requests.push(`${request.method ?? "GET"} ${request.url ?? ""}`);

      if (request.method === "GET" && request.url === `/objects/${artifactHash}`) {
        response.statusCode = 200;
        response.setHeader("content-type", "application/octet-stream");
        response.end(Buffer.from(artifacts.get(artifactHash!) ?? []));
        return;
      }

      if (request.method === "PUT" && request.url === `/objects/${artifactHash}`) {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      response.statusCode = 404;
      response.end("Not found");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted artifact test server to expose a TCP port.");
      }
      const restoreFetch = installHostedFetchBaseUrlProxy({
        artifactsBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      const result = await runHostedExecutionJob({
        bundles: {
          agentState: encodeHostedBundleBase64(snapshot.agentStateBundle),
          vault: encodeHostedBundleBase64(snapshot.vaultBundle),
        },
        wake: createCronWake({ eventId: "evt_artifact_tick", occurredAt: "2026-03-26T12:05:00.000Z", reason: "manual", userId: "member_artifacts" }),
      });

      expect(requests).toEqual([]);

      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-restored-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        artifactResolver: async ({ ref }) => {
          const bytes = artifacts.get(ref.sha256);
          if (!bytes) {
            throw new Error(`Missing artifact ${ref.sha256}.`);
          }

          return bytes;
        },
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });

      await expect(readFile(path.join(
        restored.vaultRoot,
        "raw",
        "inbox",
        "2026-03-28",
        "capture_123",
        "attachments",
        "report.pdf",
      ))).resolves.toEqual(Buffer.from("pdf-binary-artifact\n", "utf8"));
      restoreFetch();
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("completes the hosted assistant cron tick when an externalized artifact cannot be fetched", async () => {
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation_artifacts_missing", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_artifacts_missing" }),
    });
    const activationWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-missing-"));
    cleanupPaths.push(activationWorkspaceRoot);
    const restoredActivation = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(activation.bundles.agentState),
      vaultBundle: Buffer.from(activation.bundles.vault!, "base64"),
      workspaceRoot: activationWorkspaceRoot,
    });
    const sourceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-missing-source-"));
    cleanupPaths.push(sourceRoot);
    const attachmentPath = path.join(sourceRoot, "missing-document.pdf");
    await writeFile(attachmentPath, Buffer.from("%PDF-1.4\nmissing artifact\n", "utf8"));

    const runtime = await openInboxRuntime({
      vaultRoot: restoredActivation.vaultRoot,
    });

    try {
      const pipeline = await createInboxPipeline({
        runtime,
        vaultRoot: restoredActivation.vaultRoot,
      });
      await pipeline.processCapture({
        accountId: "self",
        actor: {
          displayName: "Friend",
          id: "contact-404",
          isSelf: false,
        },
        attachments: [
          {
            externalId: "att-404",
            fileName: "missing-document.pdf",
            kind: "document",
            mime: "application/pdf",
            originalPath: attachmentPath,
          },
        ],
        externalId: "msg-404",
        occurredAt: "2026-03-28T12:00:00.000Z",
        raw: {},
        receivedAt: "2026-03-28T12:00:05.000Z",
        source: "telegram",
        text: "document inbound",
        thread: {
          id: "chat-404",
          isDirect: true,
          title: "Missing artifact",
        },
      });

      expect(runtime.listAttachmentParseJobs({ state: "pending" })).toHaveLength(1);
    } finally {
      runtime.close();
    }

    const artifacts = new Map<string, Uint8Array>();
    const snapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifacts.set(artifact.ref.sha256, artifact.bytes);
      },
      operatorHomeRoot: restoredActivation.operatorHomeRoot,
      vaultRoot: restoredActivation.vaultRoot,
    });
    const [artifactHash] = [...artifacts.keys()];
    expect(artifactHash).toBeDefined();

    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url === `/objects/${artifactHash}`) {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      response.statusCode = 500;
      response.end("Unexpected request");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected the hosted artifact test server to expose a TCP port.");
      }
      const restoreFetch = installHostedFetchBaseUrlProxy({
        artifactsBaseUrl: `http://127.0.0.1:${address.port}`,
      });

      const result = await runHostedExecutionJob({
        bundles: {
          agentState: encodeHostedBundleBase64(snapshot.agentStateBundle),
          vault: encodeHostedBundleBase64(snapshot.vaultBundle),
        },
        wake: createCronWake({ eventId: "evt_artifact_missing_tick", occurredAt: "2026-03-26T12:05:00.000Z", reason: "manual", userId: "member_artifacts_missing" }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-artifacts-missing-final-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        shouldRestoreArtifact: () => false,
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const finalRuntime = await openInboxRuntime({
        vaultRoot: restored.vaultRoot,
      });

      try {
        expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
        expect(finalRuntime.listAttachmentParseJobs({ state: "pending" })).toHaveLength(0);
      } finally {
        finalRuntime.close();
      }
      restoreFetch();
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("imports a hosted share from the inline dispatch pack", async () => {
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-source-"));
    cleanupPaths.push(sourceVaultRoot);
    await initializeVault({ vaultRoot: sourceVaultRoot });

    const creatine = await upsertProtocolItem({
      vaultRoot: sourceVaultRoot,
      title: "Creatine monohydrate",
      kind: "supplement",
      group: "supplement",
      startedOn: "2026-03-01",
    });
    const smoothie = await upsertFood({
      vaultRoot: sourceVaultRoot,
      title: "Morning Smoothie",
      kind: "smoothie",
      attachedProtocolIds: [creatine.record.entity.protocolId],
      autoLogDaily: {
        time: "08:00",
      },
    });
    const pack = await buildSharePackFromVault({
      vaultRoot: sourceVaultRoot,
      foods: [{ id: smoothie.record.foodId }],
      includeAttachedProtocols: true,
      logMeal: {
        food: { id: smoothie.record.foodId },
      },
    });
    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation_share", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:25:00.000Z", userId: "member_456" }),
    });

    const result = await runHostedExecutionJob({
      bundles: activation.bundles,
      wake: createShareAcceptedWake({ eventId: "evt_share_123", occurredAt: "2026-03-26T12:30:00.000Z", ownerUserId: "member_sender", shareId: "share_123", userId: "member_456" }),
      sharePack: {
        ownerUserId: "member_sender",
        pack,
        shareId: "share_123",
      },
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-share-direct-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const importedFood = (await listFoods(restored.vaultRoot)).find((entry) => entry.title === "Morning Smoothie");

    expect(importedFood).toBeDefined();
    expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
  });

  it("ignores hosted web env when importing a runner-hydrated share pack", async () => {
    const previousHostedWebBaseUrl = process.env.HOSTED_WEB_BASE_URL;
    process.env.HOSTED_WEB_BASE_URL = "https://join.example.test";

    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-share-proxy-source-"));
    cleanupPaths.push(sourceVaultRoot);
    await initializeVault({ vaultRoot: sourceVaultRoot });

    const supplement = await upsertProtocolItem({
      vaultRoot: sourceVaultRoot,
      title: "Magnesium glycinate",
      kind: "supplement",
      group: "supplement",
      startedOn: "2026-03-01",
    });
    const food = await upsertFood({
      vaultRoot: sourceVaultRoot,
      title: "Proxy Smoothie",
      kind: "smoothie",
      attachedProtocolIds: [supplement.record.entity.protocolId],
      autoLogDaily: {
        time: "08:00",
      },
    });
    const pack = await buildSharePackFromVault({
      vaultRoot: sourceVaultRoot,
      foods: [{ id: food.record.foodId }],
      includeAttachedProtocols: true,
      logMeal: {
        food: { id: food.record.foodId },
      },
    });
    const fetchSpy = vi.fn(async () => {
      throw new Error("Inline share imports should not fetch through the removed share proxy route.");
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const activation = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_activation_share_proxy", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:25:00.000Z", userId: "member_proxy" }),
      });

      const result = await runHostedExecutionJob({
        bundles: activation.bundles,
        wake: createShareAcceptedWake({ eventId: "evt_share_proxy_123", occurredAt: "2026-03-26T12:30:00.000Z", ownerUserId: "member_sender", shareId: "share_proxy_123", userId: "member_proxy" }),
        sharePack: {
          ownerUserId: "member_sender",
          pack,
          shareId: "share_proxy_123",
        },
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-share-proxy-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      const importedFood = (await listFoods(restored.vaultRoot)).find((entry) => entry.title === "Proxy Smoothie");

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(importedFood).toBeDefined();
      expect(importedFood?.attachedProtocolIds?.length).toBe(1);
      expect(result.result.summary).toBe(FINALIZED_RUN_DRAIN_SUMMARY);
    } finally {
      restoreEnvVar("HOSTED_WEB_BASE_URL", previousHostedWebBaseUrl);
      vi.stubGlobal("fetch", initialGlobalFetch);
    }
  });

  it("strips process-control keys from caller-supplied forwarded env before isolated runs", async () => {
    const runIsolated = vi.fn(async (): Promise<HostedAssistantRuntimeJobResult> => ({
      finalGatewayProjectionSnapshot: null,
      result: {
        bundle: null,
        result: {
          eventsHandled: 0,
          summary: "ok",
        },
      },
    }));
    runHostedExecutionJobInternal = createHostedExecutionJobRunner({
      runIsolated,
      runMode: "isolated",
    });

    await expect(
      runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_isolated_env", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-29T10:00:00.000Z", userId: "member_isolated_env" }),
        forwardedEnv: {
          NODE_OPTIONS: "--definitely-invalid-node-option",
          OPENAI_API_KEY: "job-openai-key",
        },
      }),
    ).resolves.toMatchObject({
      result: {
        summary: "ok",
      },
    });

    expect(runIsolated).toHaveBeenCalledWith(expect.objectContaining({
      job: expect.objectContaining({
        runtime: expect.objectContaining({
          forwardedEnv: {
            OPENAI_API_KEY: "job-openai-key",
          },
        }),
      }),
    }), expect.any(Object));
  });

  it("does not read direct hosted env when a worker proxy token is present", async () => {
    const readEnvironment = vi.fn(() => {
      throw new Error("Expected worker-proxy mode to avoid direct hosted env reads.");
    });
    const runIsolated = vi.fn(async (): Promise<HostedAssistantRuntimeJobResult> => ({
      finalGatewayProjectionSnapshot: null,
      result: {
        bundle: null,
        result: {
          eventsHandled: 0,
          summary: "ok",
        },
      },
    }));
    const runHostedExecutionJob = createHostedExecutionJobRunner({
      readEnvironment,
      runIsolated,
      runMode: "isolated",
    });

    await expect(runHostedExecutionJob({
      request: {
        bundle: null,
        run: {
          attempt: 1,
          runId: "run_proxy_transport_only",
          startedAt: "2026-03-29T10:05:00.000Z",
        },
        runDrain: {
          acquiredAt: "2026-03-29T10:05:00.000Z",
          events: [],
          inputCommittedSeq: "0",
          inputCursorVersion: "0",
          runId: "run_proxy_transport_only",
          triggerKind: "runtime_timer",
          userId: "member_proxy_transport_only",
        },
      },
    }, {
      internalWorkerProxyToken: "proxy-token",
    })).resolves.toMatchObject({
      result: {
        result: {
          summary: "ok",
        },
      },
    });

    expect(readEnvironment).not.toHaveBeenCalled();
    expect(runIsolated).toHaveBeenCalledWith(expect.objectContaining({
      internalWorkerProxyToken: "proxy-token",
    }), expect.any(Object));
  });

  it("preserves encrypted runner-secret overrides across one-shot runs", async () => {
    const result = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_user_env", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_123" }),
      userEnv: {
        OPENAI_API_KEY: "sk-user",
        XAI_API_KEY: "xai-user",
      },
    });
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-test-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });

    await expect(
      readFile(path.join(restored.operatorHomeRoot, ".murph", "hosted", "user-env.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("exports pending hosted AI usage through the worker proxy without exposing the internal web token", async () => {
    const previousHostedWebBaseUrl = process.env.HOSTED_WEB_BASE_URL;
    process.env.HOSTED_WEB_BASE_URL = "https://usage.worker";

    const activation = await runHostedExecutionJob({
      bundles: {
        agentState: null,
        vault: null,
      },
      wake: createActivationWake({ eventId: "evt_activation_usage_proxy", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-29T10:00:00.000Z", userId: "member_usage_proxy" }),
    });
    const activationWorkspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-usage-proxy-seed-"));
    cleanupPaths.push(activationWorkspaceRoot);
    const restoredActivation = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(activation.bundles.agentState),
      vaultBundle: Buffer.from(activation.bundles.vault!, "base64"),
      workspaceRoot: activationWorkspaceRoot,
    });
    await writePendingAssistantUsageRecord({
      record: {
        apiKeyEnv: null,
        attemptCount: 1,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: "platform",
        featureKey: null,
        gatewayTags: [],
        inputTokens: 10,
        memberId: "member_usage_proxy",
        occurredAt: "2026-03-29T10:05:00.000Z",
        outputTokens: 4,
        provider: "codex-cli",
        providerName: null,
        reasoningTokens: null,
        reportingUserId: null,
        requestedModel: "gpt-5.4",
        routeId: "primary",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5.4",
        sessionId: "asst_usage_proxy",
        stripeMeterSource: "murph",
        surface: null,
        totalTokens: 14,
        triggerKind: null,
        turnId: "turn_usage_proxy",
        usageId: "turn_usage_proxy.attempt-1",
      },
      vault: restoredActivation.vaultRoot,
    });
    const snapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot: restoredActivation.operatorHomeRoot,
      vaultRoot: restoredActivation.vaultRoot,
    });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = normalizeFetchRequest(input, init);
      if (request.url !== "http://web-control.worker/api/internal/hosted-execution/usage/record") {
        throw new Error(`Unexpected fetch URL: ${request.url}`);
      }

      expect(request.headers.get("authorization")).toBeNull();

      return new Response(JSON.stringify({
        recorded: 1,
        usageIds: ["turn_usage_proxy.attempt-1"],
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: encodeHostedBundleBase64(snapshot.agentStateBundle),
          vault: encodeHostedBundleBase64(snapshot.vaultBundle),
        },
        wake: createCronWake({ eventId: "evt_usage_proxy_export", occurredAt: "2026-03-29T10:06:00.000Z", reason: "manual", userId: "member_usage_proxy" }),
      });
      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-usage-proxy-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });

      const [usageInput, usageInit] = fetchSpy.mock.calls[0] ?? [];
      const usageRequest = normalizeFetchRequest(
        usageInput as RequestInfo | URL,
        usageInit as RequestInit | undefined,
      );
      expect(usageRequest.url).toBe("http://web-control.worker/api/internal/hosted-execution/usage/record");
      expect(usageRequest.method).toBe("POST");
      expect(usageRequest.headers.get("content-type")).toBe("application/json");
      await expect(usageRequest.text()).resolves.toContain("\"usageId\":\"turn_usage_proxy.attempt-1\"");
      await expect(listPendingAssistantUsageRecords({
        vault: restored.vaultRoot,
      })).resolves.toEqual([]);
    } finally {
      restoreEnvVar("HOSTED_WEB_BASE_URL", previousHostedWebBaseUrl);
    }
  });

  it("restores the prior process env after per-user overrides are applied", async () => {
    const previousAllowedUserEnvKeys = process.env.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS;
    const previousCustomApiKey = process.env.CUSTOM_API_KEY;
    const previousHome = process.env.HOME;
    const previousVault = process.env.VAULT;

    process.env.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS = "CUSTOM_API_KEY";
    process.env.CUSTOM_API_KEY = "custom-original-key";
    process.env.HOME = "/tmp/original-home";
    process.env.VAULT = "/tmp/original-vault";

    try {
      await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        wake: createActivationWake({ eventId: "evt_user_env_restore", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:05:00.000Z", userId: "member_123" }),
        userEnv: {
          CUSTOM_API_KEY: "custom-user-key",
        },
      });
    } finally {
      expect(process.env.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS).toBe("CUSTOM_API_KEY");
      expect(process.env.CUSTOM_API_KEY).toBe("custom-original-key");
      expect(process.env.HOME).toBe("/tmp/original-home");
      expect(process.env.VAULT).toBe("/tmp/original-vault");

      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS", previousAllowedUserEnvKeys);
      restoreEnvVar("CUSTOM_API_KEY", previousCustomApiKey);
      restoreEnvVar("HOME", previousHome);
      restoreEnvVar("VAULT", previousVault);
    }
  });

  it("allows concurrent hosted runs because each job uses isolated process env", async () => {
    const previousAllowedUserEnvKeys = process.env.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS;
    process.env.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS = "CUSTOM_API_KEY";

    const firstPhaseStarted = createDeferred<void>();
    const secondPhaseStarted = createDeferred<void>();
    const releaseFirstPhase = createDeferred<void>();
    const seenApiKeys = new Map<string, string | undefined>();
    let startedInvocationCount = 0;
    let firstPhaseCount = 0;
    let firstPhasesInFlight = 0;
    let maxFirstPhasesInFlight = 0;

    runHostedExecutionJobInternal = createHostedExecutionJobRunner({
      onBeforeRun: () => {
        startedInvocationCount += 1;
      },
      runIsolated: async (input) => {
        const userId = input.job.request.runDrain.userId;
        const runtime = input.job.runtime ?? {};
        seenApiKeys.set(userId, runtime.userEnv?.CUSTOM_API_KEY);
        if (input.job.request.runDrain?.resumeFinalize === true) {
          return {
            finalGatewayProjectionSnapshot: null,
            phase: "completed",
            result: {
              bundle: null,
              result: {
                eventsHandled: 1,
                summary: `ok:${userId}`,
              },
            },
          };
        }

        firstPhaseCount += 1;
        firstPhasesInFlight += 1;
        maxFirstPhasesInFlight = Math.max(maxFirstPhasesInFlight, firstPhasesInFlight);
        if (firstPhaseCount === 1) {
          firstPhaseStarted.resolve();
          await releaseFirstPhase.promise;
        } else if (firstPhaseCount === 2) {
          secondPhaseStarted.resolve();
        }

        return {
          committedAssistantDeliveryEffects: [],
          committedGatewayProjectionSnapshot: null,
          phase: "prepared",
          result: {
            bundle: null,
            result: {
              eventsHandled: 1,
              summary: `ok:${userId}`,
            },
          },
        };
      },
      runMode: "isolated",
    });

    try {
      const firstRun = runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        commit: {
          bundleRefs: { agentState: null, vault: null },
        },
        wake: createActivationWake({ eventId: "evt_one", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_1" }),
        userEnv: {
          CUSTOM_API_KEY: "user-one-key",
        },
      });

      const secondRun = runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        commit: {
          bundleRefs: { agentState: null, vault: null },
        },
        wake: createActivationWake({ eventId: "evt_two", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:01.000Z", userId: "member_2" }),
        userEnv: {
          CUSTOM_API_KEY: "user-two-key",
        },
      });

      await Promise.all([
        firstPhaseStarted.promise,
        secondPhaseStarted.promise,
      ]);

      releaseFirstPhase.resolve();
      await Promise.all([firstRun, secondRun]);

      expect(startedInvocationCount).toBe(4);
      expect(firstPhaseCount).toBe(2);
      expect(maxFirstPhasesInFlight).toBe(2);
      expect(seenApiKeys).toEqual(new Map([
        ["member_1", "user-one-key"],
        ["member_2", "user-two-key"],
      ]));
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS", previousAllowedUserEnvKeys);
    }
  });

  it("reconciles mirror-backed hosted assistant deliveries only after the Durable Object resumes the committed result", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-"));
    const operatorHomeRoot = path.join(parent, "home");
    const vaultRoot = path.join(parent, "vault");
    cleanupPaths.push(parent);
    await mkdir(operatorHomeRoot, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });

    const statePaths = resolveAssistantStatePaths(vaultRoot);
    await mkdir(statePaths.outboxDirectory, { recursive: true });
    const intentId = "outbox_hosted_reconcile";
    const createdAt = "2026-03-26T12:00:00.000Z";
    const sentAt = "2026-03-26T12:00:05.000Z";
    const delivery = {
      channel: "linq",
      idempotencyKey: `assistant-outbox:${intentId}`,
      messageLength: "Queued the Linq reply.".length,
      providerMessageId: null,
      providerThreadId: null,
      sentAt,
      target: "chat_123",
      targetKind: "thread",
    };
    await writeFile(
      path.join(statePaths.outboxDirectory, `${intentId}.json`),
      `${JSON.stringify(assistantOutboxIntentSchema.parse({
        schema: "murph.assistant-outbox-intent.v1",
        intentId,
        sessionId: "sess_hosted",
        turnId: "turn_hosted",
        createdAt,
        updatedAt: createdAt,
        lastAttemptAt: null,
        nextAttemptAt: createdAt,
        sentAt: null,
        attemptCount: 0,
        status: "pending",
        message: "Queued the Linq reply.",
        dedupeKey: "dedupe_hosted",
        targetFingerprint: "target_hosted",
        channel: "linq",
        identityId: null,
        actorId: null,
        threadId: "chat_123",
        threadIsDirect: true,
        bindingDelivery: {
          kind: "thread",
          target: "chat_123",
        },
        explicitTarget: null,
        delivery: null,
        lastError: null,
      }))}\n`,
    );
    const initialSnapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });
    installSentAssistantOutboxDispatchMock({
      delivery,
      intentId,
      sentAt,
    });

    const fetchMock = vi.fn(async (input, init) => {
      const request = normalizeFetchRequest(input, init);
      throw new Error(`Unexpected fetch URL: ${request.url}`);
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await runHostedExecutionJob({
      bundles: {
        agentState: encodeHostedBundleBase64(initialSnapshot.agentStateBundle),
        vault: Buffer.from(initialSnapshot.vaultBundle).toString("base64"),
      },
      commit: {
        bundleRefs: {
          agentState: null,
          vault: null,
        },
      },
      wake: createActivationWake({ eventId: "evt_outbox", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_123" }),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      hostedCliMocks.dispatchAssistantOutboxIntent.mock.calls.some(
        ([input]) => input.intentId === intentId,
      ),
    ).toBe(true);

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-restored-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const savedIntent = JSON.parse(
      await readFile(path.join(resolveAssistantStatePaths(restored.vaultRoot).outboxDirectory, `${intentId}.json`), "utf8"),
    ) as {
      delivery: { target: string } | null;
      status: string;
    };
    expect(savedIntent.status).toBe("sent");
    expect(savedIntent.delivery?.target).toBe("chat_123");
  });

  it("keeps newly queued hosted assistant deliveries on the pending-commit path when the durable commit records no committed delivery effects", async () => {
    const previousHostedAssistantEnv = setHostedAssistantSeedEnv();
    const parent = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-journal-"));
    cleanupPaths.push(parent);
    const intentId = "outbox_hosted_send";
    const createdAt = "2026-03-26T12:00:00.000Z";
    const writePendingIntent = async (vaultRoot: string) => {
      const statePaths = resolveAssistantStatePaths(vaultRoot);
      await mkdir(statePaths.outboxDirectory, { recursive: true });
      await writeFile(
        path.join(statePaths.outboxDirectory, `${intentId}.json`),
        `${JSON.stringify(assistantOutboxIntentSchema.parse({
          schema: "murph.assistant-outbox-intent.v1",
          intentId,
          sessionId: "sess_hosted",
          turnId: "turn_hosted",
          createdAt,
          updatedAt: createdAt,
          lastAttemptAt: null,
          nextAttemptAt: createdAt,
          sentAt: null,
          attemptCount: 0,
          status: "pending",
          message: "Queued the Linq reply.",
          dedupeKey: "dedupe_hosted_send",
          targetFingerprint: "target_hosted_send",
          channel: "linq",
          identityId: null,
          actorId: null,
          threadId: "chat_123",
          threadIsDirect: true,
          bindingDelivery: {
            kind: "thread",
            target: "chat_123",
          },
          explicitTarget: null,
          delivery: null,
          lastError: null,
        }))}\n`,
      );
    };

    hostedCliMocks.runAssistantAutomation.mockImplementationOnce(async ({ vault }) => {
      await writePendingIntent(vault);
    });
    hostedCliMocks.dispatchAssistantOutboxIntent.mockClear();
    const fetchMock = vi.fn(async (input, init) => {
      const request = normalizeFetchRequest(input, init);
      throw new Error(`Unexpected fetch URL: ${request.url}`);
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    try {
      const result = await runHostedExecutionJob({
        bundles: {
          agentState: null,
          vault: null,
        },
        commit: {
          bundleRefs: {
            agentState: null,
            vault: null,
          },
        },
        wake: createActivationWake({ eventId: "evt_outbox_send", memberChannels: MEMBER_CHANNELS_NONE, occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_123" }),
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(hostedCliMocks.dispatchAssistantOutboxIntent).not.toHaveBeenCalled();

      const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-journal-restored-"));
      cleanupPaths.push(workspaceRoot);
      const restored = await restoreHostedExecutionContext({
        agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
        vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
        workspaceRoot,
      });
      await expect(
        readFile(
          path.join(resolveAssistantStatePaths(restored.vaultRoot).outboxDirectory, `${intentId}.json`),
          "utf8",
        ),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      restoreEnvVars(previousHostedAssistantEnv);
    }
  });

  it("replays committed assistant deliveries from the outbox mirror on resume without rerunning compute or recommitting", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-resume-"));
    const operatorHomeRoot = path.join(parent, "home");
    const vaultRoot = path.join(parent, "vault");
    cleanupPaths.push(parent);
    await mkdir(operatorHomeRoot, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });

    const statePaths = resolveAssistantStatePaths(vaultRoot);
    await mkdir(statePaths.outboxDirectory, { recursive: true });
    const intentId = "outbox_hosted_resume";
    const createdAt = "2026-03-26T12:00:00.000Z";
    const sentAt = "2026-03-26T12:00:05.000Z";
    const delivery = {
      channel: "linq" as const,
      idempotencyKey: "assistant-outbox:outbox_hosted_resume",
      sentAt,
      target: "chat_123",
      targetKind: "thread" as const,
      messageLength: "Queued the Linq reply.".length,
      providerMessageId: null,
      providerThreadId: null,
    };
    await writeFile(
      path.join(statePaths.outboxDirectory, `${intentId}.json`),
      `${JSON.stringify(assistantOutboxIntentSchema.parse({
        schema: "murph.assistant-outbox-intent.v1",
        intentId,
        sessionId: "sess_hosted",
        turnId: "turn_hosted",
        createdAt,
        updatedAt: createdAt,
        lastAttemptAt: null,
        nextAttemptAt: createdAt,
        sentAt: null,
        attemptCount: 0,
        status: "pending",
        message: "Queued the Linq reply.",
        dedupeKey: "dedupe_hosted_resume",
        targetFingerprint: "target_hosted_resume",
        channel: "linq",
        identityId: null,
        actorId: null,
        threadId: "chat_123",
        threadIsDirect: true,
        bindingDelivery: {
          kind: "thread",
          target: "chat_123",
        },
        explicitTarget: null,
        delivery: null,
        lastError: null,
      }))}\n`,
    );
    const initialSnapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    hostedCliMocks.runAssistantAutomation.mockImplementation(() => {
      throw new Error("resume path should not rerun hosted automation");
    });
    hostedCliMocks.runAssistantAutomation.mockClear();
    installSentAssistantOutboxDispatchMock({
      delivery,
      intentId,
      sentAt,
    });
    const fetchMock = vi.fn(async (input, init) => {
      const request = normalizeFetchRequest(input, init);
      throw new Error(`Unexpected fetch URL: ${request.url}`);
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await runHostedExecutionJob({
      bundles: {
        agentState: encodeHostedBundleBase64(initialSnapshot.agentStateBundle),
        vault: Buffer.from(initialSnapshot.vaultBundle).toString("base64"),
      },
      commit: {
        bundleRefs: {
          agentState: null,
          vault: null,
        },
      },
      runDrain: {
        acquiredAt: "2026-03-26T12:00:00.000Z",
        events: [],
        inputCommittedSeq: "0",
        inputCursorVersion: "0",
        resumeFinalize: true,
        runId: "run_outbox_resume",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      wake: createRuntimeTimerWake({ eventId: "evt_outbox_resume", occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_123" }),
    });

    expect(hostedCliMocks.runAssistantAutomation).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      hostedCliMocks.dispatchAssistantOutboxIntent.mock.calls.some(
        ([input]) => input.intentId === intentId,
      ),
    ).toBe(true);
    expect(result.result).toEqual({
      eventsHandled: 0,
      summary: FINALIZED_RUN_DRAIN_SUMMARY,
    });

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-resume-restored-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const savedIntent = assistantOutboxIntentSchema.parse(
      JSON.parse(
        await readFile(
          path.join(resolveAssistantStatePaths(restored.vaultRoot).outboxDirectory, `${intentId}.json`),
          "utf8",
        ),
      ),
    );
    expect(savedIntent.status).toBe("sent");
    expect(savedIntent.delivery).toEqual(delivery);
  });

  it("replays non-idempotent committed assistant deliveries from the outbox mirror without resending", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-resume-non-idempotent-"));
    const operatorHomeRoot = path.join(parent, "home");
    const vaultRoot = path.join(parent, "vault");
    cleanupPaths.push(parent);
    await mkdir(operatorHomeRoot, { recursive: true });
    await mkdir(vaultRoot, { recursive: true });

    const statePaths = resolveAssistantStatePaths(vaultRoot);
    await mkdir(statePaths.outboxDirectory, { recursive: true });
    const intentId = "outbox_hosted_resume_non_idempotent";
    const createdAt = "2026-03-26T12:00:00.000Z";
    const sentAt = "2026-03-26T12:00:05.000Z";
    const delivery = {
      channel: "telegram" as const,
      idempotencyKey: "assistant-outbox:outbox_hosted_resume_non_idempotent",
      messageLength: "Queued the Telegram reply.".length,
      providerMessageId: null,
      providerThreadId: null,
      sentAt,
      target: "chat_123",
      targetKind: "participant" as const,
    };
    await writeFile(
      path.join(statePaths.outboxDirectory, `${intentId}.json`),
      `${JSON.stringify(assistantOutboxIntentSchema.parse({
        schema: "murph.assistant-outbox-intent.v1",
        intentId,
        sessionId: "sess_hosted",
        turnId: "turn_hosted",
        createdAt,
        updatedAt: createdAt,
        lastAttemptAt: null,
        nextAttemptAt: createdAt,
        sentAt: null,
        attemptCount: 0,
        status: "pending",
        message: "Queued the Telegram reply.",
        dedupeKey: "dedupe_hosted_resume_non_idempotent",
        targetFingerprint: "target_hosted_resume_non_idempotent",
        channel: "telegram",
        identityId: null,
        actorId: null,
        threadId: "chat_123",
        threadIsDirect: true,
        bindingDelivery: {
          kind: "participant",
          target: "chat_123",
        },
        explicitTarget: null,
        delivery: null,
        lastError: null,
      }))}\n`,
    );
    const initialSnapshot = await snapshotHostedExecutionContext({
      operatorHomeRoot,
      vaultRoot,
    });

    hostedCliMocks.runAssistantAutomation.mockImplementation(() => {
      throw new Error("resume path should not rerun hosted automation");
    });
    hostedCliMocks.runAssistantAutomation.mockClear();
    installSentAssistantOutboxDispatchMock({
      delivery,
      intentId,
      sentAt,
    });
    const fetchMock = vi.fn(async (input, init) => {
      const request = normalizeFetchRequest(input, init);
      throw new Error(`Unexpected fetch URL: ${request.url}`);
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const result = await runHostedExecutionJob({
      bundles: {
        agentState: encodeHostedBundleBase64(initialSnapshot.agentStateBundle),
        vault: Buffer.from(initialSnapshot.vaultBundle).toString("base64"),
      },
      commit: {
        bundleRefs: {
          agentState: null,
          vault: null,
        },
      },
      runDrain: {
        acquiredAt: "2026-03-26T12:00:00.000Z",
        events: [],
        inputCommittedSeq: "0",
        inputCursorVersion: "0",
        resumeFinalize: true,
        runId: "run_outbox_resume_non_idempotent",
        triggerKind: "runtime_timer",
        userId: "member_123",
      },
      wake: createRuntimeTimerWake({ eventId: "evt_outbox_resume_non_idempotent", occurredAt: "2026-03-26T12:00:00.000Z", userId: "member_123" }),
    });

    expect(hostedCliMocks.runAssistantAutomation).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      hostedCliMocks.dispatchAssistantOutboxIntent.mock.calls.some(
        ([input]) => input.intentId === intentId,
      ),
    ).toBe(true);
    expect(result.result).toEqual({
      eventsHandled: 0,
      summary: FINALIZED_RUN_DRAIN_SUMMARY,
    });

    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-outbox-resume-non-idempotent-restored-"));
    cleanupPaths.push(workspaceRoot);
    const restored = await restoreHostedExecutionContext({
      agentStateBundle: decodeHostedBundleBase64(result.bundles.agentState),
      vaultBundle: Buffer.from(result.bundles.vault!, "base64"),
      workspaceRoot,
    });
    const savedIntent = assistantOutboxIntentSchema.parse(
      JSON.parse(
        await readFile(
          path.join(resolveAssistantStatePaths(restored.vaultRoot).outboxDirectory, `${intentId}.json`),
          "utf8",
        ),
      ),
    );
    expect(savedIntent.status).toBe("sent");
    expect(savedIntent.deliveryTransportIdempotent).toBe(false);
    expect(savedIntent.delivery).toEqual(delivery);
  });

  it("preserves worker-resolved runtime fields while keeping control-only and worker-only secret keys out of child env", () => {
    const previousAllowedUserEnvKeys = process.env.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS;
    const previousCommitTimeout = process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS;
    process.env.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS = "OPENAI_API_KEY";
    process.env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS = "15000";

    try {
      const runtime = buildHostedExecutionJobRuntime({
        commitTimeoutMs: 45_000,
        forwardedEnv: {
          HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
          HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: '{"kty":"EC","d":"automation"}',
          HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
          HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "5000",
          HOSTED_WAKE_ENCRYPTION_KEY: "wake-key",
          HOSTED_EMAIL_INGRESS_READY: "true",
          HOSTED_EMAIL_SEND_READY: "true",
          HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: '{"kty":"EC","d":"callback"}',
          OPENAI_API_KEY: "sk-worker",
        },
        resolvedConfig: {
          channelCapabilities: {
            emailSendReady: true,
            telegramBotConfigured: false,
          },
          deviceSync: null,
        },
        userEnv: {
          CUSTOM_API_KEY: "custom-user",
        },
      });

      expect(runtime.commitTimeoutMs).toBe(45_000);
      expect(runtime.forwardedEnv).toMatchObject({
        HOSTED_EMAIL_INGRESS_READY: "true",
        HOSTED_EMAIL_SEND_READY: "true",
        OPENAI_API_KEY: "sk-worker",
      });
      expect(runtime.forwardedEnv).not.toHaveProperty(
        "HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS",
      );
      expect(runtime.forwardedEnv).not.toHaveProperty(
        "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
      );
      expect(runtime.forwardedEnv).not.toHaveProperty(
        "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
      );
      expect(runtime.forwardedEnv).not.toHaveProperty(
        "HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS",
      );
      expect(runtime.forwardedEnv).not.toHaveProperty(
        "HOSTED_WAKE_ENCRYPTION_KEY",
      );
      expect(runtime.forwardedEnv).not.toHaveProperty(
        "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      );
      expect(runtime.userEnv).toMatchObject({
        CUSTOM_API_KEY: "custom-user",
      });
      expect(runtime.resolvedConfig).toEqual({
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      });
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS", previousAllowedUserEnvKeys);
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS", previousCommitTimeout);
    }
  });

  it("trusts the worker-supplied runtime envelope instead of rehydrating ambient runner env", () => {
    const previousRunnerEnvProfiles = process.env.HOSTED_EXECUTION_RUNNER_ENV_PROFILES;
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    const previousTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.HOSTED_EXECUTION_RUNNER_ENV_PROFILES = "telegram";
    process.env.OPENAI_API_KEY = "ambient-openai-key";
    process.env.TELEGRAM_BOT_TOKEN = "ambient-telegram-token";

    try {
      const runtime = buildHostedExecutionJobRuntime({
        forwardedEnv: {
          HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "telegram",
          OPENAI_API_KEY: "job-openai-key",
        },
        resolvedConfig: {
          channelCapabilities: {
            emailSendReady: false,
            telegramBotConfigured: false,
          },
          deviceSync: null,
        },
      });

      expect(runtime.forwardedEnv).toEqual({
        OPENAI_API_KEY: "job-openai-key",
      });
      expect(runtime.resolvedConfig).toEqual({
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      });
    } finally {
      restoreEnvVar("HOSTED_EXECUTION_RUNNER_ENV_PROFILES", previousRunnerEnvProfiles);
      restoreEnvVar("OPENAI_API_KEY", previousOpenAiApiKey);
      restoreEnvVar("TELEGRAM_BOT_TOKEN", previousTelegramBotToken);
    }
  });

  it("derives Telegram runtime capabilities from explicit platform env when forwarded env omits them", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        OPENAI_API_KEY: "job-openai-key",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
    });

    expect(runtime.forwardedEnv).toEqual({
      OPENAI_API_KEY: "job-openai-key",
    });
    expect(runtime.platformEnv).toEqual({
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    });
    expect(runtime.resolvedConfig).toEqual({
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: true,
      },
      deviceSync: null,
    });
  });

  it("falls back to ambient runner env only when the runtime envelope omits forwarded env entirely", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    const previousAmbientRunnerEnv = {
      ...captureEnvVars([
        "BRAVE_API_KEY",
        "FFMPEG_COMMAND",
        "HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL",
        "HOSTED_EXECUTION_RUNNER_ENV_PROFILES",
        "HOSTED_ASSISTANT_BASE_URL",
        "WHISPER_COMMAND",
        "WHISPER_MODEL_PATH",
        ...HOSTED_RUNNER_ENV_KEY_NAMES,
        ...HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
        ...HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
      ]),
      ...captureEnvVarsWithPrefixes([
        ...HOSTED_DEVICE_SYNC_ENV_PREFIXES,
        "HOSTED_EMAIL_",
        "LINQ_",
        "MAPBOX_",
        "MURPH_WEB_",
        "TELEGRAM_",
      ]),
    };
    restoreEnvVars(
      Object.fromEntries(
        Object.keys(previousAmbientRunnerEnv).map((key) => [key, undefined]),
      ),
    );
    process.env.HOSTED_ASSISTANT_BASE_URL = "http://127.0.0.1:4111/v1";
    process.env.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL = "http://host.docker.internal:8787";
    process.env.NODE_ENV = "production";
    process.env.OPENAI_API_KEY = "ambient-openai-key";

    try {
      const runtime = buildHostedExecutionJobRuntime({});

      expect(runtime.forwardedEnv).toEqual({
        HOSTED_ASSISTANT_BASE_URL: "http://127.0.0.1:4111/v1",
        HOSTED_EMAIL_INGRESS_READY: "false",
        HOSTED_EMAIL_SEND_READY: "false",
        NODE_ENV: "production",
        OPENAI_API_KEY: "ambient-openai-key",
      });
    } finally {
      restoreEnvVar("NODE_ENV", previousNodeEnv);
      restoreEnvVar("OPENAI_API_KEY", previousOpenAiApiKey);
      restoreEnvVars(previousAmbientRunnerEnv);
    }
  });

  it("treats an explicitly empty forwarded env envelope as authoritative", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.NODE_ENV = "production";
    process.env.OPENAI_API_KEY = "ambient-openai-key";

    try {
      const runtime = buildHostedExecutionJobRuntime({
        forwardedEnv: {},
      });

      expect(runtime.forwardedEnv).toEqual({});
      expect(runtime.resolvedConfig).toEqual({
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      });
    } finally {
      restoreEnvVar("NODE_ENV", previousNodeEnv);
      restoreEnvVar("OPENAI_API_KEY", previousOpenAiApiKey);
    }
  });

  it("derives explicit runtime capabilities from separately supplied Telegram platform env", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
        DEVICE_SYNC_SECRET: "secret_123",
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_INGRESS_READY: "true",
        HOSTED_EMAIL_LOCAL_PART: "assistant",
        HOSTED_EMAIL_SEND_READY: "true",
        HOSTED_EMAIL_SIGNING_SECRET: "email-secret",
        WHOOP_CLIENT_ID: "whoop-client",
        WHOOP_CLIENT_SECRET: "whoop-secret",
      },
      platformEnv: {
        TELEGRAM_API_BASE_URL: "https://api.telegram.example",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
      },
    });

    expect(runtime.forwardedEnv).not.toHaveProperty("TELEGRAM_BOT_TOKEN");
    expect(runtime.forwardedEnv).not.toHaveProperty("TELEGRAM_API_BASE_URL");
    expect(runtime.forwardedEnv).not.toHaveProperty("TELEGRAM_FILE_BASE_URL");
    expect(runtime.platformEnv).toEqual({
      TELEGRAM_API_BASE_URL: "https://api.telegram.example",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_FILE_BASE_URL: "https://files.telegram.example",
    });
    expect(runtime.resolvedConfig).toMatchObject({
      channelCapabilities: {
        emailSendReady: true,
        telegramBotConfigured: true,
      },
      deviceSync: {
        providerConfigs: {
          whoop: {
            clientId: "whoop-client",
            clientSecret: "whoop-secret",
          },
        },
        publicBaseUrl: "https://device-sync.example.test",
        secret: "secret_123",
      },
    });
  });

  it("preserves worker-resolved hosted email readiness instead of rereading ambient env", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_EMAIL_INGRESS_READY: "true",
        HOSTED_EMAIL_SEND_READY: "true",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: true,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      },
    });

    expect(runtime.forwardedEnv).toMatchObject({
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_SEND_READY: "true",
    });
    expect(runtime.resolvedConfig).toEqual({
      channelCapabilities: {
        emailSendReady: true,
        telegramBotConfigured: false,
      },
      deviceSync: null,
    });
  });

  it("keeps worker-resolved hosted email readiness disabled", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_EMAIL_INGRESS_READY: "false",
        HOSTED_EMAIL_SEND_READY: "false",
      },
      resolvedConfig: {
        channelCapabilities: {
          emailSendReady: false,
          telegramBotConfigured: false,
        },
        deviceSync: null,
      },
    });

    expect(runtime.forwardedEnv).toMatchObject({
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "false",
    });
    expect(runtime.resolvedConfig).toEqual({
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
      },
      deviceSync: null,
    });
  });

  it("derives email channel readiness from forwarded capability flags when resolved config is absent", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_LOCAL_PART: "assistant",
        HOSTED_EMAIL_INGRESS_READY: "true",
        HOSTED_EMAIL_SEND_READY: "true",
      },
    });

    expect(runtime.resolvedConfig).toEqual({
      channelCapabilities: {
        emailSendReady: true,
        telegramBotConfigured: false,
      },
      deviceSync: null,
    });
  });

});

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function setHostedRunnerEnvProfiles(value: string): string | undefined {
  const previousValue = process.env.HOSTED_EXECUTION_RUNNER_ENV_PROFILES;
  process.env.HOSTED_EXECUTION_RUNNER_ENV_PROFILES = value;
  return previousValue;
}

function setHostedAssistantSeedEnv(): Record<string, string | undefined> {
  const previousEnv = captureEnvVars(HOSTED_ASSISTANT_CONFIG_ENV_NAMES);
  process.env.HOSTED_ASSISTANT_MODEL = "gpt-4.1-mini";
  process.env.HOSTED_ASSISTANT_PROVIDER = "openai";
  return previousEnv;
}

function clearHostedAssistantSeedEnv(): Record<string, string | undefined> {
  const previousEnv = captureEnvVars(HOSTED_ASSISTANT_CONFIG_ENV_NAMES);
  for (const key of HOSTED_ASSISTANT_CONFIG_ENV_NAMES) {
    restoreEnvVar(key, undefined);
  }
  return previousEnv;
}

function captureEnvVars(keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function captureEnvVarsWithPrefixes(prefixes: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.keys(process.env)
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .map((key) => [key, process.env[key]]),
  );
}

function restoreEnvVars(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    restoreEnvVar(key, value);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });

  return {
    promise,
    reject,
    resolve,
  };
}
