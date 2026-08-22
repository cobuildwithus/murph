import { createHmac } from "node:crypto";

import { listHostedAiUsageForTest } from "#hosted-web-testing";
import { buildHostedExecutionMemberActivatedWake } from "@murphai/hosted-execution";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_API_KEY,
  HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_503_MARKER,
  HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_OBSERVATION,
} from "../src/hosted-local-test/gemini-video-analysis.js";
import { HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL } from "../src/runner-injected-credential.js";
import {
  buildAssistantProviderRequestDerivedMurphToolCall,
  buildAssistantProviderShellCommandCall,
  expectAdvertisedMurphDynamicTools,
  readHostedLocalAssistantProviderToolOutputs,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  readHostedLocalLinqVideoMp4Bytes,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const runNonce = Date.now();
const userId = `member_local_analyze_video_${runNonce}`;
const chatId = `chat_local_analyze_video_${runNonce}`;
const assistantModel = "gpt-5.6-terra";
const linqApiToken = "linq-local-analyze-video-token";
const linqWebhookSecret = "linq-local-analyze-video-webhook-secret";
const successQuestion = "What shape and color is centered in this video?";
const failureQuestion =
  `Try the video provider failure path ${HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_503_MARKER}.`;
const successReply = "I could see a blue square centered in the test video.";
const providerFailureText =
  "Video analysis is unavailable right now; no analysis was retrieved. Please try again later.";
const runnerGeminiSentinelProof = "RUNNER_GEMINI_SENTINEL_OK";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local analyze-video Linq roundtrip e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
        GEMINI_API_KEY: HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_API_KEY,
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-analyze-video-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted analyze-video Linq roundtrip e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });

    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone: buildLinqRecipientPhoneNumber(userId),
    });
    await requireScenario().runWake(buildActivationWake(), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: buildLinqRecipientPhoneNumber(userId),
    });
  }, 420_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("delivers a Gemini-backed result and a recoverable provider-failure reply", async () => {
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const geminiUsageBaseline = await countGeminiUsageRows();
    const successProviderBaseline = requireScenario().assistantProviderRequests.length;
    const successReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderShellCommandCall(
        `if [ "$GEMINI_API_KEY" = '${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}' ]; then printf '${runnerGeminiSentinelProof}'; else exit 17; fi`,
      ),
      buildAssistantProviderRequestDerivedMurphToolCall(
        "analyze_video",
        ({ requestMatchText }) => ({
          message_ref: requireLatestMessageRef(requestMatchText),
          question: successQuestion,
        }),
      ),
      successReply,
    ], { matchInputContains: successQuestion });

    await postVideoWebhook({
      eventId: `evt_analyze_video_success_${runNonce}`,
      messageId: `msg_analyze_video_success_${runNonce}`,
      question: successQuestion,
      videoAttachmentId: `att_video_success_${runNonce}`,
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const successSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: successReplyBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(successSend)).toBe(successReply);
    await expectHealthyCompletion();

    const successProviderRequests = requireScenario().assistantProviderRequests
      .slice(successProviderBaseline);
    const successToolOutputs = successProviderRequests
      .flatMap(readHostedLocalAssistantProviderToolOutputs)
      .join("\n\n");
    expect(successToolOutputs).toMatch(/rpcSuccess["']?\s*:\s*true/u);
    expect(successToolOutputs).toContain(HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_OBSERVATION);
    expect(successToolOutputs).toContain("untrusted third-party content");
    expect(successToolOutputs).toContain(runnerGeminiSentinelProof);
    expect(successProviderRequests.every((request) =>
      !request.body.includes(HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_API_KEY)
    )).toBe(true);
    expectAdvertisedMurphDynamicTools(successProviderRequests, {
      analyzeVideoAvailable: true,
      computerToolsAvailable: true,
      connectedAppsAvailable: true,
      messageTargetingAvailable: true,
      pendingVaultFilesAvailable: true,
      phoneCallsAvailable: true,
      progressUpdatesAvailable: true,
      responseCardAvailable: true,
      vaultFileSendAvailable: true,
    });
    await expectGeminiUsageRows(geminiUsageBaseline + 1);

    const failureProviderBaseline = requireScenario().assistantProviderRequests.length;
    const failureReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderRequestDerivedMurphToolCall(
        "analyze_video",
        ({ requestMatchText }) => ({
          message_ref: requireLatestMessageRef(requestMatchText),
          question: failureQuestion,
        }),
      ),
      // A blank model continuation proves the host-owned failure fallback is delivered.
      { text: "" },
    ], { matchInputContains: failureQuestion });

    await postVideoWebhook({
      eventId: `evt_analyze_video_failure_${runNonce}`,
      messageId: `msg_analyze_video_failure_${runNonce}`,
      question: failureQuestion,
      videoAttachmentId: `att_video_failure_${runNonce}`,
    });
    await requireScenario().waitForLatestPendingWake(userId);
    const failureSend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: failureReplyBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(failureSend)).toBe(providerFailureText);
    expect(requireLinqStub().readObservedMessageText(failureSend)).not.toContain(
      HOSTED_LOCAL_GEMINI_VIDEO_ANALYSIS_OBSERVATION,
    );
    await expectHealthyCompletion();

    const failureToolOutputs = requireScenario().assistantProviderRequests
      .slice(failureProviderBaseline)
      .flatMap(readHostedLocalAssistantProviderToolOutputs)
      .join("\n\n");
    expect(failureToolOutputs).toMatch(/rpcSuccess["']?\s*:\s*false/u);
    expect(failureToolOutputs).toContain(providerFailureText);
    await expectGeminiUsageRows(geminiUsageBaseline + 1);
  }, 420_000);
});

async function postVideoWebhook(input: {
  eventId: string;
  messageId: string;
  question: string;
  videoAttachmentId: string;
}): Promise<void> {
  const videoBytes = readHostedLocalLinqVideoMp4Bytes();
  const response = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
    userId,
    chatId,
    {
      eventId: input.eventId,
      messageId: input.messageId,
      parts: [
        { type: "text", value: input.question },
        {
          attachmentId: input.videoAttachmentId,
          fileName: "synthetic-video.mp4",
          mimeType: "video/mp4",
          size: videoBytes.byteLength,
          type: "media",
        },
      ],
    },
  ));
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    reason: "wake-appended-active-member",
  });
}

async function expectHealthyCompletion(): Promise<void> {
  const finalStatus = await requireScenario().waitForHostedCompletion(userId);
  expect(finalStatus.lastErrorCode ?? null).toBeNull();
  expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
  expect(finalStatus.inFlight).toBe(false);
  expect(finalStatus.workspace).not.toBeNull();
}

async function countGeminiUsageRows(): Promise<number> {
  return (await listHostedAiUsageForTest({
    environment: requireScenario().runtimeEnv,
    memberId: userId,
  })).filter((row) => row.providerName === "Google Gemini").length;
}

async function expectGeminiUsageRows(expectedCount: number): Promise<void> {
  await vi.waitFor(async () => {
    const geminiUsage = (await listHostedAiUsageForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
    })).filter((row) => row.providerName === "Google Gemini");
    expect(geminiUsage).toHaveLength(expectedCount);
    if (expectedCount > 0) {
      expect(geminiUsage.at(-1)).toMatchObject({
        allowanceCounted: true,
        cachedInputTokens: 4,
        featureKey: "video-analysis",
        inputTokens: 320,
        outputTokens: 18,
        reasoningTokens: 7,
        requestedModel: "gemini-3.7-flash",
        totalTokens: 345,
        triggerKind: "analyze-video",
      });
    }
  }, { interval: 250, timeout: 30_000 });
}

function requireLatestMessageRef(requestMatchText: string): string {
  const messageRef = [...requestMatchText.matchAll(/Message ref: (ain_[0-9a-f]{32})/gu)]
    .at(-1)?.[1];
  if (!messageRef) {
    throw new Error("Expected the accepted video input to expose a message ref.");
  }
  return messageRef;
}

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_analyze_video`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId: userId,
    occurredAt: new Date().toISOString(),
  });
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
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
    throw new Error("Hosted local full stack scenario was not initialized.");
  }
  return scenario;
}
