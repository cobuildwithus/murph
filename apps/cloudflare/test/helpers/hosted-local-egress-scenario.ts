import { createHmac } from "node:crypto";

import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
  type ObservedLinqRequest,
} from "./hosted-local-linq-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./hosted-local-full-stack-scenario.js";
import type {
  HostedLocalAssistantProviderScriptedResponse,
  HostedLocalAssistantProviderStubRequest,
  HostedLocalAssistantProviderStubUsageMode,
} from "./hosted-local-e2e-support.js";

const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-webhook-secret";
const productionLikeAssistantModel = "gpt-5.5";

export interface HostedLocalEgressScenario {
  chatId: string;
  linqStub: HostedLocalLinqStub;
  scenario: HostedLocalFullStackScenario;
  userId: string;
  assertHealthy(input?: { expectAssistantProviderRequest?: boolean }): Promise<void>;
  countProviderRequests(pathname?: string): number;
  listProviderRequests(pathname?: string): HostedLocalAssistantProviderStubRequest[];
  seedActiveMemberAndChat(): Promise<void>;
  sendInboundTurn(input: {
    eventSuffix: string;
    expectedReplyText: string;
    text: string;
  }): Promise<ObservedLinqRequest>;
  stop(): Promise<void>;
}

export async function startHostedLocalLinqEgressScenario(input: {
  additionalEnv?: NodeJS.ProcessEnv;
  assistantProviderResponses?: readonly HostedLocalAssistantProviderScriptedResponse[];
  assistantProviderStubUsageMode?: HostedLocalAssistantProviderStubUsageMode;
  persistDirPrefix: string;
  requiredRunnerEnvProfile?: string;
  scenarioLabel: string;
  testControls?: boolean;
  userIdPrefix: string;
}): Promise<HostedLocalEgressScenario> {
  const userId = `${input.userIdPrefix}_${Date.now()}`;
  const chatId = `chat_${input.userIdPrefix}_${Date.now()}`;
  const streamLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
  const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
  const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  const linqStub = await startHostedLocalLinqStub();
  let scenario: HostedLocalFullStackScenario | null = null;

  try {
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_ASSISTANT_REASONING_EFFORT: "low",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: linqStub.runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        MURPH_E2E_ASSISTANT_PROVIDER_MODE: "live",
        OPENAI_API_KEY: "stub-local-openai-key",
        ...(input.additionalEnv ?? {}),
      },
      assistantProviderMode: "live",
      assistantProviderRecorder: true,
      assistantProviderResponses: input.assistantProviderResponses,
      assistantProviderStubModelId: productionLikeAssistantModel,
      assistantProviderStubUsageMode: input.assistantProviderStubUsageMode,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: input.persistDirPrefix,
      requiredRunnerEnvProfile: input.requiredRunnerEnvProfile ?? "linq",
      scenarioLabel: input.scenarioLabel,
      streamLogs,
      testControls: input.testControls,
    });
  } catch (error) {
    await linqStub.stop().catch(() => undefined);
    throw error;
  }

  const requireScenario = (): HostedLocalFullStackScenario => {
    if (!scenario) {
      throw new Error("Hosted local egress scenario already stopped.");
    }
    return scenario;
  };

  return {
    chatId,
    linqStub,
    scenario: requireScenario(),
    userId,
    assertHealthy: async (assertInput = {}) => {
      await requireScenario().assertHealthyHostedRun(userId, assertInput);
    },
    countProviderRequests: (pathname = "/v1/responses") =>
      requireScenario().assistantProviderRequests.filter((request) =>
        request.url === pathname
      ).length,
    listProviderRequests: (pathname = "/v1/responses") =>
      requireScenario().assistantProviderRequests.filter((request) =>
        request.url === pathname
      ),
    seedActiveMemberAndChat: async () => {
      await requireScenario().seedActiveHostedLinqMember({
        billingPlanCode: "launch_edge_monthly",
        homePhone: buildLinqHomePhoneNumber(userId),
        memberId: userId,
        memberPhone: buildLinqRecipientPhoneNumber(userId),
      });
      await requireScenario().runWake(buildActivationWake(userId), userId);
      await requireScenario().waitForHostedCompletion(userId);
      await requireScenario().bindActiveHostedLinqHomeChat({
        chatId,
        memberId: userId,
        recipientPhone: buildLinqRecipientPhoneNumber(userId),
      });
    },
    sendInboundTurn: async (turnInput) => {
      const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
      const expectedReplyMatcher = (request: ObservedLinqRequest): boolean =>
        linqStub.readObservedMessageText(request) === turnInput.expectedReplyText;
      const baselineCount = linqStub.countObservedSends(
        replyPath,
        expectedReplyMatcher,
      );
      requireScenario().queueAssistantResponses([turnInput.expectedReplyText], {
        matchInputContains: turnInput.text,
      });
      const webhookResponse = await postSignedLinqWebhook({
        event: buildHostedLinqInboundEvent(userId, chatId, {
          eventId: `evt_${turnInput.eventSuffix}_${userId}`,
          messageId: `msg_${turnInput.eventSuffix}_${userId}`,
          text: turnInput.text,
        }),
        scenario: requireScenario(),
      });
      if (webhookResponse.status !== 202) {
        throw new Error(`Expected Linq webhook append to return 202, got ${webhookResponse.status}: ${await webhookResponse.text()}`);
      }
      await requireScenario().waitForLatestPendingWake(userId);
      const completionPromise = requireScenario().waitForHostedCompletion(userId);
      const send = await linqStub.waitForAdditionalSend({
        baselineCount,
        expectedPath: replyPath,
        matchRequest: expectedReplyMatcher,
        scenario: requireScenario(),
        userId,
      });
      await completionPromise;
      const observedText = linqStub.readObservedMessageText(send);
      if (observedText !== turnInput.expectedReplyText) {
        throw new Error(`Expected Linq reply ${JSON.stringify(turnInput.expectedReplyText)}, got ${JSON.stringify(observedText)}.`);
      }
      return send;
    },
    stop: async () => {
      const cleanup = await Promise.allSettled([
        requireScenario().stop(),
        linqStub.stop(),
      ]);
      scenario = null;
      const failures = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (failures.length === 1) {
        throw failures[0];
      }
      if (failures.length > 1) {
        throw new AggregateError(failures, "Hosted local egress scenario cleanup failed.");
      }
    },
  };
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_egress_authority`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

async function postSignedLinqWebhook(input: {
  event: Record<string, unknown>;
  scenario: HostedLocalFullStackScenario;
}): Promise<Response> {
  const rawBody = JSON.stringify(input.event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return await fetch(`${input.scenario.harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": signLinqWebhook(linqWebhookSecret, rawBody, timestamp),
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
}
