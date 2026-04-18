import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  startHostedLocalDevHarness,
  type HostedLocalDevHarness,
} from "./helpers/hosted-local-dev-harness.js";
import {
  appendHostedWakeAndWakeWorker,
  wakeHostedWorkerForLatestPendingWake,
} from "./helpers/hosted-local-dispatch.js";
import {
  startHostedLocalOidcFixture,
  type HostedLocalOidcFixture,
} from "./helpers/hosted-local-oidc-support.js";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
} from "./hosted-execution-fixtures.js";
import {
  DEFAULT_DATABASE_URL,
  repoRoot,
} from "../../../scripts/dev-hosted-local/constants.ts";
import { readOptionalSimpleEnvFile } from "../../../scripts/dev-hosted-local/environment.ts";
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

interface ObservedLinqRequest {
  body: string;
  method: string;
  url: string;
}

type ObservedLinqRequestMatcher = (request: ObservedLinqRequest) => boolean;

const webhookUserId = `member_local_linq_webhook_${Date.now()}`;
const observedLinqRequests: ObservedLinqRequest[] = [];
const observedLinqChatIdsByRecipient = new Map<string, string>();
const observedAssistantProviderBodies: string[] = [];
const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const debugE2E = process.env.MURPH_E2E_DEBUG_PROGRESS === "1";
const useAssistantProviderStub = shouldUseAssistantProviderStub(process.env);
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
const expectedLinqCreateChatPath = "/chats";
const linqWebhookSecret = "linq-local-webhook-secret";

let linqServer: ReturnType<typeof createServer> | null = null;
let linqServerBaseUrl = "";
let assistantProviderServer: ReturnType<typeof createServer> | null = null;
let assistantProviderBaseUrl = "";
let localHarness: HostedLocalDevHarness | null = null;
let localSeedEnv: NodeJS.ProcessEnv = process.env;
let oidcFixture: HostedLocalOidcFixture | null = null;

describe("hosted local Linq webhook e2e", () => {
  beforeAll(async () => {
    observedLinqRequests.length = 0;
    observedLinqChatIdsByRecipient.clear();
    observedAssistantProviderBodies.length = 0;
    const repoEnv = await readOptionalSimpleEnvFile(path.join(repoRoot, ".env"));
    const webEnv = await readOptionalSimpleEnvFile(path.join(repoRoot, "apps/web/.env"));
    const webLocalEnv = await readOptionalSimpleEnvFile(path.join(repoRoot, "apps/web/.env.local"));
    localSeedEnv = {
      ...repoEnv,
      ...webEnv,
      ...webLocalEnv,
      ...process.env,
    };

    linqServer = await startLinqStubServer();
    linqServerBaseUrl = buildHostLoopbackStubBaseUrl(linqServer, "Linq stub");

    if (useAssistantProviderStub) {
      assistantProviderServer = await startAssistantProviderStubServer({
        onRequestBody: (body) => {
          observedAssistantProviderBodies.push(body);
        },
        resolveMessageText: resolveHostedAssistantReplyText,
      });
      assistantProviderBaseUrl =
        `${buildHostLoopbackStubBaseUrl(assistantProviderServer, "assistant provider stub")}/v1`;
    }

    oidcFixture = await startHostedLocalOidcFixture();
    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      process.env,
      useAssistantProviderStub ? assistantProviderBaseUrl : null,
      "Local hosted Linq webhook e2e",
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
      LINQ_API_BASE_URL: linqServerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
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
      persistDirPrefix: "murph-hosted-local-linq-webhook-",
      statusHeaders: (userId: string) => ({
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      }),
      statusPath: (userId: string) => `/internal/users/${encodeURIComponent(userId)}/status`,
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await localHarness?.stop();
    localHarness = null;
    await oidcFixture?.stop();
    oidcFixture = null;

    await stopHttpStubServer(linqServer);
    await stopHttpStubServer(assistantProviderServer);
  });

  it("routes a signed Linq webhook through apps/web and delivers the follow-up reply", async () => {
    await seedActiveHostedLinqMember(webhookUserId);

    await dispatchHostedEvent(buildActivationDispatch(webhookUserId), webhookUserId);

    await requireHarness().waitForHostedCompletion(webhookUserId);
    await waitForLinqSend({
      expectedPath: expectedLinqCreateChatPath,
      matchRequest: createLinqCreateChatRequestMatcher(webhookUserId),
      userId: webhookUserId,
    });

    const materializedChatId = requireObservedLinqChatId(webhookUserId);
    const expectedReplyChatPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = countObservedLinqSends(expectedReplyChatPath);
    const webhookEvent = buildInboundLinqEvent(webhookUserId, materializedChatId, {
      messageId: `msg_webhook_${webhookUserId}`,
      text: "U can call me Rocket Man",
      eventId: `evt_webhook_${webhookUserId}`,
    });

    const webhookResponse = await postSignedLinqWebhook(webhookEvent);
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });

    await wakeHostedWorkerForLatestPendingWake({
      harness: requireHarness(),
      userId: webhookUserId,
    });
    await requireHarness().waitForHostedCompletion(webhookUserId);

    const replySend = await waitForAdditionalLinqSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedReplyChatPath,
      userId: webhookUserId,
    });
    expect(readObservedLinqMessageText(replySend)).toBe(
      "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?",
    );
    expect(observedAssistantProviderBodies.at(-1)).toContain("Rocket Man");
  }, 300_000);

  it("keeps Linq context when two signed webhooks arrive before hosted completion catches up", async () => {
    const fastWebhookUserId = `${webhookUserId}_rapid`;
    await seedActiveHostedLinqMember(fastWebhookUserId);

    await dispatchHostedEvent(buildActivationDispatch(fastWebhookUserId), fastWebhookUserId);

    await requireHarness().waitForHostedCompletion(fastWebhookUserId);
    await waitForLinqSend({
      expectedPath: expectedLinqCreateChatPath,
      matchRequest: createLinqCreateChatRequestMatcher(fastWebhookUserId),
      userId: fastWebhookUserId,
    });

    const materializedChatId = requireObservedLinqChatId(fastWebhookUserId);
    const expectedReplyChatPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = countObservedLinqSends(expectedReplyChatPath);

    const firstWebhook = buildInboundLinqEvent(fastWebhookUserId, materializedChatId, {
      eventId: `evt_webhook_name_${fastWebhookUserId}`,
      messageId: `msg_webhook_name_${fastWebhookUserId}`,
      text: "U can call me Rocket Man",
    });
    const secondWebhook = buildInboundLinqEvent(fastWebhookUserId, materializedChatId, {
      eventId: `evt_webhook_goals_${fastWebhookUserId}`,
      messageId: `msg_webhook_goals_${fastWebhookUserId}`,
      text: "I want to build more strength, improve endurance, and get fitter overall.",
    });

    const firstResponse = await postSignedLinqWebhook(firstWebhook);
    const secondResponse = await postSignedLinqWebhook(secondWebhook);

    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });
    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });

    await wakeHostedWorkerForLatestPendingWake({
      harness: requireHarness(),
      userId: fastWebhookUserId,
    });
    await requireHarness().waitForHostedCompletion(fastWebhookUserId);

    const replySends = await waitForMatchingLinqSendCount({
      expectedCount: outboundCountBeforeReply + 2,
      expectedPath: expectedReplyChatPath,
      userId: fastWebhookUserId,
    });
    const newReplySends = replySends.slice(outboundCountBeforeReply);
    const firstReplyText = readObservedLinqMessageText(newReplySends[0]!);
    const secondReplyText = readObservedLinqMessageText(newReplySends[1]!);

    expect(firstReplyText).toBe(
      "Got it — I’ll call you Rocket Man.\n\nWhat are your health goals right now?",
    );
    expect(secondReplyText).toBe(
      "Got you — stronger, fitter, faster, and more endurance.",
    );
    expect(secondReplyText).not.toContain("What should I call you");
    expect(secondReplyText).not.toContain("Hey, I'm Murph");
    expect(observedAssistantProviderBodies.at(-1)).toContain("Rocket Man");
    expect(observedAssistantProviderBodies.at(-1)).toContain("build more strength");
  }, 300_000);
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
  console.error(`[hosted-local-linq-webhook-e2e] ${message}${payload}`);
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
        ...localSeedEnv,
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
    eventId?: string;
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
    event_id: input.eventId ?? `evt_linq_inbound_${nextUserId}`,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  };
}

function requireLinqPhoneLookupKey(nextUserId: string): string {
  const lookupKey = createHostedPhoneLookupKey(buildLinqRecipientPhoneNumber(nextUserId));
  if (!lookupKey) {
    throw new Error(`Expected Linq phone lookup key for ${nextUserId}.`);
  }

  return lookupKey;
}

async function dispatchHostedEvent(wake: HostedExecutionWake, nextUserId: string) {
  await appendHostedWakeAndWakeWorker({
    wake,
    harness: requireHarness(),
    userId: nextUserId,
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(linqWebhookSecret, rawBody, timestamp);

  return await fetch(`${requireHarness().webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    },
    body: rawBody,
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}

async function waitForLinqSend(input: {
  expectedPath: string;
  matchRequest?: ObservedLinqRequestMatcher;
  userId: string;
}): Promise<ObservedLinqRequest> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < 30_000) {
    const sendRequest = observedLinqRequests.find((request) =>
      isMatchingObservedLinqSend(request, input.expectedPath, input.matchRequest)
    );

    if (sendRequest) {
      return sendRequest;
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
    `hosted status: ${JSON.stringify(status)}`,
    `stdout tail: ${requireHarness().stdoutTail()}`,
    `stderr tail: ${requireHarness().stderrTail()}`,
  ].join("\n"));
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
