import { createHmac } from "node:crypto";

import {
  approveHostedSensitiveActionChallengeForTest,
  readLatestHostedSensitiveActionChallengeForTest,
  type HostedSensitiveActionChallengeForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildAssistantProviderMurphToolCall,
  buildAssistantProviderShellCommandCall,
} from "./helpers/hosted-local-e2e-support.js";
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

vi.mock("server-only", () => ({}));

const runId = Date.now();
const userId = `member_local_vault_file_approval_${runId}`;
const chatId = `chat_local_vault_file_approval_${runId}`;
const linqApiToken = "linq-local-vault-file-token";
const linqWebhookSecret = "linq-local-vault-file-webhook-secret";
const assistantModel = "gpt-5.5";
const prepareInboundText = "Prepare the synthetic report PDF for this conversation.";
const requestInboundText = "Please attach the prepared report.";
const approvedInboundText = "I approved it. Attach the report now.";
const preparedReplyText = "The synthetic report is prepared.";
const pendingReplyText =
  "The report is prepared. Approve the secure action, then tell me to attach it.";
const attachedReplyText = "Here it is: report.pdf.";
const reportRef = "documents/report.pdf";
const attachmentUploadLogMessage = "Hosted-local Linq attachment upload accepted.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local vault-file approval resume e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
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
      persistDirPrefix: "murph-hosted-local-vault-file-approval-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted vault-file approval resume e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
  }, 180_000);

  it("resumes an approved vault file through the real Linq upload and reply path", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(), userId);
    await requireScenario().waitForHostedCompletion(userId);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const attachmentCreateBaseline = requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    });
    const attachmentUploadBaseline = countAttachmentUploadLogs();
    const prepareReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderShellCommandCall(
        "mkdir -p documents && printf '%s\\n' '%PDF-1.7 synthetic hosted-local report' > documents/report.pdf",
      ),
      preparedReplyText,
    ], {
      matchInputContains: prepareInboundText,
    });

    const prepareResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_vault_file_prepare_${runId}`,
        messageId: `msg_vault_file_prepare_${runId}`,
        text: prepareInboundText,
      },
    ));
    expect(prepareResponse.status).toBe(202);
    const preparedReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: prepareReplyBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(readObservedLinqMessageParts(preparedReply)).toEqual([
      { type: "text", value: preparedReplyText },
    ]);
    await requireScenario().waitForHostedCompletion(userId);

    const requestReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("send_vault_file", { ref: reportRef }),
      pendingReplyText,
    ], {
      matchInputContains: requestInboundText,
    });

    const requestResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_vault_file_request_${runId}`,
        messageId: `msg_vault_file_request_${runId}`,
        text: requestInboundText,
      },
    ));
    expect(requestResponse.status).toBe(202);
    const pendingReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: requestReplyBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    await requireScenario().waitForHostedCompletion(userId);

    const challenge = await waitForLatestChallenge((candidate) =>
      candidate.approvalStatus === "pending"
      && candidate.consumedAt === null
      && candidate.tokenHash.length > 0
    );
    expect(challenge.actionId).toMatch(/^vault-file-send:[0-9a-f]{64}$/u);
    expect(challenge.approvalKey).toMatch(/^haa_[A-Za-z0-9_-]{32}$/u);
    const pendingReplyWithApprovalUrl = [
      pendingReplyText,
      `${requireScenario().harness.webBaseUrl}/approve/${challenge.approvalKey}`,
    ].join("\n\n");
    expect(requireLinqStub().readObservedMessageText(pendingReply)).toBe(
      pendingReplyWithApprovalUrl,
    );
    expect(readObservedLinqMessageParts(pendingReply)).toEqual([
      { type: "text", value: pendingReplyWithApprovalUrl },
    ]);
    expect(requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    })).toBe(attachmentCreateBaseline);
    expect(countAttachmentUploadLogs()).toBe(attachmentUploadBaseline);
    await approveHostedSensitiveActionChallengeForTest({
      environment: requireScenario().runtimeEnv,
      tokenHash: challenge.tokenHash,
    });

    const approvedReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("send_vault_file", { ref: reportRef }),
      attachedReplyText,
    ], {
      matchInputContains: approvedInboundText,
    });

    const approvedResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_vault_file_resume_${runId}`,
        messageId: `msg_vault_file_resume_${runId}`,
        text: approvedInboundText,
      },
    ));
    expect(approvedResponse.status).toBe(202);
    const attachedReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: approvedReplyBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(readObservedLinqMessageParts(attachedReply)).toEqual([
      { type: "text", value: attachedReplyText },
      { attachment_id: "attachment_local_1", type: "media" },
    ]);
    await expect(requireLinqStub().waitForMatchingRequestCount({
      expectedCount: attachmentCreateBaseline + 1,
      expectedMethod: "POST",
      expectedPath: "/attachments",
      scenario: requireScenario(),
      userId,
    })).resolves.toHaveLength(attachmentCreateBaseline + 1);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    const consumedChallenge = await waitForLatestChallenge((candidate) =>
      candidate.tokenHash === challenge.tokenHash && candidate.consumedAt !== null
    );
    expect(consumedChallenge.approvalStatus).toBe("approved");
    expect(requireLinqStub().countObservedRequests({
      expectedMethod: "POST",
      expectedPath: "/attachments",
    })).toBe(attachmentCreateBaseline + 1);
    expect(countAttachmentUploadLogs()).toBe(attachmentUploadBaseline + 1);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(
      approvedReplyBaseline + 1,
    );
  }, 420_000);
});

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${userId}:vault-file-approval`,
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

async function waitForLatestChallenge(
  predicate: (challenge: HostedSensitiveActionChallengeForTest) => boolean,
): Promise<HostedSensitiveActionChallengeForTest> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 180_000) {
    const challenge = await readLatestHostedSensitiveActionChallengeForTest({
      environment: requireScenario().runtimeEnv,
      memberId: userId,
    });
    if (challenge && predicate(challenge)) {
      return challenge;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the hosted vault-file approval state.");
}

function readObservedLinqMessageParts(request: ObservedLinqRequest): unknown[] {
  const parsed = JSON.parse(request.body) as {
    message?: {
      parts?: unknown;
    };
  };
  return Array.isArray(parsed.message?.parts) ? parsed.message.parts : [];
}

function countAttachmentUploadLogs(): number {
  const output = [
    requireScenario().harness.stdoutTail(2_000_000),
    requireScenario().harness.stderrTail(2_000_000),
  ].join("\n");
  return output.split(attachmentUploadLogMessage).length - 1;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local vault-file approval scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local Linq stub was not started.");
  }
  return linqStub;
}
