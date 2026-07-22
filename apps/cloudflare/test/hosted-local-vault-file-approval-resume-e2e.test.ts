import { createHash, createHmac } from "node:crypto";

import {
  approveHostedSensitiveActionChallengeForTest,
  readLatestHostedSensitiveActionChallengeForTest,
  type HostedSensitiveActionChallengeForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
} from "@murphai/hosted-execution";
import {
  buildHostedActionApprovalOutcomeEffectId,
} from "@murphai/hosted-execution/action-approval";
import {
  isHostedWorkspaceSnapshotV2Ref,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
} from "@murphai/runtime-state/assistant-generated-deliveries";
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
const assistantModel = "gpt-5.6-terra";
const requestInboundText = "Create the synthetic report PDF and attach it here.";
const pendingReplyText =
  "The report is prepared. Approve the secure action, then tell me to attach it.";
const reportRef = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/report.pdf`;
const attachmentUploadLogMessage = "Hosted-local Linq attachment upload accepted.";
const approvalGenerationVersion = "murph-action-approval-generation-v1";

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
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "2000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      faultInjection: true,
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
    const requestReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    const baselineIdleShutdownCleanupCount = countActivityExpiredDestroyRequestLogs();
    const preTurnStatus = await requireScenario().harness.readUserStatus(userId);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderShellCommandCall(
        `mkdir -p '${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}' && printf '%s\\n' '%PDF-1.7 synthetic hosted-local report' > '${reportRef}'`,
      ),
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
    const approvalEffectId = buildApprovalOutcomeEffectId(challenge);
    const idleShutdownStatus = await waitForIdleShutdownCheckpoint({
      baselineCleanupCount: baselineIdleShutdownCleanupCount,
      previousWorkspaceVersion: requireWorkspaceVersion(preTurnStatus),
    });
    expect(readHostedExecutionSnapshotHotRef(
      idleShutdownStatus.workspace?.snapshotRef ?? null,
    )).toBeNull();
    expect(readHostedExecutionSnapshotDeltaRef(
      idleShutdownStatus.workspace?.snapshotRef ?? null,
    )).toBeNull();

    const providerRequestCountBeforeResume = countAssistantProviderResponsesApiRequests();
    const containerStartCountBeforeResume = countStructuredLogMessage(
      "Hosted execution container starting.",
    );
    const approvedChallenge = await approveHostedSensitiveActionChallengeForTest({
      environment: requireScenario().runtimeEnv,
      tokenHash: challenge.tokenHash,
    });
    expect(approvedChallenge.approvalStatus).toBe("approved");

    const approvedReplyBaseline = requireLinqStub().countObservedSends(replyPath);
    await requireScenario().runWake(
      buildHostedExecutionPendingEffectsReconcileRequestedWake({
        effectId: approvalEffectId,
        eventId: `runtime-control:pending-effects-reconcile:local:${runId}`,
        occurredAt: new Date().toISOString(),
        userId,
      }),
      userId,
    );
    const attachedReply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: approvedReplyBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(readObservedLinqMessageParts(attachedReply)).toEqual([
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
    expect(countAssistantProviderResponsesApiRequests()).toBe(
      providerRequestCountBeforeResume,
    );
    expect(countStructuredLogMessage("Hosted execution container starting."))
      .toBeGreaterThan(containerStartCountBeforeResume);
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

function buildApprovalOutcomeEffectId(
  challenge: HostedSensitiveActionChallengeForTest,
): string {
  if (!challenge.approvalKey || !challenge.actionHash) {
    throw new Error("Hosted vault-file approval identity was incomplete.");
  }
  const approvalGeneration = createHash("sha256")
    .update([
      approvalGenerationVersion,
      challenge.approvalKey,
      challenge.actionHash,
      challenge.tokenHash,
    ].join("\n"))
    .digest("hex");
  return buildHostedActionApprovalOutcomeEffectId({
    approvalGeneration,
    approvalId: challenge.approvalKey,
    expiresAt: challenge.expiresAt.toISOString(),
  });
}

async function waitForIdleShutdownCheckpoint(input: {
  baselineCleanupCount: number;
  previousWorkspaceVersion: string;
}): Promise<HostedRunnerStatusResponse> {
  const startedAt = Date.now();
  let lastActivityExpiryError: unknown = null;
  let lastStatus: HostedRunnerStatusResponse | null = null;
  let lastStatusReadError: unknown = null;

  while (Date.now() - startedAt < 120_000) {
    let status: HostedRunnerStatusResponse;
    try {
      status = await requireScenario().harness.readUserStatus(userId);
      lastStatusReadError = null;
    } catch (error) {
      lastStatusReadError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    lastStatus = status;
    const hotRef = status.workspace
      ? readHostedExecutionSnapshotHotRef(status.workspace.snapshotRef)
      : null;
    const deltaRef = status.workspace
      ? readHostedExecutionSnapshotDeltaRef(status.workspace.snapshotRef)
      : null;
    if (
      status.workspace
      && status.workspace.version !== input.previousWorkspaceVersion
      && isHostedWorkspaceSnapshotV2Ref(status.workspace.snapshotRef)
      && hotRef === null
      && deltaRef === null
      && !status.inFlight
      && !status.lastErrorCode
      && countActivityExpiredDestroyRequestLogs() > input.baselineCleanupCount
    ) {
      return status;
    }

    try {
      await requireScenario().harness.expireRunnerActivityForTest(userId);
      lastActivityExpiryError = null;
    } catch (error) {
      lastActivityExpiryError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the approval-pending idle-shutdown checkpoint.",
    ...(lastStatus ? [`last status: ${JSON.stringify(lastStatus)}`] : []),
    ...(lastActivityExpiryError
      ? [`last activity expiry error: ${formatErrorMessage(lastActivityExpiryError)}`]
      : []),
    ...(lastStatusReadError
      ? [`last status read error: ${formatErrorMessage(lastStatusReadError)}`]
      : []),
  ]));
}

function requireWorkspaceVersion(status: HostedRunnerStatusResponse): string {
  const version = status.workspace?.version ?? null;
  if (!version) {
    throw new Error("Hosted status did not include a workspace version.");
  }
  return version;
}

function countActivityExpiredDestroyRequestLogs(): number {
  return countStructuredLogMessage(
    "Hosted execution container destroy requested.",
    (record) => record.details?.destroyRequestReason === "activity-expired",
  );
}

function countStructuredLogMessage(
  message: string,
  predicate: (record: HostedStructuredLogRecord) => boolean = () => true,
): number {
  const output = [
    requireScenario().harness.stdoutTail(2_000_000),
    requireScenario().harness.stderrTail(2_000_000),
  ].join("\n");
  let count = 0;
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const record = parsed as HostedStructuredLogRecord;
    if (record.message === message && predicate(record)) {
      count += 1;
    }
  }
  return count;
}

interface HostedStructuredLogRecord {
  details?: {
    destroyRequestReason?: unknown;
  };
  message?: unknown;
}

function countAssistantProviderResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests.filter((request) =>
    request.url === "/v1/responses"
  ).length;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
