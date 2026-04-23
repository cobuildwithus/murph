import { createHmac } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";

import {
  DEFAULT_DATABASE_URL,
} from "../../../scripts/dev-hosted-local/constants.ts";
import {
  buildHostedAssistantNotificationDecisionResponse,
  buildStableNumericSuffix,
} from "./helpers/hosted-local-e2e-support.js";
import {
  startHostedLocalFullStackScenario,
  type HostedLocalFullStackScenario,
} from "./helpers/hosted-local-full-stack-scenario.js";
import {
  buildHostedLinqSignupWelcomeWake,
  buildHostedLinqInboundEvent,
  buildLinqHomePhoneNumber,
  buildLinqRecipientPhoneNumber,
  HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
  HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT,
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

const webhookUserId = `member_local_linq_webhook_${Date.now()}`;
const voiceMemoWebhookUserId = `${webhookUserId}_voice_memo`;
const linqWebhookSecret = "linq-local-webhook-secret";
const hostedLinqVoiceMemoTranscript =
  "You can call me Rocket Man. I want to improve my endurance.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;

interface FakeWhisperFixture {
  commandPath: string;
  directory: string;
  modelPath: string;
}

let fakeWhisperFixture: FakeWhisperFixture | null = null;
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

it("derives stable numeric suffixes from the full Linq user id", () => {
  expect(buildStableNumericSuffix("member_local_linq_webhook_20260408", 7)).not.toBe(
    buildStableNumericSuffix("member_local_linq_webhook_rapid_20260408", 7),
  );
});

describe("hosted local Linq webhook e2e", () => {
  afterEach(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
    if (fakeWhisperFixture) {
      await rm(fakeWhisperFixture.directory, { force: true, recursive: true });
      fakeWhisperFixture = null;
    }
  });

  it("routes a signed Linq webhook through apps/web and delivers the follow-up reply", async () => {
    await startLinqScenario();
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(webhookUserId),
      memberId: webhookUserId,
      memberPhone: buildLinqRecipientPhoneNumber(webhookUserId),
    });

    await requireScenario().runWake(buildActivationWake(webhookUserId), webhookUserId);
    await requireScenario().waitForHostedCompletion(webhookUserId);
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver signup welcome",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      }),
    ]);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `assistant.notification.requested:local:${webhookUserId}:evt_linq_webhook`,
        userId: webhookUserId,
      }),
      webhookUserId,
    );
    await requireScenario().waitForHostedCompletion(webhookUserId);
    await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(webhookUserId),
      scenario: requireScenario(),
      userId: webhookUserId,
    });

    const materializedChatId = requireLinqStub().requireObservedChatId(webhookUserId);
    const expectedReplyChatPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const webhookEvent = buildHostedLinqInboundEvent(webhookUserId, materializedChatId, {
      eventId: `evt_webhook_${webhookUserId}`,
      messageId: `msg_webhook_${webhookUserId}`,
      text: "U can call me Rocket Man",
    });

    const webhookResponse = await postSignedLinqWebhook(webhookEvent);
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    requireScenario().queueAssistantResponses([HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT]);
    await requireScenario().waitForLatestPendingWake(webhookUserId);
    await requireScenario().waitForHostedCompletion(webhookUserId);

    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId: webhookUserId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT,
    );
  }, 300_000);

  it("keeps Linq context when two signed webhooks arrive before hosted completion catches up", async () => {
    const fastWebhookUserId = `${webhookUserId}_rapid`;
    await startLinqScenario();
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(fastWebhookUserId),
      memberId: fastWebhookUserId,
      memberPhone: buildLinqRecipientPhoneNumber(fastWebhookUserId),
    });

    await requireScenario().runWake(
      buildActivationWake(fastWebhookUserId),
      fastWebhookUserId,
    );
    await requireScenario().waitForHostedCompletion(fastWebhookUserId);
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver signup welcome",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      }),
    ]);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId:
          `assistant.notification.requested:local:${fastWebhookUserId}:evt_linq_webhook_fast`,
        userId: fastWebhookUserId,
      }),
      fastWebhookUserId,
    );
    await requireScenario().waitForHostedCompletion(fastWebhookUserId);
    await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(fastWebhookUserId),
      scenario: requireScenario(),
      userId: fastWebhookUserId,
    });

    const materializedChatId = requireLinqStub().requireObservedChatId(fastWebhookUserId);
    const expectedReplyChatPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);

    const firstWebhook = buildHostedLinqInboundEvent(fastWebhookUserId, materializedChatId, {
      eventId: `evt_webhook_name_${fastWebhookUserId}`,
      messageId: `msg_webhook_name_${fastWebhookUserId}`,
      text: "U can call me Rocket Man",
    });
    const secondWebhook = buildHostedLinqInboundEvent(fastWebhookUserId, materializedChatId, {
      eventId: `evt_webhook_goals_${fastWebhookUserId}`,
      messageId: `msg_webhook_goals_${fastWebhookUserId}`,
      text: "I want to build more strength, improve endurance, and get fitter overall.",
    });

    const firstResponse = await postSignedLinqWebhook(firstWebhook);
    const secondResponse = await postSignedLinqWebhook(secondWebhook);

    expect(firstResponse.status).toBe(202);
    await expect(firstResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(secondResponse.status).toBe(202);
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    requireScenario().queueAssistantResponses([HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT]);
    await requireScenario().waitForLatestPendingWake(fastWebhookUserId);
    await requireScenario().waitForHostedCompletion(fastWebhookUserId);

    const replySends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: outboundCountBeforeReply + 1,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId: fastWebhookUserId,
    });
    const newReplySends = replySends.slice(outboundCountBeforeReply);
    expect(newReplySends).toHaveLength(1);
    const groupedReplyText = requireLinqStub().readObservedMessageText(newReplySends[0]!);

    expect(groupedReplyText).toBe(
      HOSTED_LINQ_GROUPED_ASSISTANT_REPLY_TEXT,
    );
    expect(groupedReplyText).not.toContain("Hey, I'm Murph");
  }, 300_000);

  it("hydrates a metadata-only Linq voice memo through the local attachment API and replies from the transcript", async () => {
    const whisperFixture = await createFakeWhisperFixture(hostedLinqVoiceMemoTranscript);
    await startLinqScenario((linq) => ({
      LINQ_ATTACHMENT_CDN_BASE_URL: linq.attachmentDownloadBaseUrl,
      WHISPER_COMMAND: whisperFixture.commandPath,
      WHISPER_MODEL_PATH: whisperFixture.modelPath,
    }));
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(voiceMemoWebhookUserId),
      memberId: voiceMemoWebhookUserId,
      memberPhone: buildLinqRecipientPhoneNumber(voiceMemoWebhookUserId),
    });

    await requireScenario().runWake(buildActivationWake(voiceMemoWebhookUserId), voiceMemoWebhookUserId);
    await requireScenario().waitForHostedCompletion(voiceMemoWebhookUserId);
    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver signup welcome",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      }),
    ]);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId:
          `assistant.notification.requested:local:${voiceMemoWebhookUserId}:evt_linq_webhook_voice`,
        userId: voiceMemoWebhookUserId,
      }),
      voiceMemoWebhookUserId,
    );
    await requireScenario().waitForHostedCompletion(voiceMemoWebhookUserId);
    await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(voiceMemoWebhookUserId),
      scenario: requireScenario(),
      userId: voiceMemoWebhookUserId,
    });

    const materializedChatId = requireLinqStub().requireObservedChatId(voiceMemoWebhookUserId);
    const expectedReplyChatPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const outboundCountBeforeReply = requireLinqStub().countObservedSends(expectedReplyChatPath);
    const attachmentId = `att_voice_${voiceMemoWebhookUserId}`;
    const expectedAttachmentMetadataPath = `/attachments/${encodeURIComponent(attachmentId)}`;
    const expectedAttachmentDownloadPath =
      `/attachment-downloads/${encodeURIComponent(attachmentId)}.wav`;
    const attachmentMetadataCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentMetadataPath,
    });
    const attachmentDownloadCountBeforeReply = requireLinqStub().countObservedRequests({
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
    });
    const assistantProviderCountBeforeReply = requireScenario().assistantProviderRequests.length;
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      voiceMemoWebhookUserId,
      materializedChatId,
      {
        eventId: `evt_voice_memo_${voiceMemoWebhookUserId}`,
        messageId: `msg_voice_memo_${voiceMemoWebhookUserId}`,
        parts: [
          {
            attachmentId,
            fileName: `${attachmentId}.wav`,
            mimeType: "audio/wav",
            type: "voice_memo",
          },
        ],
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    requireScenario().queueAssistantResponses([HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT]);
    await requireScenario().waitForLatestPendingWake(voiceMemoWebhookUserId);
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: attachmentMetadataCountBeforeReply,
      expectedMethod: "GET",
      expectedPath: expectedAttachmentMetadataPath,
      scenario: requireScenario(),
      userId: voiceMemoWebhookUserId,
    });
    await requireLinqStub().waitForAdditionalRequest({
      baselineCount: attachmentDownloadCountBeforeReply,
      expectedMethod: "GET",
      expectedPath: expectedAttachmentDownloadPath,
      scenario: requireScenario(),
      userId: voiceMemoWebhookUserId,
    });
    await requireScenario().waitForHostedCompletion(voiceMemoWebhookUserId);

    const replySend = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundCountBeforeReply,
      expectedPath: expectedReplyChatPath,
      scenario: requireScenario(),
      userId: voiceMemoWebhookUserId,
    });
    expect(requireLinqStub().readObservedMessageText(replySend)).toBe(
      HOSTED_LINQ_ROCKET_MAN_ASSISTANT_REPLY_TEXT,
    );

    const assistantProviderRequests = requireScenario().assistantProviderRequests.slice(
      assistantProviderCountBeforeReply,
    );
    expect(assistantProviderRequests).toHaveLength(1);
    expect(assistantProviderRequests[0]?.body).toContain(hostedLinqVoiceMemoTranscript);
  }, 300_000);
});

function buildActivationWake(userId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:evt_linq_first_contact`,
    memberId: userId,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    occurredAt: new Date().toISOString(),
  });
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

async function startLinqScenario(
  additionalEnv:
    | NodeJS.ProcessEnv
    | ((linqStub: HostedLocalLinqStub) => NodeJS.ProcessEnv) = {},
): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  const resolvedAdditionalEnv =
    typeof additionalEnv === "function" ? additionalEnv(requireLinqStub()) : additionalEnv;
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      LINQ_API_BASE_URL: requireLinqStub().baseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      ...resolvedAdditionalEnv,
    },
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-linq-webhook-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted Linq webhook e2e",
    streamLogs: streamDevLogs,
  });
}

async function createFakeWhisperFixture(transcriptText: string): Promise<FakeWhisperFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "murph-local-whisper-"));
  const commandPath = path.join(directory, "fake-whisper");
  const modelPath = path.join(directory, "fake-model.bin");
  const executableSource = [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "const outputBase = args[args.indexOf('-of') + 1];",
    `fs.writeFileSync(\`${"${outputBase}"}.txt\`, ${JSON.stringify(`${transcriptText}\n`)}, "utf8");`,
  ].join("\n");

  await writeFile(commandPath, executableSource, "utf8");
  await chmod(commandPath, 0o755);
  await writeFile(modelPath, "fake-whisper-model", "utf8");

  fakeWhisperFixture = {
    commandPath,
    directory,
    modelPath,
  };
  return fakeWhisperFixture;
}
