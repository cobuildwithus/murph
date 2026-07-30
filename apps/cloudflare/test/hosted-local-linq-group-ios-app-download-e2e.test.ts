import { createHmac } from "node:crypto";

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
} from "./helpers/hosted-local-linq-support.js";

const MURPH_IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/murph-ai/id6786145859";
const runId = Date.now();
const ownerMemberId = `member_local_linq_group_ios_app_${runId}`;
const groupChatId = `chat_local_linq_group_ios_app_${runId}`;
const ownerPhone = buildLinqRecipientPhoneNumber(ownerMemberId);
const homePhone = buildLinqHomePhoneNumber(ownerMemberId);
const linqApiToken = "linq-local-group-ios-app-token";
const linqWebhookSecret = "linq-local-group-ios-app-webhook-secret";
const groupReplyPath = `/chats/${encodeURIComponent(groupChatId)}/messages`;
const safeLiveAssistantModel =
  process.env.MURPH_HOSTED_LOCAL_LIVE_E2E_MODEL?.trim() || "gpt-5.6-terra";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride =
  process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
const describeLiveProvider = isLiveProviderEnvironment() ? describe : describe.skip;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describeLiveProvider("hosted local Linq group iOS app download e2e", () => {
  beforeAll(async () => {
    requireLiveProviderEnvironment();
    linqStub = await startHostedLocalLinqStub({
      canonicalChats: [
        {
          chatId: groupChatId,
          handles: [
            {
              handle: homePhone,
              isMe: true,
              status: "active",
            },
            {
              handle: ownerPhone,
              isMe: false,
              status: "active",
            },
          ],
          isGroup: true,
        },
      ],
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: safeLiveAssistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_ASSISTANT_REASONING_EFFORT: "low",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: ownerPhone,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      assistantProviderMode: "live",
      assistantProviderStubModelId: safeLiveAssistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-linq-group-ios-app-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted Linq group iOS app download e2e",
      streamLogs: streamDevLogs,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("delivers the canonical public listing without treating group setup as authorized", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: ownerMemberId,
      memberPhone: ownerPhone,
    });

    const downloadReply = await sendGroupPromptAndReadOnlyReply({
      eventId: `evt_group_ios_app_download_${runId}`,
      messageId: `msg_group_ios_app_download_${runId}`,
      text: "Where can I download the Murph iPhone app?",
    });
    assertCanonicalIosAppReply(downloadReply);

    const mixedReply = await sendGroupPromptAndReadOnlyReply({
      eventId: `evt_group_ios_app_mixed_${runId}`,
      messageId: `msg_group_ios_app_mixed_${runId}`,
      text: "Send me the Murph app download link and configure Apple Health for this group.",
    });
    assertCanonicalIosAppReply(mixedReply);
    expect(mixedReply).not.toMatch(
      /\b(?:I(?:'ve| have)|we(?:'ve| have)|Murph has)\s+(?:configured|authorized|connected|linked|set up)\b/iu,
    );
    expect(mixedReply).not.toMatch(
      /\b(?:the room|this (?:group|room)|Apple Health)\s+(?:is|was|has been)\s+(?:configured|authorized|connected|linked|set up)\b/iu,
    );
  }, 900_000);
});

async function sendGroupPromptAndReadOnlyReply(input: {
  eventId: string;
  messageId: string;
  text: string;
}): Promise<string> {
  const outboundBaseline = requireLinqStub().countObservedSends(groupReplyPath);
  const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
    ownerMemberId,
    groupChatId,
    {
      eventId: input.eventId,
      isGroup: true,
      messageId: input.messageId,
      service: "iMessage",
      text: input.text,
    },
  ));
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({
    ignored: false,
    ok: true,
  });

  const sends = await requireLinqStub().waitForMatchingSendCount({
    expectedCount: outboundBaseline + 1,
    expectedPath: groupReplyPath,
    scenario: requireScenario(),
    userId: ownerMemberId,
  });
  await requireScenario().waitForHostedCompletion(ownerMemberId, {
    timeoutMs: 600_000,
  });
  expect(requireLinqStub().countObservedSends(groupReplyPath)).toBe(
    outboundBaseline + 1,
  );

  const reply = sends.at(-1);
  if (!reply) {
    throw new Error("Expected one delivered Linq group reply.");
  }
  const text = requireLinqStub().readObservedMessageText(reply);
  if (!text) {
    throw new Error("Expected the delivered Linq group reply to contain text.");
  }
  return text;
}

function assertCanonicalIosAppReply(text: string): void {
  const urlOccurrences = text.split(MURPH_IOS_APP_STORE_URL).length - 1;
  expect(urlOccurrences).toBe(1);
  const nonEmptyLines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  expect(nonEmptyLines.at(-1)).toBe(MURPH_IOS_APP_STORE_URL);
  expect(text.match(/https?:\/\/[^\s<>()\[\]]+/gu) ?? []).toEqual([
    MURPH_IOS_APP_STORE_URL,
  ]);
  expect(text).not.toContain(`[${MURPH_IOS_APP_STORE_URL}]`);
  expect(text).not.toContain(`<${MURPH_IOS_APP_STORE_URL}>`);
  expect(text).not.toMatch(/\butm_[a-z0-9_]*=/iu);
}

async function postSignedLinqWebhook(
  event: Record<string, unknown>,
): Promise<Response> {
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

function isLiveProviderEnvironment(): boolean {
  return (
    process.env.MURPH_E2E_ASSISTANT_PROVIDER_MODE === "live"
    && Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}

function requireLiveProviderEnvironment(): void {
  if (process.env.MURPH_E2E_ASSISTANT_PROVIDER_MODE !== "live") {
    throw new Error(
      "hosted-local linq-group-ios-app-download requires --profile e2e:live.",
    );
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "hosted-local linq-group-ios-app-download requires OPENAI_API_KEY.",
    );
  }
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
