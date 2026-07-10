import { createHmac } from "node:crypto";

import {
  readHostedLinqFirstContactMemberState,
  seedHostedLinqFirstContactFallbackLines,
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
const unknownContactFixtureId = `unknown_linq_first_contact_${runId}`;
const fallbackLineFixtureId = `fallback_linq_first_contact_${runId}`;
const unknownContactPhone = buildLinqRecipientPhoneNumber(unknownContactFixtureId);
const incomingLinePhone = buildLinqHomePhoneNumber(unknownContactFixtureId);
const fallbackLinePhone = buildLinqHomePhoneNumber(fallbackLineFixtureId);
const incomingChatId = `chat_unknown_linq_first_contact_${runId}`;
const linqApiToken = "linq-local-unknown-first-contact-token";
const linqWebhookSecret = "linq-local-unknown-first-contact-webhook-secret";
const inboundText = "Hey Murph, can you help me get started?";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local Linq unknown first-contact fallback e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_MODE: "off",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          unknownContactPhone,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-unknown-first-contact-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted Linq unknown first-contact fallback e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("assigns one unknown contact to the healthy line and creates the signup chat there", async () => {
    expect(fallbackLinePhone).not.toBe(incomingLinePhone);
    await seedHostedLinqFirstContactFallbackLines({
      environment: requireScenario().runtimeEnv,
      fallbackPhone: fallbackLinePhone,
      incomingPhone: incomingLinePhone,
    });

    const createChatPath = requireLinqStub().createChatPath;
    const totalCreateChatBaseline = requireLinqStub().countObservedSends(createChatPath);
    const fallbackCreateChatBaseline = countFallbackSignupCreateChats();
    const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      unknownContactFixtureId,
      incomingChatId,
      {
        eventId: `evt_unknown_first_contact_${runId}`,
        isGroup: false,
        messageId: `msg_unknown_first_contact_${runId}`,
        service: "iMessage",
        text: inboundText,
      },
    ));

    expect(response.status).toBe(202);
    const responseBody: unknown = await response.json();
    expect(responseBody).toMatchObject({
      inviteCode: expect.any(String),
      joinUrl: expect.any(String),
      ok: true,
      reason: "sent-signup-link",
    });
    if (!isRecord(responseBody) || typeof responseBody.joinUrl !== "string") {
      throw new Error("Expected first-contact admission to return a signup join URL.");
    }

    const memberState = await readHostedLinqFirstContactMemberState({
      environment: requireScenario().runtimeEnv,
      memberPhone: unknownContactPhone,
    });
    expect(memberState).toMatchObject({
      homeChatId: null,
      homeRecipientPhone: fallbackLinePhone,
      memberCount: 1,
      memberId: expect.stringMatching(/^member_/u),
      pendingChatId: null,
    });
    if (!memberState.memberId) {
      throw new Error("Expected first-contact admission to persist one member.");
    }

    const matchingCreateChats = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: fallbackCreateChatBaseline + 1,
      expectedPath: createChatPath,
      matchRequest: isFallbackSignupCreateChat,
      scenario: requireScenario(),
      userId: memberState.memberId,
    });
    const signupCreateChat = matchingCreateChats.at(-1);
    if (!signupCreateChat) {
      throw new Error("Expected the fallback line signup chat to be observed.");
    }
    expect(signupCreateChat.authorizationStatus).toBe("expected");
    expect(signupCreateChat.body).toContain(responseBody.joinUrl);
    expect(requireLinqStub().countObservedSends(createChatPath)).toBe(
      totalCreateChatBaseline + 1,
    );

  }, 300_000);
});

function countFallbackSignupCreateChats(): number {
  return requireLinqStub().countObservedRequests({
    expectedMethod: "POST",
    expectedPath: requireLinqStub().createChatPath,
    matchRequest: isFallbackSignupCreateChat,
  });
}

function isFallbackSignupCreateChat(request: ObservedLinqRequest): boolean {
  const body = readJson(request.body);
  return isRecord(body)
    && body.from === fallbackLinePhone
    && Array.isArray(body.to)
    && body.to.length === 1
    && body.to[0] === unknownContactPhone;
}

function readJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return await fetch(
    `${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`,
    {
      body: rawBody,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-webhook-signature": `sha256=${signature}`,
        "x-webhook-timestamp": timestamp,
      },
      method: "POST",
    },
  );
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
