import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  readHostedVaultShareProjectionCiphertextForTest,
  seedHostedLaunchConsentForTest,
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildAssistantProviderMurphToolCall,
  buildAssistantProviderVaultCliCall,
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
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const ownerMemberId = `member_local_group_sleep_source_owner_${runId}`;
const groupChatId = `chat_local_group_sleep_source_${runId}`;
const personalChatId = `chat_local_group_sleep_source_personal_${runId}`;
const ownerPhone = buildLinqRecipientPhoneNumber(ownerMemberId);
const homePhone = buildLinqHomePhoneNumber(ownerMemberId);
const linqApiToken = "linq-local-group-sleep-source-token";
const linqWebhookSecret = "linq-local-group-sleep-source-webhook-secret";
const offerRequestText = "Share my Deep and REM sleep from every source with this room.";
const readRequestText = "Compare the Deep and REM sleep sources that I shared.";
const offerReplyText = "The exact by-source sharing choice is ready.";
const readReplyText = "The stored Deep and REM source values are available to this room.";
const correctionReplyText = "I saved that sleep-stage correction.";
const groupReplyPath = `/chats/${encodeURIComponent(groupChatId)}/messages`;
const personalReplyPath = `/chats/${encodeURIComponent(personalChatId)}/messages`;
const deepProjectionKind = "deep-sleep-sources-days.v1";
const remProjectionKind = "rem-sleep-sources-days.v1";
const projectionKinds = [deepProjectionKind, remProjectionKind] as const;
const sleepDate = new Date(Date.now() - 24 * 60 * 60 * 1_000)
  .toISOString()
  .slice(0, 10);

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

const cleanupPaths: string[] = [];
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

describe("hosted local group sleep-source sharing e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      canonicalChats: [
        {
          chatId: personalChatId,
          handles: [
            { handle: homePhone, isMe: true, status: "active" },
            { handle: ownerPhone, isMe: false, status: "active" },
          ],
          isGroup: false,
        },
        {
          chatId: groupChatId,
          handles: [
            { handle: homePhone, isMe: true, status: "active" },
            { handle: ownerPhone, isMe: false, status: "active" },
          ],
          isGroup: true,
        },
      ],
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS: ownerPhone,
        LINQ_API_BASE_URL: requireLinqStub().runnerBaseUrl,
        LINQ_API_TOKEN: linqApiToken,
        LINQ_WEBHOOK_SECRET: linqWebhookSecret,
        MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      },
      localDatabaseUrl,
      persistDirOverride: workerPersistDirOverride,
      persistDirPrefix: "murph-hosted-local-group-sleep-source-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted group sleep-source sharing e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 300_000);

  afterAll(async () => {
    await scenario?.stop();
    scenario = null;
    await linqStub?.stop();
    linqStub = null;
    await Promise.all(cleanupPaths.splice(0).map((target) =>
      rm(target, { force: true, recursive: true })
    ));
  }, 180_000);

  it("refreshes an active grant from sequential typed manual corrections before authorized group read", async () => {
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: ownerMemberId,
      memberPhone: ownerPhone,
    });
    await seedHostedLaunchConsentForTest({
      environment: requireScenario().runtimeEnv,
      memberId: ownerMemberId,
    });
    await seedPersonalSleepSourceSnapshot();
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: personalChatId,
      memberId: ownerMemberId,
      recipientPhone: ownerPhone,
    });
    await requireScenario().runWake(buildActivationWake(), ownerMemberId);
    const activated = await requireScenario().waitForHostedCompletion(ownerMemberId);
    expect(activated.lastErrorCode ?? null).toBeNull();

    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("group", {
        action: "offer_access",
        projectionScopes: projectionKinds.map((projectionKind) => ({ projectionKind })),
      }),
      offerReplyText,
    ], { matchInputContains: offerRequestText });

    const sendBaseline = requireLinqStub().countObservedSends(groupReplyPath);
    const messageIdBaseline = requireLinqStub().listObservedMessageIds(groupChatId).length;
    const offerWebhook = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      ownerMemberId,
      groupChatId,
      {
        eventId: `evt_group_sleep_source_offer_${runId}`,
        isGroup: true,
        messageId: `msg_group_sleep_source_offer_${runId}`,
        service: "iMessage",
        text: offerRequestText,
      },
    ));
    expect(offerWebhook.status).toBe(202);

    const offerSends = await requireLinqStub().waitForMatchingSendCount({
      expectedCount: sendBaseline + 2,
      expectedPath: groupReplyPath,
      scenario: requireScenario(),
      userId: ownerMemberId,
    });
    const newOfferSends = offerSends.slice(sendBaseline);
    const nativeOfferIndex = newOfferSends.findIndex((request) =>
      requireLinqStub().readObservedMessageText(request)?.includes(
        "by-source sleep includes every available source's value and name",
      ) === true
    );
    expect(nativeOfferIndex).toBeGreaterThanOrEqual(0);
    expect(newOfferSends.map((request) =>
      requireLinqStub().readObservedMessageText(request)
    )).toContain(offerReplyText);

    const route = await requireScenario().readHostedThreadRoute({
      channel: "linq",
      threadId: groupChatId,
    });
    if (!route) {
      throw new Error("Expected the sleep-source room to have a durable group route.");
    }
    const newMessageIds = requireLinqStub().listObservedMessageIds(groupChatId)
      .slice(messageIdBaseline);
    const nativeOfferMessageId = newMessageIds[nativeOfferIndex];
    if (!nativeOfferMessageId) {
      throw new Error("Expected the native sleep-source offer message id.");
    }

    const personalVersionBeforeConsent = await readWorkspaceVersion(ownerMemberId);
    const reactionWebhook = await postSignedLinqWebhook(buildReactionEvent({
      messageId: nativeOfferMessageId,
    }));
    expect(reactionWebhook.status).toBe(202);
    await waitForWorkspaceVersionAdvance({
      baselineVersion: personalVersionBeforeConsent,
      userId: ownerMemberId,
    });

    await runManualCorrection({
      metric: "sleep-deep-minutes",
      ordinal: 1,
      stageLabel: "Deep",
      value: 60,
    });
    await runManualCorrection({
      metric: "sleep-deep-minutes",
      ordinal: 2,
      stageLabel: "Deep",
      value: 125,
    });
    await runManualCorrection({
      metric: "sleep-rem-minutes",
      ordinal: 3,
      stageLabel: "REM",
      value: 55,
    });
    await runManualCorrection({
      metric: "sleep-rem-minutes",
      ordinal: 4,
      stageLabel: "REM",
      value: 95,
    });

    for (const projectionKind of projectionKinds) {
      const ciphertext = await readHostedVaultShareProjectionCiphertextForTest({
        destinationMemberId: route.containerMemberId,
        environment: requireScenario().runtimeEnv,
        grantorMemberId: ownerMemberId,
        projectionKind,
      });
      expect(ciphertext).toMatch(/^\S+$/u);
      expect(ciphertext).not.toContain("fitbit");
      expect(ciphertext).not.toContain("garmin");
      expect(ciphertext).not.toContain("oura");
    }

    const providerRequestBaseline = requireScenario().assistantProviderRequests.length;
    const readSendBaseline = requireLinqStub().countObservedSends(groupReplyPath);
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("group", {
        action: "read_shared",
        projectionScopes: projectionKinds.map((projectionKind) => ({ projectionKind })),
      }),
      readReplyText,
    ], { matchInputContains: readRequestText });

    const readWebhook = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      ownerMemberId,
      groupChatId,
      {
        eventId: `evt_group_sleep_source_read_${runId}`,
        isGroup: true,
        messageId: `msg_group_sleep_source_read_${runId}`,
        service: "iMessage",
        text: readRequestText,
      },
    ));
    expect(readWebhook.status).toBe(202);
    await requireLinqStub().waitForMatchingSendCount({
      expectedCount: readSendBaseline + 1,
      expectedPath: groupReplyPath,
      scenario: requireScenario(),
      userId: route.containerMemberId,
    });
    const groupStatus = await requireScenario().waitForHostedCompletion(
      route.containerMemberId,
    );
    expect(groupStatus.lastErrorCode ?? null).toBeNull();

    const toolOutputs = requireScenario().assistantProviderRequests
      .slice(providerRequestBaseline)
      .flatMap((request) => collectJsonStrings(JSON.parse(request.body)))
      .filter((value) => value.includes(deepProjectionKind) && value.includes('"sources"'));
    expect(toolOutputs).toHaveLength(1);
    expect(toolOutputs[0]).toContain(deepProjectionKind);
    expect(toolOutputs[0]).toContain(remProjectionKind);
    expect(toolOutputs[0]).toContain('"source":"fitbit"');
    expect(toolOutputs[0]).toContain('"source":"garmin"');
    expect(toolOutputs[0]).toContain('"source":"manual"');
    expect(toolOutputs[0]).toContain('"label":"Manual"');
    expect(toolOutputs[0]).toContain('"source":"oura"');
    expect(toolOutputs[0]).toContain('"selected":true');
    expect(toolOutputs[0]).toContain('"value":125');
    expect(toolOutputs[0]).toContain('"value":95');
    expect(toolOutputs[0]).not.toContain('"value":60');
    expect(toolOutputs[0]).not.toContain('"value":55');
    expect(toolOutputs[0]).not.toContain('"source":"junction"');
  }, 600_000);
});

function buildActivationWake() {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${ownerMemberId}:group-sleep-source`,
    memberChannels: { email: false, linq: true, telegram: false },
    memberId: ownerMemberId,
    occurredAt: new Date().toISOString(),
  });
}

async function runManualCorrection(input: {
  metric: "sleep-deep-minutes" | "sleep-rem-minutes";
  ordinal: number;
  stageLabel: "Deep" | "REM";
  value: number;
}): Promise<void> {
  const requestText = `Correct ${input.stageLabel} sleep to ${input.value} minutes on ${sleepDate}.`;
  const workspaceVersion = await readWorkspaceVersion(ownerMemberId);
  const sendBaseline = requireLinqStub().countObservedSends(personalReplyPath);
  requireScenario().queueAssistantResponses([
    buildAssistantProviderVaultCliCall([
      "event",
      "observation",
      "add",
      "--metric",
      input.metric,
      "--value",
      String(input.value),
      "--unit",
      "minutes",
      "--occurred-at",
      sleepDate,
      "--title",
      `${input.stageLabel} sleep correction`,
    ]),
    correctionReplyText,
  ], { matchInputContains: requestText });

  const webhook = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
    ownerMemberId,
    personalChatId,
    {
      eventId: `evt_group_sleep_source_correction_${input.ordinal}_${runId}`,
      isGroup: false,
      messageId: `msg_group_sleep_source_correction_${input.ordinal}_${runId}`,
      service: "iMessage",
      text: requestText,
    },
  ));
  expect(webhook.status).toBe(202);
  const sends = await requireLinqStub().waitForMatchingSendCount({
    expectedCount: sendBaseline + 1,
    expectedPath: personalReplyPath,
    scenario: requireScenario(),
    userId: ownerMemberId,
  });
  expect(sends.slice(sendBaseline).map((request) =>
    requireLinqStub().readObservedMessageText(request)
  )).toContain(correctionReplyText);
  await waitForWorkspaceVersionAdvance({
    baselineVersion: workspaceVersion,
    userId: ownerMemberId,
  });
}

async function seedPersonalSleepSourceSnapshot(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-group-sleep-source-e2e-"));
  cleanupPaths.push(root);
  const operatorHomeRoot = path.join(root, "operator-home");
  const vaultRoot = path.join(root, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });
  await createIntegratedVaultServices().core.init({
    requestId: `seed-group-sleep-source-${runId}`,
    timezone: "UTC",
    vault: vaultRoot,
  });

  const providers = [
    { provider: "fitbit", value: 74 },
    { provider: "garmin", value: 91 },
    { provider: "oura", value: 108 },
  ] as const;
  const wearableRecords = providers.flatMap(({ provider, value }, index) => {
    const recordedAt = `${sleepDate}T07:0${index}:00.000Z`;
    const externalRef = {
      system: "junction",
      resourceType: "sleep",
      resourceId: `group_sleep_source_${index}_${runId}`,
    };
    const dataOrigin = {
      aggregatorProvider: "junction",
      originConfidence: "high",
      sourceProviderSlug: provider,
      version: 1,
    };
    return [
      {
        schemaVersion: "murph.event.v1",
        id: `evt_group_sleep_source_session_${index}_${runId}`,
        kind: "sleep_session",
        occurredAt: `${sleepDate}T07:00:00.000Z`,
        recordedAt,
        dayKey: sleepDate,
        source: "device",
        title: "Overnight sleep",
        startAt: `${sleepDate}T00:00:00.000Z`,
        endAt: `${sleepDate}T07:00:00.000Z`,
        durationMinutes: 420,
        dataOrigin,
        externalRef,
      },
      {
        schemaVersion: "murph.event.v1",
        id: `evt_group_sleep_source_deep_${index}_${runId}`,
        kind: "observation",
        occurredAt: `${sleepDate}T07:00:00.000Z`,
        recordedAt,
        dayKey: sleepDate,
        source: "device",
        title: "Deep sleep",
        metric: "sleep-deep-minutes",
        value,
        unit: "minutes",
        dataOrigin,
        externalRef,
      },
      {
        schemaVersion: "murph.event.v1",
        id: `evt_group_sleep_source_rem_${index}_${runId}`,
        kind: "observation",
        occurredAt: `${sleepDate}T07:00:00.000Z`,
        recordedAt,
        dayKey: sleepDate,
        source: "device",
        title: "REM sleep",
        metric: "sleep-rem-minutes",
        value: value - 20,
        unit: "minutes",
        dataOrigin,
        externalRef,
      },
    ];
  });
  await mkdir(path.join(vaultRoot, "ledger", "events", sleepDate.slice(0, 4)), {
    recursive: true,
  });
  await writeFile(
    path.join(
      vaultRoot,
      "ledger",
      "events",
      sleepDate.slice(0, 4),
      `${sleepDate.slice(0, 7)}.jsonl`,
    ),
    `${wearableRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );

  const snapshot = await snapshotHostedExecutionContext({ operatorHomeRoot, vaultRoot });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  const snapshotRef = createSnapshotBundleRef(hash, snapshot.bundle.byteLength);
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: createBrowserVaultReplicaRef(hash),
    environment: requireScenario().runtimeEnv,
    snapshotRef,
    userId: ownerMemberId,
  });
  expect(checkpoint.status).toBe("updated");

  const uploadResponse = await requireScenario().harness.request(
    `/__test/artifacts?userId=${encodeURIComponent(ownerMemberId)}&sha256=${hash}`,
    {
      body: new Blob([new Uint8Array(snapshot.bundle)]),
      headers: { [HOSTED_EXECUTION_USER_ID_HEADER]: ownerMemberId },
      method: "PUT",
    },
  );
  expect(uploadResponse.status).toBe(200);
}

function buildReactionEvent(input: { messageId: string }): Record<string, unknown> {
  return {
    api_version: "v3",
    created_at: new Date().toISOString(),
    data: {
      chat_id: groupChatId,
      from_handle: { handle: ownerPhone, service: "iMessage" },
      is_from_me: false,
      line: { phone_number: homePhone },
      message_id: input.messageId,
      reacted_at: new Date().toISOString(),
      reaction_type: "like",
    },
    event_id: `evt_group_sleep_source_reaction_${runId}`,
    event_type: "reaction.added",
    trace_id: `trace_group_sleep_source_${runId}`,
    webhook_version: "2026-02-03",
  };
}

async function readWorkspaceVersion(userId: string): Promise<bigint> {
  const version = (await requireScenario().harness.readUserStatus(userId)).workspace?.version;
  if (!version) {
    throw new Error("Expected a workspace version before sleep-source consent.");
  }
  return BigInt(version);
}

async function waitForWorkspaceVersionAdvance(input: {
  baselineVersion: bigint;
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 240_000) {
    const status = await requireScenario().harness.readUserStatus(input.userId);
    const version = status.workspace?.version ? BigInt(status.workspace.version) : null;
    if (
      version !== null
      && version > input.baselineVersion
      && !status.inFlight
      && !status.lastErrorCode
      && status.mailboxLag.every((lane) => lane.lag === "0")
    ) {
      return;
    }
    await sleep(250);
  }
  throw new Error(await requireScenario().buildFailureMessage(input.userId, [
    "Timed out waiting for the post-consent maintenance checkpoint.",
  ]));
}

function createSnapshotBundleRef(hash: string, size: number): HostedExecutionSnapshotRef {
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size,
    updatedAt: new Date().toISOString(),
  };
}

function createBrowserVaultReplicaRef(
  sourceBundleHash: string,
): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `group-sleep-source-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:group-sleep-source",
    objectKey: `browser-vault/${ownerMemberId}/group-sleep-source.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:group-sleep-source",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": `sha256=${signature}`,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectJsonStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectJsonStrings);
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) throw new Error("Hosted local Linq stub was not initialized.");
  return linqStub;
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) throw new Error("Hosted local full-stack scenario was not initialized.");
  return scenario;
}
