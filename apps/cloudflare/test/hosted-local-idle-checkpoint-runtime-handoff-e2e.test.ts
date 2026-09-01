import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  appendHostedExecutionWakeForTest,
  queryHostedRuntimeWorkflowForTest,
  seedHostedWorkspaceCheckpointForTest,
  signalHostedRuntimeWakeRuntimeForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
} from "@murphai/hosted-execution/orchestration-control";

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

const runId = Date.now();
const userId = `member_local_idle_handoff_${runId}`;
const chatId = `chat_local_idle_handoff_${runId}`;
const inboundText = "process this single message after the idle checkpoint";
const replyText = "The checkpoint handoff processed the waiting message.";
const assistantModel = "gpt-5.6-terra";
const linqWebhookSecret = "linq-local-idle-handoff-secret";
const providerStartDeadlineMs = 20_000;
const modelFreeFrontierItemCount = 4;

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride =
  process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

afterAll(async () => {
  if (scenario) {
    await scenario.harness
      .releaseShutdownCheckpointPublicationBarrierForTest(userId)
      .catch(() => undefined);
  }
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
}, 120_000);

describe("hosted local idle-checkpoint runtime handoff e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub();
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1000",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          buildLinqRecipientPhoneNumber(userId),
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: "linq-local-test-token",
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
        OPENAI_API_KEY: "stub-local-openai-key",
      },
      assistantProviderStubModelId: assistantModel,
      faultInjection: true,
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-idle-checkpoint-handoff-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted idle-checkpoint runtime handoff e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 600_000);

  it("processes one conversation wake after the checkpoint owner releases", async () => {
    const activeScenario = requireScenario();
    const activeLinqStub = requireLinqStub();
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;

    await activeScenario.seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await activeScenario.bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const activation = await activeScenario.runWake(
      buildHostedExecutionMemberActivatedWake({
        eventId: `member.activated:local:${userId}:idle-handoff`,
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        memberId: userId,
        occurredAt: new Date().toISOString(),
      }),
      userId,
    );
    expect(activation.wakeResult.kind).toBe("runtime_processing_accepted");
    await activeScenario.waitForHostedCompletion(userId);
    await stageCanonicalModelFreeSystemFrontier();

    await activeScenario.harness.armShutdownCheckpointPublicationBarrierForTest(
      userId,
    );

    let barrierReleased = false;
    let gracefulStopPromise: Promise<{ ok: true }> | null = null;
    try {
      const checkpointOwnerBaseline = await readOptionalWorkflowObservation();
      await signalHostedRuntimeWakeRuntimeForTest({
        environment: activeScenario.runtimeEnv,
        userId,
      });
      const acceptedCheckpointOwner = await waitForAcceptedWorkflowOwner({
        afterExecutionAt: checkpointOwnerBaseline?.lastExecutionAt ?? null,
        afterSignalVersion: checkpointOwnerBaseline?.signalVersion ?? -1,
        expectedWaitReasons: ["runtime_wake_recheck"],
      });
      await waitForCheckpointPublicationBarrier();
      const heldStatus = await activeScenario.harness.readUserStatus(userId);
      expect(heldStatus.inFlight).toBe(true);
      const providerRequestBaseline = countAssistantProviderRequests();
      const replyBaseline = activeLinqStub.countAcceptedSends(replyPath);
      activeScenario.queueAssistantResponses([replyText], {
        matchInputContains: inboundText,
      });

      const webhookResponse = await postSignedLinqWebhook(
        buildHostedLinqInboundEvent(userId, chatId, {
          eventId: `evt_idle_handoff_${runId}`,
          messageId: `msg_idle_handoff_${runId}`,
          text: inboundText,
        }),
      );
      expect(webhookResponse.status).toBe(202);
      await expect(webhookResponse.json()).resolves.toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });
      await waitForConversationMailboxLag();

      const acceptedConversationOwner = await waitForAcceptedWorkflowOwner({
        afterExecutionAt: acceptedCheckpointOwner.lastExecutionAt,
        afterSignalVersion: acceptedCheckpointOwner.signalVersion,
        expectedWaitReasons: ["runtime_wake_recheck"],
      });
      const acceptedConversationHorizonMs = Date.parse(
        requireWorkflowWaitUntil(acceptedConversationOwner),
      );
      expect(acceptedConversationHorizonMs - Date.now()).toBeGreaterThan(
        providerStartDeadlineMs,
      );
      gracefulStopPromise =
        activeScenario.harness.beginShutdownCheckpointGracefulStopForTest(
          userId,
        );

      await expect(
        activeScenario.harness
          .releaseShutdownCheckpointPublicationBarrierForTest(userId),
      ).resolves.toEqual({ ok: true, released: true });
      barrierReleased = true;
      await expect(gracefulStopPromise).resolves.toEqual({ ok: true });
      gracefulStopPromise = null;

      await waitForAssistantProviderInput({
        baselineCount: providerRequestBaseline,
        timeoutMs: providerStartDeadlineMs,
      });
      const deliveredReply = await activeLinqStub.waitForAdditionalAcceptedSend({
        baselineCount: replyBaseline,
        expectedPath: replyPath,
        scenario: activeScenario,
        userId,
      });

      expect(activeLinqStub.readObservedMessageText(deliveredReply)).toBe(
        replyText,
      );
      expect(countAssistantProviderRequests()).toBe(
        providerRequestBaseline + 1,
      );
      const finalStatus = await activeScenario.waitForHostedCompletion(userId);
      expect(finalStatus.lastErrorCode ?? null).toBeNull();
      expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(
        true,
      );
    } finally {
      if (!barrierReleased) {
        await activeScenario.harness
          .releaseShutdownCheckpointPublicationBarrierForTest(userId)
          .catch(() => undefined);
      }
      await gracefulStopPromise?.catch(() => undefined);
    }
  }, 600_000);
});

async function stageCanonicalModelFreeSystemFrontier(): Promise<void> {
  const activeScenario = requireScenario();
  const status = await activeScenario.harness.readUserStatus(userId);
  const workspace = status.workspace;
  if (!workspace?.snapshotRef || !workspace.browserVaultReplicaRef) {
    throw new Error(await activeScenario.buildFailureMessage(userId, [
      "The activated workspace did not publish the snapshot and browser replica required to stage the model-free frontier.",
    ]));
  }
  const handledThroughValue =
    workspace.redactedStatus?.hostedMailboxSystemHandledThroughSeq;
  const handledThroughSeq =
    typeof handledThroughValue === "string" ? handledThroughValue : "0";
  let latestSystemSeq: string | null = null;
  for (let ordinal = 0; ordinal < modelFreeFrontierItemCount; ordinal += 1) {
    const occurredAt = new Date().toISOString();
    const append = await appendHostedExecutionWakeForTest({
      environment: activeScenario.runtimeEnv,
      wake: buildHostedExecutionDeviceSyncWake({
        eventId: `device-sync.wake:idle-handoff:${runId}:${ordinal}`,
        occurredAt,
        reason: "webhook_hint",
        userId,
      }),
    });
    expect(append.inserted).toBe(true);
    latestSystemSeq = append.wake.seq;
  }
  if (latestSystemSeq === null) {
    throw new Error("The model-free frontier fixture did not append any rows.");
  }

  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: workspace.browserVaultReplicaRef,
    environment: activeScenario.runtimeEnv,
    nextWakeAt: workspace.nextWakeAt,
    nextWakeReason: workspace.nextWakeReason,
    redactedStatusJson: {
      ...(workspace.redactedStatus ?? {}),
      hostedMailboxSystemHandledThroughSeq: handledThroughSeq,
      hostedMailboxSystemImportedSeq: latestSystemSeq,
    },
    snapshotRef: workspace.snapshotRef,
    userId,
  });
  expect(checkpoint.status).toBe("updated");

  const stagedStatus = await activeScenario.harness.readUserStatus(userId);
  const systemLane = stagedStatus.mailboxLag.find(
    (lane) => lane.lane === "system",
  );
  expect(systemLane).toMatchObject({
    importedSeq: latestSystemSeq,
    lag: "0",
    maxSeq: latestSystemSeq,
  });
  expect(
    stagedStatus.workspace?.redactedStatus
      ?.hostedMailboxSystemHandledThroughSeq,
  ).toBe(handledThroughSeq);
  expect(BigInt(latestSystemSeq) - BigInt(handledThroughSeq)).toBe(
    BigInt(modelFreeFrontierItemCount),
  );
}

async function waitForCheckpointPublicationBarrier(): Promise<void> {
  const deadlineAt = Date.now() + 180_000;
  let lastState: string | null = null;
  while (Date.now() < deadlineAt) {
    const barrier = await requireScenario().harness
      .readShutdownCheckpointPublicationBarrierForTest(userId);
    lastState = barrier.state;
    if (barrier.state === "entered") {
      return;
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the real idle checkpoint publication barrier.",
    `last barrier state: ${lastState ?? "unread"}`,
  ]));
}

async function waitForConversationMailboxLag(): Promise<void> {
  const deadlineAt = Date.now() + 30_000;
  while (Date.now() < deadlineAt) {
    const status = await requireScenario().harness.readUserStatus(userId);
    const conversationLane = status.mailboxLag.find(
      (lane) => lane.lane === "conversation",
    );
    if (conversationLane && BigInt(conversationLane.lag) > 0n) {
      return;
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for the accepted conversation to remain pending while checkpoint publication was held.",
  ]));
}

async function waitForAcceptedWorkflowOwner(input: {
  afterExecutionAt: string | null;
  afterSignalVersion: number;
  expectedWaitReasons: readonly string[];
}): Promise<WorkflowObservation> {
  const deadlineAt = Date.now() + 30_000;
  let lastObservation: WorkflowObservation | null = null;
  let lastError: string | null = null;
  while (Date.now() < deadlineAt) {
    try {
      const observation = await readWorkflowObservation();
      lastObservation = observation;
      if (
        observation.signalVersion > input.afterSignalVersion
        && observation.lastExecutionAt !== null
        && observation.lastExecutionAt !== input.afterExecutionAt
        && observation.currentWaitReason !== null
        && input.expectedWaitReasons.includes(observation.currentWaitReason)
        && observation.currentWaitUntil !== null
      ) {
        return observation;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "Timed out waiting for Temporal to accept the live runtime owner and arm its recheck horizon.",
    `last workflow observation: ${JSON.stringify(lastObservation)}`,
    `last workflow query error: ${lastError ?? "none"}`,
  ]));
}

function requireWorkflowWaitUntil(observation: WorkflowObservation): string {
  if (observation.currentWaitUntil === null) {
    throw new Error("The accepted Temporal owner did not expose a wait horizon.");
  }
  return observation.currentWaitUntil;
}

async function waitForAssistantProviderInput(input: {
  baselineCount: number;
  timeoutMs: number;
}): Promise<void> {
  const deadlineAt = Date.now() + input.timeoutMs;
  while (Date.now() < deadlineAt) {
    const requests = requireScenario().assistantProviderRequests.filter(
      (request) => request.url === "/v1/responses",
    );
    if (
      requests.length > input.baselineCount
      && requests.some((request) => request.body.includes(inboundText))
    ) {
      return;
    }
    await sleep(100);
  }

  const workflow = await readWorkflowObservation().catch(() => null);
  throw new Error(await requireScenario().buildFailureMessage(userId, [
    "The single accepted conversation did not reach the assistant provider after the idle-checkpoint owner released.",
    `foreground provider-start deadline: ${input.timeoutMs}ms`,
    `workflow observation: ${JSON.stringify(workflow)}`,
  ]));
}

interface WorkflowObservation {
  currentWaitReason: string | null;
  currentWaitUntil: string | null;
  lastExecutionAt: string | null;
  lastRuntimeAttemptId: string | null;
  signalVersion: number;
}

async function readWorkflowObservation(): Promise<WorkflowObservation> {
  const value = await queryHostedRuntimeWorkflowForTest({
    environment: requireScenario().runtimeEnv,
    queryName: HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
    workflowId: `hosted-user-runtime:${userId}`,
  });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime workflow query returned a non-object.");
  }
  const record = value as Record<string, unknown>;
  const signalVersion = record.signalVersion;
  if (
    typeof signalVersion !== "number"
    || !Number.isSafeInteger(signalVersion)
    || signalVersion < 0
  ) {
    throw new TypeError(
      "Hosted runtime workflow query returned an invalid signal version.",
    );
  }
  return {
    currentWaitReason: readNullableString(record.currentWaitReason),
    currentWaitUntil: readNullableString(record.currentWaitUntil),
    lastExecutionAt: readNullableString(record.lastExecutionAt),
    lastRuntimeAttemptId: readNullableString(record.lastRuntimeAttemptId),
    signalVersion,
  };
}

async function readOptionalWorkflowObservation(): Promise<
  WorkflowObservation | null
> {
  try {
    return await readWorkflowObservation();
  } catch (error) {
    if (error instanceof Error && error.name === "WorkflowNotFoundError") {
      return null;
    }
    throw error;
  }
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError("Hosted runtime workflow query returned an invalid field.");
  }
  return value;
}

function countAssistantProviderRequests(): number {
  return requireScenario().assistantProviderRequests.filter(
    (request) => request.url === "/v1/responses",
  ).length;
}

async function postSignedLinqWebhook(
  event: Record<string, unknown>,
): Promise<Response> {
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

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error(
      "Hosted local idle-checkpoint handoff scenario was not started.",
    );
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local idle-checkpoint handoff Linq stub was not started.");
  }
  return linqStub;
}
