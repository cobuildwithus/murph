import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  startHostedLocalDevHarness,
  type HostedLocalDevHarness,
} from "./helpers/hosted-local-dev-harness.js";
import { appendHostedWakeAndWakeWorker } from "./helpers/hosted-local-dispatch.js";
import {
  startHostedLocalOidcFixture,
  type HostedLocalOidcFixture,
} from "./helpers/hosted-local-oidc-support.js";
import {
  buildHostLoopbackStubBaseUrl,
  readRequestBody,
  reserveLocalTcpPort,
  resolveHostedAssistantLocalDevEnv,
  resolveHostedLocalSmokeWebEnv,
  shouldUseAssistantProviderStub,
  startAssistantProviderStubServer,
  stopHttpStubServer,
  writeJsonResponse,
} from "./helpers/hosted-local-e2e-support.js";
import { createHostedPhoneLookupKey } from "./helpers/hosted-contact-privacy.js";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
} from "./hosted-execution-fixtures.js";
import {
  DEFAULT_DATABASE_URL,
} from "../../../scripts/dev-hosted-local/constants.ts";

interface ObservedLinqRequest {
  body: string;
  method: string;
  url: string;
}

type ObservedLinqRequestMatcher = (request: ObservedLinqRequest) => boolean;

const userId = `member_local_linq_first_contact_${Date.now()}`;
const directReplyUserId = `member_local_linq_direct_reply_${Date.now()}`;
const fastReplyUserId = `member_local_linq_fast_reply_${Date.now()}`;

const observedLinqRequests: ObservedLinqRequest[] = [];
const observedLinqChatIdsByRecipient = new Map<string, string>();
const observedAssistantProviderBodies: string[] = [];
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const debugE2E = process.env.MURPH_E2E_DEBUG_PROGRESS === "1";
const useAssistantProviderStub = shouldUseAssistantProviderStub(process.env);
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
const expectedLinqCreateChatPath = "/chats";

let linqServer: ReturnType<typeof createServer> | null = null;
let linqServerBaseUrl = "";
let assistantProviderServer: ReturnType<typeof createServer> | null = null;
let assistantProviderBaseUrl = "";
let localHarness: HostedLocalDevHarness | null = null;
let oidcFixture: HostedLocalOidcFixture | null = null;
let workerBaseUrl = "";
let workerPersistDir: string | null = null;

it("derives stable numeric suffixes from the full Linq user id", () => {
  expect(buildStableTestNumericSuffix("member_local_linq_first_contact_20260408", 7)).not.toBe(
    buildStableTestNumericSuffix("member_local_linq_direct_reply_20260408", 7),
  );
});

describe("hosted local Linq first-contact e2e", () => {
  beforeAll(async () => {
    logDebug("starting hosted local Linq e2e setup");
    observedLinqRequests.length = 0;
    observedLinqChatIdsByRecipient.clear();
    observedAssistantProviderBodies.length = 0;
    linqServer = await startLinqStubServer();
    linqServerBaseUrl = buildHostLoopbackStubBaseUrl(linqServer, "Linq stub");
    logDebug("started Linq stub server", { linqServerBaseUrl });
    if (useAssistantProviderStub) {
      assistantProviderServer = await startAssistantProviderStubServer({
        onRequestBody: (body) => {
          observedAssistantProviderBodies.push(body);
        },
        resolveMessageText: resolveHostedAssistantReplyText,
      });
      assistantProviderBaseUrl =
        `${buildHostLoopbackStubBaseUrl(assistantProviderServer, "assistant provider stub")}/v1`;
      logDebug("started assistant provider stub server", {
        assistantProviderBaseUrl,
      });
    }
    oidcFixture = await startHostedLocalOidcFixture();
    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      process.env,
      useAssistantProviderStub ? assistantProviderBaseUrl : null,
      "Local hosted Linq e2e",
    );
    const webPort = await reserveLocalTcpPort();
    const workerPort = await reserveLocalTcpPort();
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...hostedAssistantDevEnv,
      ...resolveHostedLocalSmokeWebEnv(process.env),
      DATABASE_URL: localDatabaseUrl,
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: mergeRunnerEnvProfiles(
        process.env.HOSTED_EXECUTION_RUNNER_ENV_PROFILES,
        "linq",
      ),
      HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: requireOidcFixture().jwksUrl,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
      LINQ_API_BASE_URL: linqServerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      MURPH_DEV_CF_WRANGLER_LOG_LEVEL: "debug",
      MURPH_DEV_SKIP_RUNNER_BUNDLE: "1",
      MURPH_DEV_WEB_PORT: String(webPort),
      MURPH_DEV_WORKER_PORT: String(workerPort),
      NEXT_DIST_DIR_MODE: "smoke",
      VERCEL_OIDC_TOKEN: requireOidcFixture().token,
    };
    localHarness = await startHostedLocalDevHarness({
      env: runtimeEnv,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-first-contact-",
      statusHeaders: (nextUserId: string) => ({
        [HOSTED_EXECUTION_USER_ID_HEADER]: nextUserId,
      }),
      statusPath: (nextUserId: string) => `/internal/users/${encodeURIComponent(nextUserId)}/status`,
      streamLogs: streamDevLogs,
    });
    workerBaseUrl = localHarness.workerBaseUrl;
    workerPersistDir = localHarness.persistDir;
    logDebug("cloudflare worker healthy", {
      workerBaseUrl,
      workerPersistDir,
    });
  }, 300_000);

  afterAll(async () => {
    logDebug("tearing down hosted local Linq e2e");
    await localHarness?.stop();
    localHarness = null;
    await oidcFixture?.stop();
    oidcFixture = null;

    await stopHttpStubServer(linqServer);
    await stopHttpStubServer(assistantProviderServer);
  });

  it("sends the first-contact Linq welcome through the live local worker", async () => {
    await seedActiveHostedLinqMember(userId);
    logDebug("dispatching activation", { userId });
    await dispatchHostedEvent(buildActivationDispatch(userId), userId);

    const finalStatus = await requireHarness().waitForHostedCompletion(userId);
    logDebug("activation completed", { userId, finalStatus });
    expect(finalStatus.bundleRef).not.toBeNull();
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);

    const sendRequest = await waitForLinqSend({
      expectedPath: expectedLinqCreateChatPath,
      matchRequest: createLinqCreateChatRequestMatcher(userId),
      userId,
    });
    expect(requireObservedLinqChatId(userId)).toEqual(expect.any(String));
    expect(sendRequest.method).toBe("POST");
    expect(sendRequest.url).toBe(expectedLinqCreateChatPath);
    expect(JSON.parse(sendRequest.body)).toMatchObject({
      from: buildLinqHomePhoneNumber(userId),
      to: [buildLinqRecipientPhoneNumber(userId)],
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
    await seedActiveHostedLinqMember(directReplyUserId);
    logDebug("dispatching direct-reply activation", { userId: directReplyUserId });
    await dispatchHostedEvent(buildActivationDispatch(directReplyUserId), directReplyUserId);

    await requireHarness().waitForHostedCompletion(directReplyUserId);
    logDebug("direct-reply activation completed", { userId: directReplyUserId });
    await waitForLinqSend({
      expectedPath: expectedLinqCreateChatPath,
      matchRequest: createLinqCreateChatRequestMatcher(directReplyUserId),
      userId: directReplyUserId,
    });

    const materializedChatId = requireObservedLinqChatId(directReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = countObservedLinqSends(expectedDirectReplyChatPath);
    logDebug("dispatching later inbound Linq message", {
      baselineSendCount: outboundCountBeforeReply,
      userId: directReplyUserId,
    });
    const inboundWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: `linq.message.received:local:${directReplyUserId}:evt_direct_reply`,
      linqEvent: buildInboundLinqEvent(directReplyUserId, materializedChatId),
      linqMessageId: `msg_local_${directReplyUserId}`,
      occurredAt: new Date().toISOString(),
      phoneLookupKey: requireLinqPhoneLookupKey(directReplyUserId),
      userId: directReplyUserId,
    });
    await dispatchHostedEvent(inboundWake, directReplyUserId);

    await requireHarness().waitForHostedCompletion(directReplyUserId);
    logDebug("later inbound Linq message completed", { userId: directReplyUserId });
    const replySend = await waitForAdditionalLinqSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedDirectReplyChatPath,
      userId: directReplyUserId,
    });
    expect(replySend.method).toBe("POST");
  }, 300_000);

  it("keeps Linq context when two replies arrive before hosted completion catches up", async () => {
    await seedActiveHostedLinqMember(fastReplyUserId);
    logDebug("dispatching fast-reply activation", { userId: fastReplyUserId });
    await dispatchHostedEvent(buildActivationDispatch(fastReplyUserId), fastReplyUserId);

    const createChatRequest = await waitForLinqSend({
      expectedPath: expectedLinqCreateChatPath,
      matchRequest: createLinqCreateChatRequestMatcher(fastReplyUserId),
      userId: fastReplyUserId,
    });
    expect(createChatRequest.method).toBe("POST");

    const materializedChatId = requireObservedLinqChatId(fastReplyUserId);
    const expectedDirectReplyChatPath =
      `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = countObservedLinqSends(expectedDirectReplyChatPath);
    logDebug("dispatching immediate inbound Linq messages", {
      baselineSendCount: outboundCountBeforeReply,
      chatId: materializedChatId,
      userId: fastReplyUserId,
    });
    const firstInboundWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: `linq.message.received:local:${fastReplyUserId}:evt_fast_reply_name`,
      linqEvent: buildInboundLinqEvent(fastReplyUserId, materializedChatId, {
        messageId: `msg_fast_name_${fastReplyUserId}`,
        text: "U can call me Rocket Man",
      }),
      linqMessageId: `msg_fast_name_${fastReplyUserId}`,
      occurredAt: new Date().toISOString(),
      phoneLookupKey: requireLinqPhoneLookupKey(fastReplyUserId),
      userId: fastReplyUserId,
    });
    await dispatchHostedEvent(firstInboundWake, fastReplyUserId);

    const secondInboundWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: `linq.message.received:local:${fastReplyUserId}:evt_fast_reply_goals`,
      linqEvent: buildInboundLinqEvent(fastReplyUserId, materializedChatId, {
        messageId: `msg_fast_goals_${fastReplyUserId}`,
        text: "I want to build more strength, improve endurance, and get fitter overall.",
      }),
      linqMessageId: `msg_fast_goals_${fastReplyUserId}`,
      occurredAt: new Date().toISOString(),
      phoneLookupKey: requireLinqPhoneLookupKey(fastReplyUserId),
      userId: fastReplyUserId,
    });
    await dispatchHostedEvent(secondInboundWake, fastReplyUserId);

    const statusBeforeWait = await requireHarness().readUserStatus(fastReplyUserId);
    await requireHarness().waitForHostedCompletion(fastReplyUserId);
    const statusAfterWait = await requireHarness().readUserStatus(fastReplyUserId);
    logDebug("immediate inbound Linq messages completed", { userId: fastReplyUserId });

    const replySends = await waitForMatchingLinqSendCount({
      expectedCount: outboundCountBeforeReply + 2,
      expectedPath: expectedDirectReplyChatPath,
      userId: fastReplyUserId,
    });
    const createChatRequests = observedLinqRequests.filter((request) =>
      isMatchingObservedLinqSend(
        request,
        expectedLinqCreateChatPath,
        createLinqCreateChatRequestMatcher(fastReplyUserId),
      )
    );
    if (createChatRequests.length !== 1) {
      throw new Error(
        `Expected exactly one Linq chat materialization for ${fastReplyUserId}, saw ${
          createChatRequests.length
        }: ${JSON.stringify(
          {
            createChatRequests: createChatRequests.map((request) => ({
              text: readObservedLinqMessageText(request),
              url: request.url,
            })),
            observedAssistantProviderBodies,
            statusAfterWait,
            statusBeforeWait,
          },
        )}`,
      );
    }

    const newReplySends = replySends.slice(outboundCountBeforeReply);
    const firstReplyText = readObservedLinqMessageText(newReplySends[0]!);
    const secondReplyText = readObservedLinqMessageText(newReplySends[1]!);
    if (secondReplyText !== "Got you — stronger, fitter, faster, and more endurance.") {
      throw new Error(
        `Unexpected second Linq reply: ${JSON.stringify({
          firstReplyText,
          secondReplyText,
          observedAssistantProviderBodies,
        })}`,
      );
    }
    expect(firstReplyText).toBe("Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?");
    expect(secondReplyText).toBe(
      "Got you — stronger, fitter, faster, and more endurance.",
    );
    expect(secondReplyText).not.toContain("What should I call you");
    expect(secondReplyText).not.toContain("Hey, I'm Murph");
    expect(observedAssistantProviderBodies).toHaveLength(3);
    expect(observedAssistantProviderBodies.at(-1)).toContain("Rocket Man");
    expect(observedAssistantProviderBodies.at(-1)).toContain("build more strength");
  }, 300_000);

  async function dispatchHostedEvent(wake: HostedExecutionWake, nextUserId: string) {
    logDebug("append hosted wake and wake worker", {
      eventId:
        typeof wake === "object" && wake !== null && "eventId" in wake
          ? (wake as { eventId?: unknown }).eventId
          : null,
      userId: nextUserId,
    });
    const { append, wakeStatus } = await appendHostedWakeAndWakeWorker({
      wake,
      harness: requireHarness(),
      userId: nextUserId,
    });
    logDebug("hosted wake enqueued", {
      duplicate: append.duplicate,
      pendingEventCount: wakeStatus.pendingEventCount,
      userId: nextUserId,
    });
  }

async function waitForLinqSend(input: {
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    userId: string;
  }): Promise<ObservedLinqRequest> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 30_000) {
      const sendRequest = observedLinqRequests.find((request) =>
        isMatchingObservedLinqSend(request, input.expectedPath, input.matchRequest)
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
          observedSendCount: countObservedLinqSends(
            input.expectedPath,
            input.matchRequest,
          ),
          userId: input.userId,
        });
        nextProgressLogAt = Date.now() + 5_000;
      }

      await sleep(250);
    }

    const status = await requireHarness().readUserStatus(input.userId);
    throw new Error([
      `Timed out waiting for a Linq send for ${input.userId}.`,
      `observed requests: ${JSON.stringify(observedLinqRequests)}`,
      `hosted status: ${JSON.stringify(status)}`,
      `stdout tail: ${requireHarness().stdoutTail()}`,
      `stderr tail: ${requireHarness().stderrTail()}`,
    ].join("\n"));
  }

async function waitForAdditionalLinqSend(input: {
    baselineCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    userId: string;
  }): Promise<ObservedLinqRequest> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 60_000) {
      const matchingRequests = observedLinqRequests.filter((request) =>
        isMatchingObservedLinqSend(request, input.expectedPath, input.matchRequest)
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

    const status = await requireHarness().readUserStatus(input.userId);
    throw new Error([
      `Timed out waiting for an additional Linq send for ${input.userId}.`,
      `observed requests: ${JSON.stringify(observedLinqRequests)}`,
      `assistant provider bodies: ${JSON.stringify(observedAssistantProviderBodies)}`,
      `hosted status: ${JSON.stringify(status)}`,
      `stdout tail: ${requireHarness().stdoutTail()}`,
      `stderr tail: ${requireHarness().stderrTail()}`,
    ].join("\n"));
  }

async function waitForMatchingLinqSendCount(input: {
    expectedCount: number;
    expectedPath: string;
    matchRequest?: ObservedLinqRequestMatcher;
    userId: string;
  }): Promise<ObservedLinqRequest[]> {
    const startedAt = Date.now();
    let nextProgressLogAt = startedAt;

    while ((Date.now() - startedAt) < 60_000) {
      const matchingRequests = observedLinqRequests.filter((request) =>
        isMatchingObservedLinqSend(request, input.expectedPath, input.matchRequest)
      );

      if (matchingRequests.length >= input.expectedCount) {
        logDebug("observed expected Linq send count", {
          elapsedMs: Date.now() - startedAt,
          expectedCount: input.expectedCount,
          expectedPath: input.expectedPath,
          userId: input.userId,
        });
        return matchingRequests;
      }

      if (Date.now() >= nextProgressLogAt) {
        logDebug("waiting for expected Linq send count", {
          elapsedMs: Date.now() - startedAt,
          expectedCount: input.expectedCount,
          expectedPath: input.expectedPath,
          matchingRequestCount: matchingRequests.length,
          userId: input.userId,
        });
        nextProgressLogAt = Date.now() + 5_000;
      }

      await sleep(250);
    }

    const status = await requireHarness().readUserStatus(input.userId);
    throw new Error([
      `Timed out waiting for ${input.expectedCount} Linq sends for ${input.userId}.`,
      `observed requests: ${JSON.stringify(observedLinqRequests)}`,
      `assistant provider bodies: ${JSON.stringify(observedAssistantProviderBodies)}`,
      `hosted status: ${JSON.stringify(status)}`,
      `stdout tail: ${requireHarness().stdoutTail()}`,
      `stderr tail: ${requireHarness().stderrTail()}`,
    ].join("\n"));
  }
});

function requireHarness(): HostedLocalDevHarness {
  if (!localHarness) {
    throw new Error("Hosted local harness was not initialized.");
  }

  return localHarness;
}

function requireOidcFixture(): HostedLocalOidcFixture {
  if (!oidcFixture) {
    throw new Error("Hosted local OIDC fixture was not initialized.");
  }

  return oidcFixture;
}

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

async function seedActiveHostedLinqMember(nextUserId: string): Promise<void> {
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "--tsconfig",
      "tsconfig.base.json",
      "apps/web/scripts/seed-hosted-active-linq-member.ts",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: localDatabaseUrl,
        MURPH_E2E_HOME_PHONE: buildLinqHomePhoneNumber(nextUserId),
        MURPH_E2E_MEMBER_ID: nextUserId,
        MURPH_E2E_MEMBER_PHONE: buildLinqRecipientPhoneNumber(nextUserId),
        NODE_ENV: "test",
        VITEST: "1",
      },
      stdio: "pipe",
    },
  );
}

function buildActivationDispatch(nextUserId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${nextUserId}:evt_linq_first_contact`,
    firstContact: {
      channel: "linq",
      fromPhoneNumber: buildLinqHomePhoneNumber(nextUserId),
      identityId: requireLinqPhoneLookupKey(nextUserId),
      kind: "linq-materialize-home-thread",
      toPhoneNumber: buildLinqRecipientPhoneNumber(nextUserId),
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

function buildInboundLinqEvent(
  nextUserId: string,
  chatId: string,
  input: {
    messageId?: string;
    text?: string;
  } = {},
) {
  return {
    api_version: "v3",
    created_at: new Date().toISOString(),
    data: {
      chat: {
        id: chatId,
        is_group: false,
        owner_handle: {
          handle: buildLinqHomePhoneNumber(nextUserId),
          id: `handle_owner_${nextUserId}`,
          is_me: true,
          service: "SMS",
        },
      },
      chat_id: chatId,
      direction: "inbound",
      from: buildLinqRecipientPhoneNumber(nextUserId),
      from_handle: {
        handle: buildLinqRecipientPhoneNumber(nextUserId),
        id: `handle_sender_${nextUserId}`,
        service: "SMS",
      },
      is_from_me: false,
      message: {
        id: input.messageId ?? `msg_local_${nextUserId}`,
        parts: [
          {
            type: "text",
            value: input.text ?? "hello mate",
          },
        ],
      },
      recipient_handle: {
        handle: buildLinqHomePhoneNumber(nextUserId),
        id: `handle_owner_${nextUserId}`,
        is_me: true,
        service: "SMS",
      },
      recipient_phone: buildLinqHomePhoneNumber(nextUserId),
      received_at: new Date().toISOString(),
      sender_handle: {
        handle: buildLinqRecipientPhoneNumber(nextUserId),
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

function requireLinqPhoneLookupKey(nextUserId: string): string {
  const lookupKey = createHostedPhoneLookupKey(buildLinqRecipientPhoneNumber(nextUserId));
  if (!lookupKey) {
    throw new Error(`Expected Linq phone lookup key for ${nextUserId}.`);
  }

  return lookupKey;
}

function countObservedLinqSends(
  expectedPath: string,
  matchRequest?: ObservedLinqRequestMatcher,
): number {
  return observedLinqRequests.filter((request) =>
    isMatchingObservedLinqSend(request, expectedPath, matchRequest)
  ).length;
}

function isMatchingObservedLinqSend(
  request: ObservedLinqRequest,
  expectedPath: string,
  matchRequest?: ObservedLinqRequestMatcher,
): boolean {
  return (
    request.method === "POST"
    && request.url === expectedPath
    && (matchRequest ? matchRequest(request) : true)
  );
}

function createLinqCreateChatRequestMatcher(nextUserId: string): ObservedLinqRequestMatcher {
  const expectedFrom = buildLinqHomePhoneNumber(nextUserId);
  const expectedTo = buildLinqRecipientPhoneNumber(nextUserId);

  return (request) => {
    const parsed = parseObservedLinqJson(request.body);
    if (!parsed || typeof parsed !== "object") {
      return false;
    }

    const from = "from" in parsed ? parsed.from : null;
    const to = "to" in parsed ? parsed.to : null;
    return (
      from === expectedFrom
      && Array.isArray(to)
      && to[0] === expectedTo
    );
  };
}

function parseObservedLinqJson(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readObservedLinqMessageText(request: ObservedLinqRequest): string | null {
  const parsed = parseObservedLinqJson(request.body);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const message = "message" in parsed ? parsed.message : null;
  if (!message || typeof message !== "object") {
    return null;
  }

  const parts = "parts" in message ? message.parts : null;
  if (!Array.isArray(parts)) {
    return null;
  }

  const firstPart = parts[0];
  if (!firstPart || typeof firstPart !== "object") {
    return null;
  }

  const value = "value" in firstPart ? firstPart.value : null;
  return typeof value === "string" ? value : null;
}

async function startLinqStubServer(): Promise<ReturnType<typeof createServer>> {
  let nextObservedChatSequence = 0;

  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    observedLinqRequests.push({
      body,
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });

    if (request.method === "POST" && request.url === "/chats") {
      const parsedBody = JSON.parse(body) as {
        from?: string;
        message?: { parts?: Array<{ type?: string; value?: string }> };
        to?: string[];
      };
      const recipient = parsedBody.to?.[0] ?? "unknown";
      const chatId = `chat_local_${++nextObservedChatSequence}`;
      observedLinqChatIdsByRecipient.set(recipient, chatId);
      writeJsonResponse(response, 200, {
        chat: {
          id: chatId,
          message: {
            id: `linq_msg_${Date.now()}`,
          },
        },
      });
      return;
    }

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

function requireObservedLinqChatId(nextUserId: string): string {
  const recipientPhoneNumber = buildLinqRecipientPhoneNumber(nextUserId);
  const chatId = observedLinqChatIdsByRecipient.get(recipientPhoneNumber);
  if (!chatId) {
    throw new Error(`Expected a materialized Linq chat id for ${nextUserId}.`);
  }

  return chatId;
}

function buildLinqHomePhoneNumber(nextUserId: string): string {
  return buildStableTestPhoneNumber(nextUserId, "598");
}

function buildLinqRecipientPhoneNumber(nextUserId: string): string {
  return buildStableTestPhoneNumber(nextUserId, "501");
}

function buildStableTestPhoneNumber(nextUserId: string, prefix: string): string {
  const suffix = buildStableTestNumericSuffix(nextUserId, 7);
  return `+1555${prefix}${suffix}`;
}

function buildStableTestNumericSuffix(value: string, length: number): string {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_000_000;
  }

  return String(hash).padStart(length, "0").slice(-length);
}

function mergeRunnerEnvProfiles(
  existingProfiles: string | undefined,
  requiredProfile: string,
): string {
  const profiles = new Set(
    String(existingProfiles ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  profiles.add(requiredProfile);
  return Array.from(profiles).join(",");
}

function resolveHostedAssistantReplyText(body: string): string {
  if (body.includes("Rocket Man") && body.includes("build more strength")) {
    if (body.includes("I’ll call you Rocket Man") || body.includes("I'll call you Rocket Man")) {
      return "Got you — stronger, fitter, faster, and more endurance.";
    }

    return "What should I call you? And out of those, which ones matter most to you right now?";
  }

  if (body.includes("Rocket Man")) {
    return "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?";
  }

  return "Got it - I saw your message and I'm here.";
}
