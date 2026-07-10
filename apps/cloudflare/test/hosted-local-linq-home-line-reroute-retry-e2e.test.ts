import { createHmac } from "node:crypto";

import {
  listHostedLinqDeliveriesForTest,
  readHostedLinqFirstContactMemberState,
  type HostedLinqDeliveryForTest,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
  type ObservedLinqRequest,
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const memberId = `member_local_linq_home_reroute_${runId}`;
const authoritativeLineFixtureId = `linq_home_authority_${runId}`;
const memberPhone = buildLinqRecipientPhoneNumber(memberId);
const authoritativeHomePhone = buildLinqHomePhoneNumber(authoritativeLineFixtureId);
const incomingLinePhone = buildLinqHomePhoneNumber(memberId);
const authoritativeHomeChatId = `chat_local_linq_home_${runId}`;
const incomingChatId = `chat_local_linq_non_home_${runId}`;
const incomingMessageId = `msg_local_linq_non_home_${runId}`;
const incomingEventId = `evt_local_linq_non_home_${runId}`;
const redirectPath = `/chats/${encodeURIComponent(incomingChatId)}/messages`;
const authoritativeHomePath =
  `/chats/${encodeURIComponent(authoritativeHomeChatId)}/messages`;
const linqApiToken = "linq-local-home-reroute-token";
const linqWebhookSecret = "linq-local-home-reroute-webhook-secret";
const inboundText = "I reached a different Murph line. Where should I continue?";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local Linq home-line reroute retry e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: memberPhone,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-home-reroute-retry-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted Linq home-line reroute retry e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("retries a pre-accept redirect failure without rebinding or duplicating the accepted send", async () => {
    expect(authoritativeHomePhone).not.toBe(incomingLinePhone);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: authoritativeHomePhone,
      memberId,
      memberPhone,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: authoritativeHomeChatId,
      memberId,
      recipientPhone: authoritativeHomePhone,
    });

    await expect(readMemberState()).resolves.toEqual({
      homeChatId: authoritativeHomeChatId,
      homeRecipientPhone: authoritativeHomePhone,
      memberCount: 1,
      memberId,
      pendingChatId: null,
    });

    const signedWebhook = buildSignedLinqWebhook(buildHostedLinqInboundEvent(
      memberId,
      incomingChatId,
      {
        eventId: incomingEventId,
        isGroup: false,
        messageId: incomingMessageId,
        service: "iMessage",
        text: inboundText,
      },
    ));
    const redirectMatcher = isAuthoritativeHomeRedirect;
    const observedBaseline = requireLinqStub().countObservedSends(
      redirectPath,
      redirectMatcher,
    );
    const acceptedBaseline = requireLinqStub().countAcceptedSends(
      redirectPath,
      redirectMatcher,
    );
    const messageIdBaseline = requireLinqStub().listObservedMessageIds(incomingChatId).length;
    const homeSendBaseline = requireLinqStub().countAcceptedSends(authoritativeHomePath);

    requireLinqStub().armNextPreAcceptRetryableSendFailure({
      expectedPath: redirectPath,
      matchRequest: redirectMatcher,
    });

    const failedResponse = await postSignedLinqWebhook(signedWebhook);
    expect(failedResponse.status).toBe(502);
    await expect(failedResponse.json()).resolves.toMatchObject({
      error: {
        code: "LINQ_SEND_FAILED",
        retryable: true,
      },
    });

    expect(requireLinqStub().countObservedSends(redirectPath, redirectMatcher)).toBe(
      observedBaseline + 3,
    );
    expect(requireLinqStub().countAcceptedSends(redirectPath, redirectMatcher)).toBe(
      acceptedBaseline,
    );
    expect(requireLinqStub().listObservedMessageIds(incomingChatId)).toHaveLength(
      messageIdBaseline,
    );

    const retryResponse = await postSignedLinqWebhook(signedWebhook);
    expect(retryResponse.status).toBe(202);
    await expect(retryResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "redirected-to-home-line",
    });

    const allRedirectAttempts = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: observedBaseline + 4,
      expectedPath: redirectPath,
      matchRequest: redirectMatcher,
      scenario: requireScenario(),
      userId: memberId,
    });
    const redirectAttempts = allRedirectAttempts.slice(observedBaseline);
    const allAcceptedRedirects = await requireLinqStub().waitForMatchingAcceptedSendCount({
      expectedCount: acceptedBaseline + 1,
      expectedPath: redirectPath,
      matchRequest: redirectMatcher,
      scenario: requireScenario(),
      userId: memberId,
    });
    const acceptedRedirects = allAcceptedRedirects.slice(acceptedBaseline);

    expect(redirectAttempts).toHaveLength(4);
    expect(redirectAttempts.every((request) =>
      request.authorizationStatus === "expected"
    )).toBe(true);
    expect(acceptedRedirects).toHaveLength(1);
    expect(requireLinqStub().readObservedMessageText(acceptedRedirects[0]!)).toContain(
      authoritativeHomePhone,
    );
    expect(requireLinqStub().listObservedMessageIds(incomingChatId)).toHaveLength(
      messageIdBaseline + 1,
    );
    expect(requireLinqStub().countAcceptedSends(authoritativeHomePath)).toBe(
      homeSendBaseline,
    );

    const idempotencyKeys = redirectAttempts.map(readLinqMessageIdempotencyKey);
    expect(idempotencyKeys[0]).toMatch(/^linq-home-redirect:[0-9a-f]{32}$/u);
    expect(new Set(idempotencyKeys)).toEqual(new Set([idempotencyKeys[0]]));

    await expect(readMemberState()).resolves.toEqual({
      homeChatId: authoritativeHomeChatId,
      homeRecipientPhone: authoritativeHomePhone,
      memberCount: 1,
      memberId,
      pendingChatId: null,
    });
    await expect(waitForAcceptedRedirectDelivery()).resolves.toMatchObject({
      acceptedAt: expect.any(Date),
      failedAt: null,
      failureCode: null,
      idempotencyKey: expect.stringMatching(
        /^hbid:linq\.delivery-idempotency:s1:[0-9a-f]{64}$/u,
      ),
      sourceRef: expect.stringMatching(
        /^hbid:linq\.delivery-source-ref:s1:[0-9a-f]{64}$/u,
      ),
      status: "accepted",
      template: "conversation_home_redirect",
    });
  }, 300_000);
});

interface SignedLinqWebhook {
  rawBody: string;
  signature: string;
  timestamp: string;
}

function buildSignedLinqWebhook(event: Record<string, unknown>): SignedLinqWebhook {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return {
    rawBody,
    signature: `sha256=${signature}`,
    timestamp,
  };
}

async function postSignedLinqWebhook(input: SignedLinqWebhook): Promise<Response> {
  return await fetch(
    `${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`,
    {
      body: input.rawBody,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-webhook-signature": input.signature,
        "x-webhook-timestamp": input.timestamp,
      },
      method: "POST",
    },
  );
}

function isAuthoritativeHomeRedirect(request: ObservedLinqRequest): boolean {
  return requireLinqStub().readObservedMessageText(request)?.includes(
    authoritativeHomePhone,
  ) === true;
}

function readLinqMessageIdempotencyKey(request: ObservedLinqRequest): string | null {
  const body = readJsonRecord(request.body);
  const message = isRecord(body?.message) ? body.message : null;
  return typeof message?.idempotency_key === "string"
    ? message.idempotency_key
    : null;
}

async function readMemberState() {
  return await readHostedLinqFirstContactMemberState({
    environment: requireScenario().runtimeEnv,
    memberPhone,
  });
}

async function waitForAcceptedRedirectDelivery(): Promise<HostedLinqDeliveryForTest> {
  const deadline = Date.now() + 30_000;
  let latest: HostedLinqDeliveryForTest[] = [];

  while (Date.now() < deadline) {
    latest = await listHostedLinqDeliveriesForTest({
      environment: requireScenario().runtimeEnv,
      template: "conversation_home_redirect",
    });
    if (latest.length === 1 && latest[0]?.status === "accepted") {
      return latest[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out waiting for one accepted home-redirect delivery; observed states: ${
      JSON.stringify(latest.map((delivery) => delivery.status))
    }`,
  );
}

function readJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not initialized.");
  }

  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local full-stack scenario was not initialized.");
  }

  return scenario;
}
