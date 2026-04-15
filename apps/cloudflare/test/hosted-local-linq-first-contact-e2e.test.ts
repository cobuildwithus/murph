import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openInboxRuntime, rebuildRuntimeFromVault } from "@murphai/inboxd";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionDispatchResult,
  parseHostedExecutionUserStatus,
} from "@murphai/hosted-execution/parsers";
import {
  resolveAssistantStatePaths,
  restoreHostedExecutionContext,
  type HostedExecutionBundleRef,
} from "@murphai/runtime-state/node";

import { createHostedBundleStore } from "../src/bundle-store.js";
import { readHostedExecutionEnvironment } from "../src/env.js";
import { createHostedUserKeyStore } from "../src/user-key-store.js";
import { repoRoot } from "../vitest.shared.js";
import { resolveHostedLocalDevConfig } from "../../../scripts/dev-hosted-local/config.ts";
import { parseEnvText } from "../../../scripts/dev-hosted-local/environment.ts";
import {
  terminateChildProcessAndWait,
  waitForHealthyHttpEndpoint,
} from "../../../scripts/dev-hosted-local/runtime.ts";
import { resolveVercelOidcToken } from "../../../scripts/dev-hosted-local/vercel.ts";

interface ObservedLinqRequest {
  body: string;
  method: string;
  url: string;
}

const nextEnvPath = path.join(repoRoot, "apps/web/next-env.d.ts");
const userId = `member_local_linq_first_contact_${Date.now()}`;
const directReplyUserId = `member_local_linq_direct_reply_${Date.now()}`;

const observedLinqRequests: ObservedLinqRequest[] = [];
const devEnv: NodeJS.ProcessEnv = {
  ...process.env,
  MURPH_DEV_CF_WRANGLER_LOG_LEVEL: "debug",
  MURPH_HOSTED_EXECUTION_RELAY_CHILD_INFO_LOGS: "1",
  MURPH_DEV_SKIP_PRISMA_MIGRATE: "1",
  MURPH_DEV_SKIP_WEB: "1",
  MURPH_DEV_WEB_PORT: "3213",
  MURPH_DEV_WORKER_PORT: "8902",
  NEXT_DIST_DIR_MODE: "smoke",
};
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const debugE2E = process.env.MURPH_E2E_DEBUG_PROGRESS === "1";
const useAssistantProviderStub = process.env.MURPH_E2E_STUB_ASSISTANT_PROVIDER !== "0";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const devConfig = resolveHostedLocalDevConfig(devEnv);
const workerBaseUrl = `${devConfig.workerProtocol}://${devConfig.workerHost}:${devConfig.workerPort}`;
const expectedLinqChatPath = `/chats/${encodeURIComponent(`chat:${userId}`)}/messages`;
const expectedDirectReplyChatPath = `/chats/${encodeURIComponent(`chat:${directReplyUserId}`)}/messages`;

let devStdout = "";
let devStderr = "";
let linqServer: ReturnType<typeof createServer> | null = null;
let linqServerBaseUrl = "";
let assistantProviderServer: ReturnType<typeof createServer> | null = null;
let assistantProviderBaseUrl = "";
let oidcToken = "";
let workerPersistDir: string | null = null;
let originalNextEnvContents: string | null = null;

describe("hosted local Linq first-contact e2e", () => {
  let devChild: ChildProcess | null = null;

  beforeAll(async () => {
    logDebug("starting hosted local Linq e2e setup");
    observedLinqRequests.length = 0;
    originalNextEnvContents = await readFile(nextEnvPath, "utf8");
    if (workerPersistDirOverride) {
      await rm(workerPersistDirOverride, { force: true, recursive: true });
      await mkdir(workerPersistDirOverride, { recursive: true });
      workerPersistDir = path.resolve(repoRoot, workerPersistDirOverride);
    } else {
      workerPersistDir = await mkdtemp(path.join(os.tmpdir(), "murph-hosted-local-linq-first-contact-"));
    }
    linqServer = await startLinqStubServer();
    const address = linqServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected the Linq stub server to bind a TCP port.");
    }
    linqServerBaseUrl = `http://127.0.0.1:${address.port}`;
    logDebug("started Linq stub server", { linqServerBaseUrl });
    if (useAssistantProviderStub) {
      assistantProviderServer = await startAssistantProviderStubServer();
      const providerAddress = assistantProviderServer.address();
      if (!providerAddress || typeof providerAddress === "string") {
        throw new Error("Expected the assistant provider stub server to bind a TCP port.");
      }
      assistantProviderBaseUrl = `http://host.docker.internal:${providerAddress.port}/v1`;
      logDebug("started assistant provider stub server", {
        assistantProviderBaseUrl,
      });
    }
    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      process.env,
      useAssistantProviderStub ? assistantProviderBaseUrl : null,
    );
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...devEnv,
      ...hostedAssistantDevEnv,
      LINQ_API_BASE_URL: linqServerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      MURPH_DEV_CF_PERSIST_DIR: workerPersistDir,
    };
    devChild = spawn("pnpm", ["dev"], {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: runtimeEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    devChild.stdout?.setEncoding("utf8");
    devChild.stderr?.setEncoding("utf8");
    devChild.stdout?.on("data", (chunk: string) => {
      devStdout += chunk;
      if (streamDevLogs) {
        process.stdout.write(chunk);
      }
    });
    devChild.stderr?.on("data", (chunk: string) => {
      devStderr += chunk;
      if (streamDevLogs) {
        process.stderr.write(chunk);
      }
    });

    try {
      oidcToken = await resolveVercelOidcToken(runtimeEnv);
      await waitForDevReadyBanner();
      await waitForHealthyHttpEndpoint({
        host: devConfig.workerHost,
        label: "cloudflare",
        path: "/health",
        port: devConfig.workerPort,
        protocol: devConfig.workerProtocol,
      });
      logDebug("cloudflare worker healthy", {
        workerBaseUrl,
        workerPersistDir,
      });
    } catch (error) {
      throw new Error([
        error instanceof Error ? error.message : String(error),
        `stdout tail: ${tail(devStdout)}`,
        `stderr tail: ${tail(devStderr)}`,
      ].join("\n"));
    }
  }, 300_000);

  afterAll(async () => {
    logDebug("tearing down hosted local Linq e2e");
    if (devChild?.pid) {
      await terminateChildProcessAndWait(devChild, { signal: "SIGTERM" });
    }

    await stopLinqStubServer(linqServer);
    await stopAssistantProviderStubServer(assistantProviderServer);

    if (originalNextEnvContents !== null) {
      await writeFile(nextEnvPath, originalNextEnvContents, "utf8");
    }

    if (workerPersistDir && !workerPersistDirOverride) {
      await rm(workerPersistDir, { force: true, recursive: true });
    }
  });

  it("sends the first-contact Linq welcome through the live local worker", async () => {
    logDebug("dispatching activation", { userId });
    const dispatchResult = await dispatchHostedEvent(buildActivationDispatch(userId), userId);
    expect(dispatchResult.event).toMatchObject({
      eventId: `member.activated:local:${userId}:evt_linq_first_contact`,
      lastError: null,
      state: "completed",
      userId,
    });

    const finalStatus = await waitForHostedCompletion(userId);
    logDebug("activation completed", { userId, finalStatus });
    expect(finalStatus.bundleRef).not.toBeNull();
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);

    const sendRequest = await waitForLinqSend({
      expectedPath: expectedLinqChatPath,
      userId,
    });
    expect(sendRequest.method).toBe("POST");
    expect(sendRequest.url).toBe(expectedLinqChatPath);
    expect(JSON.parse(sendRequest.body)).toMatchObject({
      message: {
        idempotency_key: expect.stringContaining("assistant-first-contact"),
        parts: [
          {
            type: "text",
            value: expect.stringContaining("Murph"),
          },
        ],
      },
    });
  }, 300_000);

  it("sends a Linq reply after a later inbound Linq message", async () => {
    logDebug("dispatching direct-reply activation", { userId: directReplyUserId });
    const activationResult = await dispatchHostedEvent(
      buildActivationDispatch(directReplyUserId),
      directReplyUserId,
    );
    expect(activationResult.event).toMatchObject({
      eventId: `member.activated:local:${directReplyUserId}:evt_linq_first_contact`,
      lastError: null,
      state: "completed",
      userId: directReplyUserId,
    });

    await waitForHostedCompletion(directReplyUserId);
    logDebug("direct-reply activation completed", { userId: directReplyUserId });
    await waitForLinqSend({
      expectedPath: expectedDirectReplyChatPath,
      userId: directReplyUserId,
    });

    const outboundCountBeforeReply = countObservedLinqSends(expectedDirectReplyChatPath);
    logDebug("dispatching later inbound Linq message", {
      baselineSendCount: outboundCountBeforeReply,
      userId: directReplyUserId,
    });
    const inboundDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: `linq.message.received:local:${directReplyUserId}:evt_direct_reply`,
      linqEvent: buildInboundLinqEvent(directReplyUserId),
      linqMessageId: `msg_local_${directReplyUserId}`,
      occurredAt: new Date().toISOString(),
      phoneLookupKey: directReplyUserId,
      userId: directReplyUserId,
    });
    const inboundResult = await dispatchHostedEvent(inboundDispatch, directReplyUserId);
    expect(inboundResult.event).toMatchObject({
      eventId: `linq.message.received:local:${directReplyUserId}:evt_direct_reply`,
      lastError: null,
      state: "completed",
      userId: directReplyUserId,
    });

    await waitForHostedCompletion(directReplyUserId);
    logDebug("later inbound Linq message completed", { userId: directReplyUserId });
    const replySend = await waitForAdditionalLinqSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedDirectReplyChatPath,
      userId: directReplyUserId,
    });
    expect(replySend.method).toBe("POST");
  }, 300_000);

  async function dispatchHostedEvent(dispatch: object, nextUserId: string) {
    logDebug("POST /internal/dispatch", {
      eventId:
        typeof dispatch === "object" && dispatch !== null && "eventId" in dispatch
          ? (dispatch as { eventId?: unknown }).eventId
          : null,
      userId: nextUserId,
    });
    const response = await fetch(new URL("/internal/dispatch", `${workerBaseUrl}/`), {
      body: JSON.stringify(dispatch),
      headers: {
        authorization: `Bearer ${oidcToken}`,
        "content-type": "application/json; charset=utf-8",
        [HOSTED_EXECUTION_USER_ID_HEADER]: nextUserId,
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error([
        `POST /internal/dispatch failed with HTTP ${response.status}.`,
        `body: ${await response.text()}`,
        `stdout tail: ${tail(devStdout)}`,
        `stderr tail: ${tail(devStderr)}`,
      ].join("\n"));
    }

    const parsed = parseHostedExecutionDispatchResult(await response.json());
    logDebug("dispatch completed", {
      eventId: parsed.event.eventId,
      state: parsed.event.state,
      userId: nextUserId,
    });
    return parsed;
  }

  async function readUserStatus(nextUserId: string) {
    const response = await fetch(
      new URL(`/internal/users/${encodeURIComponent(nextUserId)}/status`, `${workerBaseUrl}/`),
      {
        headers: {
          authorization: `Bearer ${oidcToken}`,
          [HOSTED_EXECUTION_USER_ID_HEADER]: nextUserId,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`GET status failed with HTTP ${response.status}.`);
    }

    return parseHostedExecutionUserStatus(await response.json());
  }

async function waitForHostedCompletion(nextUserId: string) {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 180_000) {
      const status = await readUserStatus(nextUserId);

      if (
        status.pendingEventCount === 0
        && !status.inFlight
        && status.bundleRef !== null
        && status.lastError === null
      ) {
        logDebug("hosted status reached completion", {
          elapsedMs: Date.now() - startedAt,
          status,
          userId: nextUserId,
        });
        return status;
      }

      if (Date.now() >= nextProgressLogAt) {
        logDebug("waiting for hosted completion", {
          elapsedMs: Date.now() - startedAt,
          inFlight: status.inFlight,
          lastError: status.lastError,
          pendingEventCount: status.pendingEventCount,
          userId: nextUserId,
        });
        nextProgressLogAt = Date.now() + 5_000;
      }

      await sleep(1_000);
    }

    throw new Error([
      `Timed out waiting for hosted completion for ${nextUserId}.`,
      `stdout tail: ${tail(devStdout)}`,
      `stderr tail: ${tail(devStderr)}`,
    ].join("\n"));
}

async function waitForDevReadyBanner(): Promise<void> {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 180_000) {
    if (devStdout.includes("Local hosted dev is ready.")) {
      logDebug("observed local hosted dev ready banner", {
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }

    await sleep(250);
  }

  throw new Error([
    "Timed out waiting for the local hosted dev ready banner.",
    `stdout tail: ${tail(devStdout)}`,
    `stderr tail: ${tail(devStderr)}`,
  ].join("\n"));
}

async function waitForLinqSend(input: {
    expectedPath: string;
    userId: string;
  }): Promise<ObservedLinqRequest> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 30_000) {
      const sendRequest = observedLinqRequests.find((request) =>
        request.method === "POST"
        && request.url === input.expectedPath
      );

      if (sendRequest) {
        logDebug("observed first Linq send", {
          elapsedMs: Date.now() - startedAt,
          expectedPath: input.expectedPath,
          userId: input.userId,
        });
        return sendRequest;
      }

      if (Date.now() >= nextProgressLogAt) {
        logDebug("waiting for first Linq send", {
          elapsedMs: Date.now() - startedAt,
          expectedPath: input.expectedPath,
          observedSendCount: countObservedLinqSends(input.expectedPath),
          userId: input.userId,
        });
        nextProgressLogAt = Date.now() + 5_000;
      }

      await sleep(250);
    }

    const status = await formatHostedDebugStatus(input.userId);
    throw new Error([
      `Timed out waiting for a Linq send for ${input.userId}.`,
      `observed requests: ${JSON.stringify(observedLinqRequests)}`,
      `hosted status: ${status}`,
      `stdout tail: ${tail(devStdout)}`,
      `stderr tail: ${tail(devStderr)}`,
    ].join("\n"));
  }

  async function waitForAdditionalLinqSend(input: {
    baselineCount: number;
    expectedPath: string;
    userId: string;
  }): Promise<ObservedLinqRequest> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 60_000) {
      const matchingRequests = observedLinqRequests.filter((request) =>
        request.method === "POST"
        && request.url === input.expectedPath
      );

      if (matchingRequests.length > input.baselineCount) {
        const newest = matchingRequests.at(-1);
        if (newest) {
          logDebug("observed additional Linq send", {
            baselineCount: input.baselineCount,
            elapsedMs: Date.now() - startedAt,
            expectedPath: input.expectedPath,
            userId: input.userId,
          });
          return newest;
        }
      }

      if (Date.now() >= nextProgressLogAt) {
        logDebug("waiting for additional Linq send", {
          baselineCount: input.baselineCount,
          elapsedMs: Date.now() - startedAt,
          expectedPath: input.expectedPath,
          matchingRequestCount: matchingRequests.length,
          userId: input.userId,
        });
        nextProgressLogAt = Date.now() + 5_000;
      }

      await sleep(250);
    }

    const status = await formatHostedDebugStatus(input.userId);
    throw new Error([
      `Timed out waiting for an additional Linq send for ${input.userId}.`,
      `observed requests: ${JSON.stringify(observedLinqRequests)}`,
      `hosted status: ${status}`,
      `stdout tail: ${tail(devStdout)}`,
      `stderr tail: ${tail(devStderr)}`,
    ].join("\n"));
  }
});

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function logDebug(message: string, details?: Record<string, unknown>): void {
  if (!debugE2E) {
    return;
  }

  const payload = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[hosted-local-linq-e2e] ${message}${payload}`);
}

function tail(value: string, maxChars: number = 2_000): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}

async function formatHostedDebugStatus(nextUserId: string): Promise<string> {
  try {
    const response = await fetch(
      new URL(`/internal/users/${encodeURIComponent(nextUserId)}/status`, `${workerBaseUrl}/`),
      {
        headers: {
          authorization: `Bearer ${oidcToken}`,
          [HOSTED_EXECUTION_USER_ID_HEADER]: nextUserId,
        },
      },
    );
    const body = await response.text();
    const parsedBody = response.ok ? parseHostedExecutionUserStatus(JSON.parse(body)) : null;
    return JSON.stringify({
      body: body.length <= 4_000 ? body : `${body.slice(0, 4_000)}...`,
      persistedState:
        parsedBody?.bundleRef
          ? await inspectPersistedHostedState({
            bundleRef: parsedBody.bundleRef,
            userId: parsedBody.userId,
          })
          : null,
      status: response.status,
    });
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildActivationDispatch(nextUserId: string) {
  return buildHostedExecutionMemberActivatedDispatch({
    eventId: `member.activated:local:${nextUserId}:evt_linq_first_contact`,
    firstContact: {
      channel: "linq",
      identityId: `linq:${nextUserId}`,
      threadId: `chat:${nextUserId}`,
      threadIsDirect: true,
    },
    memberId: nextUserId,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    occurredAt: new Date().toISOString(),
  });
}

function buildInboundLinqEvent(nextUserId: string) {
  return {
    api_version: "v3",
    created_at: new Date().toISOString(),
    data: {
      chat: {
        id: `chat:${nextUserId}`,
        is_group: false,
        owner_handle: {
          handle: "+15555559876",
          id: `handle_owner_${nextUserId}`,
          is_me: true,
          service: "SMS",
        },
      },
      chat_id: `chat:${nextUserId}`,
      direction: "inbound",
      from: "+15555550123",
      from_handle: {
        handle: "+15555550123",
        id: `handle_sender_${nextUserId}`,
        service: "SMS",
      },
      is_from_me: false,
      message: {
        id: `msg_local_${nextUserId}`,
        parts: [
          {
            type: "text",
            value: "hello mate",
          },
        ],
      },
      recipient_handle: {
        handle: "+15555559876",
        id: `handle_owner_${nextUserId}`,
        is_me: true,
        service: "SMS",
      },
      recipient_phone: "+15555559876",
      received_at: new Date().toISOString(),
      sender_handle: {
        handle: "+15555550123",
        id: `handle_sender_${nextUserId}`,
        service: "SMS",
      },
      service: "SMS",
      sent_at: new Date().toISOString(),
    },
    event_id: `evt_linq_inbound_${nextUserId}`,
    event_type: "message.received",
  };
}

function countObservedLinqSends(expectedPath: string): number {
  return observedLinqRequests.filter((request) =>
    request.method === "POST"
    && request.url === expectedPath
  ).length;
}

async function inspectPersistedHostedState(input: {
  bundleRef: HostedExecutionBundleRef;
  userId: string;
}): Promise<Record<string, unknown>> {
  if (!workerPersistDir) {
    return {
      error: "worker persist dir unavailable",
    };
  }

  try {
    const env = readHostedExecutionEnvironment(
      parseEnvText(await readFile(await resolveLatestLocalWorkerEnvPath(), "utf8")),
    );
    const r2Root = path.join(workerPersistDir, "v3", "r2");
    const r2DbDirectory = path.join(r2Root, "miniflare-R2BucketObject");
    const [r2DbFileName] = (await readdir(r2DbDirectory)).filter((entry) => entry.endsWith(".sqlite"));
    const blobRoot = path.join(r2Root, "murph-hosted-bundles-preview", "blobs");

    if (!r2DbFileName) {
      return {
        error: "local R2 sqlite not found",
      };
    }

    const r2Db = new DatabaseSync(path.join(r2DbDirectory, r2DbFileName), {
      readOnly: true,
    });
    const bucket = {
      async get(key: string) {
        const row = r2Db
          .prepare("select blob_id from _mf_objects where key = ?")
          .get(key) as { blob_id: string } | undefined;
        if (!row) {
          return null;
        }

        const payload = await readFile(path.join(blobRoot, row.blob_id));
        return {
          async arrayBuffer() {
            return payload.buffer.slice(
              payload.byteOffset,
              payload.byteOffset + payload.byteLength,
            );
          },
        };
      },
      async put(): Promise<never> {
        throw new Error("debug bucket is read-only");
      },
    };
    const userKeyStore = createHostedUserKeyStore({
      automationRecipientKeyId: env.automationRecipientKeyId,
      automationRecipientPrivateKey: env.automationRecipientPrivateKey,
      automationRecipientPrivateKeysById: env.automationRecipientPrivateKeysById,
      automationRecipientPublicKey: env.automationRecipientPublicKey,
      bucket,
      envelopeEncryptionKey: env.platformEnvelopeKey,
      envelopeEncryptionKeyId: env.platformEnvelopeKeyId,
      envelopeEncryptionKeysById: env.platformEnvelopeKeysById,
      recoveryRecipientKeyId: env.recoveryRecipientKeyId,
      recoveryRecipientPublicKey: env.recoveryRecipientPublicKey,
      teeAutomationRecipientKeyId: env.teeAutomationRecipientKeyId,
      teeAutomationRecipientPublicKey: env.teeAutomationRecipientPublicKey,
    });
    const userCrypto = await userKeyStore.requireUserCryptoContext(input.userId);
    const bundleStore = createHostedBundleStore({
      bucket,
      key: userCrypto.rootKey,
      keyId: userCrypto.rootKeyId,
      keysById: userCrypto.keysById,
    });
    const bundle = await bundleStore.readBundle(input.bundleRef);

    if (!bundle) {
      return {
        error: "bundle bytes missing from local R2",
      };
    }

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "murph-linq-debug-"));
    const restored = await restoreHostedExecutionContext({
      bundle,
      workspaceRoot,
    });
    const assistantPaths = resolveAssistantStatePaths(restored.vaultRoot);
    const inboxRuntime = await openInboxRuntime({
      vaultRoot: restored.vaultRoot,
    });

    try {
      await rebuildRuntimeFromVault({
        runtime: inboxRuntime,
        vaultRoot: restored.vaultRoot,
      });

      return {
        assistantStatus: await readJsonIfPresent(assistantPaths.statusPath),
        automationState: await readJsonIfPresent(assistantPaths.automationStatePath),
        captures: inboxRuntime
          .listCaptures({ limit: 20 })
          .map((capture) => ({
            actorIsSelf: capture.actor.isSelf,
            captureId: capture.captureId,
            occurredAt: capture.occurredAt,
            replyToMessageId:
              capture.raw && typeof capture.raw === "object" && capture.raw !== null
                ? (capture.raw as Record<string, unknown>).reply_to_message_id ?? null
                : null,
            source: capture.source,
            text: capture.text,
            threadId: capture.thread.id,
          })),
        outboxIntents: await listJsonDirectoryEntries(assistantPaths.outboxDirectory),
        receipts: await listJsonDirectoryEntries(assistantPaths.turnsDirectory),
      };
    } finally {
      inboxRuntime.close();
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveLatestLocalWorkerEnvPath(): Promise<string> {
  const tempEntries = await readdir(os.tmpdir(), {
    withFileTypes: true,
  });
  const candidateDirectories = tempEntries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("murph-dev-env-"))
    .map((entry) => entry.name)
    .sort();
  const latestDirectory = candidateDirectories.at(-1);

  if (!latestDirectory) {
    throw new Error("Local Cloudflare worker env directory not found.");
  }

  return path.join(os.tmpdir(), latestDirectory, "cloudflare-worker.env");
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function listJsonDirectoryEntries(directoryPath: string): Promise<unknown[]> {
  try {
    const entries = await readdir(directoryPath, {
      withFileTypes: true,
    });
    const jsonEntries = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(-10);

    return await Promise.all(
      jsonEntries.map(async (entry) => {
        const parsed = await readJsonIfPresent(path.join(directoryPath, entry.name));
        return {
          file: entry.name,
          value: parsed,
        };
      }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function startLinqStubServer(): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    observedLinqRequests.push({
      body,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });

    if (
      request.method === "POST"
      && request.url
      && /^\/chats\/[^/]+\/messages$/u.test(request.url)
    ) {
      writeJsonResponse(response, 200, {
        data: {
          id: `linq_msg_${Date.now()}`,
          chat_id: request.url.split("/")[2],
        },
      });
      return;
    }

    writeJsonResponse(response, 200, { ok: true });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => resolve());
  });

  return server;
}

async function stopLinqStubServer(server: ReturnType<typeof createServer> | null): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function startAssistantProviderStubServer(): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    await readRequestBody(request);

    if (request.method === "GET" && request.url === "/v1/models") {
      writeJsonResponse(response, 200, {
        data: [
          {
            id: "stub-openrouter-model",
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      writeJsonResponse(response, 200, {
        id: "chatcmpl_stub_linq_reply",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "stub-openrouter-model",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "Got it — I saw your message and I’m here.",
            },
          },
        ],
        usage: {
          prompt_tokens: 24,
          completion_tokens: 11,
          total_tokens: 35,
        },
      });
      return;
    }

    writeJsonResponse(response, 404, {
      error: `Unhandled assistant provider stub route: ${request.method ?? "GET"} ${request.url ?? "/"}`,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

async function stopAssistantProviderStubServer(
  server: ReturnType<typeof createServer> | null,
): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function resolveHostedAssistantLocalDevEnv(
  source: NodeJS.ProcessEnv,
  assistantProviderStubBaseUrl: string | null,
): NodeJS.ProcessEnv {
  if (assistantProviderStubBaseUrl) {
    return {
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_BASE_URL: assistantProviderStubBaseUrl,
      HOSTED_ASSISTANT_MODEL: "stub-openrouter-model",
      HOSTED_ASSISTANT_PROVIDER: "openrouter",
      HOSTED_ASSISTANT_PROVIDER_NAME: "local-openrouter-stub",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      OPENAI_API_KEY: "stub-local-openrouter-key",
    };
  }

  const provider = source.HOSTED_ASSISTANT_PROVIDER?.trim();
  const model = source.HOSTED_ASSISTANT_MODEL?.trim();

  if (provider && model) {
    return {};
  }

  if (source.OPENAI_API_KEY?.trim()) {
    return {
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
    };
  }

  throw new Error(
    [
      "Local hosted Linq e2e requires explicit hosted assistant config.",
      "Set HOSTED_ASSISTANT_PROVIDER and HOSTED_ASSISTANT_MODEL, or provide OPENAI_API_KEY for the local fallback profile.",
    ].join(" "),
  );
}
