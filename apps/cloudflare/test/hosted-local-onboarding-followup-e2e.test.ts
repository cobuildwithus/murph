import { createHmac } from "node:crypto";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import { readHostedLinqFirstContactMemberState } from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildAssistantProviderVaultCliCall,
  type HostedLocalAssistantProviderScriptedResponse,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildHostedLinqSignupWelcomeWake,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const userId = `member_local_linq_onboarding_followup_${Date.now()}`;
const linqWebhookSecret = "linq-local-onboarding-followup-secret";
const onboardingCompleteReplyText = "Setup is marked complete.";
const productionLikeAssistantModel = "gpt-5.6-terra";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

vi.mock("server-only", () => ({}));

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local onboarding follow-up e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 600_000);

  it("deterministically archives the signup follow-up when onboarding completes", async () => {
    const homePhone = buildLinqHomePhoneNumber(userId);
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    const activatedStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activatedStatus.lastErrorCode ?? null).toBeNull();

    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `member.activated:local:${userId}:evt_linq_onboarding_followup`,
        userId,
      }),
      userId,
    );
    const welcomeSendPromise = requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
      scenario: requireScenario(),
      userId,
    });
    const welcomeStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(welcomeStatus.lastErrorCode ?? null).toBeNull();
    await welcomeSendPromise;

    const materializedChatId = requireLinqStub().requireObservedChatId(userId);
    const memberStateBeforeInbound = await readHostedLinqFirstContactMemberState({
      environment: requireScenario().runtimeEnv,
      memberPhone,
    });
    expect(memberStateBeforeInbound).toMatchObject({
      homeChatId: materializedChatId,
      homeRecipientPhone: homePhone,
      memberCount: 1,
      memberId: userId,
      pendingChatId: null,
    });

    const followupPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const completionBaseline = requireLinqStub().countObservedSends(followupPath);
    requireScenario().queueAssistantResponses(
      buildHostedAssistantCompleteOnboardingResponses({
        text: onboardingCompleteReplyText,
      }),
      { matchInputContains: "I finished onboarding." },
    );
    const completionWebhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      materializedChatId,
      {
        eventId: `evt_onboarding_followup_complete_${userId}`,
        messageId: `msg_onboarding_followup_complete_${userId}`,
        text: "I finished onboarding.",
      },
    ));
    expect(completionWebhookResponse.status).toBe(202);
    await expect(completionWebhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const completionReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: completionBaseline,
      expectedPath: followupPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(completionReply))
      .toBe(onboardingCompleteReplyText);
    let completionStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(completionStatus.lastErrorCode ?? null).toBeNull();
    // The follow-up archive commits in a post-checkpoint managed-automation
    // pass that may land one checkpoint (or one deferred wake) after the
    // completion reply, so re-sample completions until the sticky
    // murphManagedAutomationUpdated counter appears.
    while (completionStatus.workspace?.redactedStatus?.murphManagedAutomationUpdated !== 1) {
      completionStatus = await requireScenario().waitForHostedCompletion(userId);
      expect(completionStatus.lastErrorCode ?? null).toBeNull();
    }
    expect(completionStatus.workspace?.redactedStatus).toMatchObject({
      murphManagedAutomationUpdated: 1,
    });
  }, 720_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-onboarding-followup-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted onboarding follow-up e2e",
    streamLogs: streamDevLogs,
  });
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_linq_onboarding_followup_setup`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

function buildHostedAssistantCompleteOnboardingResponses(input: {
  text: string;
}): readonly HostedLocalAssistantProviderScriptedResponse[] {
  return [
    buildAssistantProviderVaultCliCall([
      "assistant",
      "onboarding",
      "complete",
      "--reason",
      "manual",
    ]),
    input.text,
  ];
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signLinqWebhook(linqWebhookSecret, rawBody, timestamp);

  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signature,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
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
