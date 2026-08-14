import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listHostedRuntimeLogsForTest,
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import {
  updateAssistantPreferences,
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePersistenceInput,
  type HostedCanonicalWriteReceiptAction,
} from "@murphai/core";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS,
} from "@murphai/hosted-execution/runtime-control";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import { createIntegratedVaultServices } from "@murphai/vault-usecases/vault-services";

import { hostedBrowserVaultReplicaObjectKey } from "../src/storage-paths.js";
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
} from "./helpers/hosted-local-linq-support.js";

const runId = Date.now();
const userId = `member_local_canonical_lost_ack_${runId}`;
const chatId = `chat_local_canonical_lost_ack_${runId}`;
const preferenceRecoveryUserId = `member_local_preference_receipt_recovery_${runId}`;
const preferenceRecoveryChatId = `chat_local_preference_receipt_recovery_${runId}`;
const automationSlug = `canonical-receipt-probe-${runId}`;
const inboundText = "Save a durable canonical receipt recovery probe.";
const replyText = "The durable recovery probe is saved.";
const preferenceRecoveryInboundText =
  "Confirm that my saved assistant preferences no longer block this conversation.";
const preferenceRecoveryReplyText =
  "Your saved preferences are restored and this conversation can continue.";
const linqApiToken = "linq-local-test-token";
const linqWebhookSecret = "linq-local-canonical-lost-ack-secret";
const assistantModel = "gpt-5.6-terra";
const lostAckLogMessage =
  "Hosted-local test dropped a canonical checkpoint acknowledgement after the real checkpoint committed.";

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;
const cleanupPaths: string[] = [];

afterAll(async () => {
  await scenario?.stop();
  scenario = null;
  await linqStub?.stop();
  linqStub = null;
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
}, 120_000);

describe("hosted local canonical receipt lost-ack recovery e2e", () => {
  beforeAll(async () => {
    linqStub = await startHostedLocalLinqStub({
      expectedAuthorizationToken: linqApiToken,
    });
    scenario = await startHostedLocalFullStackScenario({
      additionalEnv: {
        HOSTED_ASSISTANT_MODEL: assistantModel,
        HOSTED_ASSISTANT_PROVIDER: "openai",
        HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "10000",
        HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
        HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
          [
            buildLinqRecipientPhoneNumber(userId),
            buildLinqRecipientPhoneNumber(preferenceRecoveryUserId),
          ].join(","),
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
      persistDirPrefix: "murph-hosted-local-canonical-lost-ack-",
      requiredRunnerEnvProfile: "linq",
      scenarioLabel: "Local hosted canonical receipt lost-ack recovery e2e",
      streamLogs: streamDevLogs,
      testControls: true,
    });
  }, 300_000);

  it("reconciles the exact canonical checkpoint successor after its committed response is lost", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(userId),
      memberId: userId,
      memberPhone,
    });
    await requireScenario().runWake(buildActivationWake(userId), userId);
    const activationStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(activationStatus.workspace).not.toBeNull();
    const activationWorkspaceVersion = BigInt(activationStatus.workspace!.version);
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId,
      memberId: userId,
      recipientPhone: memberPhone,
    });

    const replyPath = `/chats/${encodeURIComponent(chatId)}/messages`;
    const outboundBaseline = requireLinqStub().countObservedSends(replyPath);
    const providerBaseline = countResponsesApiRequests();
    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const automationStateMarker = buildCanonicalAutomationStateMarker({
      dueAt,
    });
    requireScenario().queueAssistantResponses([
      buildAssistantProviderMurphToolCall("automation", {
        action: "save",
        continuityPolicy: "fresh",
        instructions: "Record the hosted canonical checkpoint recovery probe.",
        schedule: { at: dueAt, kind: "at" },
        slug: automationSlug,
        summary: "Hosted canonical checkpoint recovery probe.",
        tags: ["assistant"],
        title: "Canonical receipt recovery probe",
      }),
      buildAssistantProviderShellCommandCall(
        buildCanonicalAutomationStateProbeCommand({
          dueAt,
          marker: automationStateMarker,
        }),
      ),
      replyText,
    ], {
      matchInputContains: inboundText,
    });

    await requireScenario().harness.armCanonicalCheckpointLostAckForTest(userId);
    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      userId,
      chatId,
      {
        eventId: `evt_canonical_lost_ack_${runId}`,
        messageId: `msg_canonical_lost_ack_${runId}`,
        text: inboundText,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const reply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(replyText);

    const finalStatus = await requireScenario().waitForHostedCompletion(userId);
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalStatus.workspace).not.toBeNull();
    expect(BigInt(finalStatus.workspace!.version)).toBeGreaterThan(activationWorkspaceVersion);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(outboundBaseline + 1);

    const providerRequests = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(providerBaseline);
    const providerRequestText = providerRequests
      .map(readAssistantProviderRequestText)
      .join("\n\n");
    expect(providerRequestText).toContain(automationSlug);
    expect(providerRequestText).toContain(automationStateMarker);

    const faultLogs = [
      requireScenario().harness.stdoutTail(2_000_000),
      requireScenario().harness.stderrTail(2_000_000),
    ].join("\n");
    expect(countOccurrences(faultLogs, lostAckLogMessage)).toBe(1);
  }, 420_000);

  it("cold-restores the two-preference audit drift incident without blocking foreground reply", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(preferenceRecoveryUserId);
    const replyPath = `/chats/${encodeURIComponent(preferenceRecoveryChatId)}/messages`;
    await requireScenario().seedActiveHostedLinqMember({
      homePhone: buildLinqHomePhoneNumber(preferenceRecoveryUserId),
      memberId: preferenceRecoveryUserId,
      memberPhone,
    });
    await requireScenario().bindActiveHostedLinqHomeChat({
      chatId: preferenceRecoveryChatId,
      memberId: preferenceRecoveryUserId,
      recipientPhone: memberPhone,
    });

    const fixture = await seedPreferenceReceiptRecoveryIncident();
    const outboundBaseline = requireLinqStub().countObservedSends(replyPath);
    const providerBaseline = countResponsesApiRequests();
    requireScenario().queueAssistantResponses([
      buildAssistantProviderShellCommandCall(
        buildPreferenceRecoveryStateProbeCommand(fixture),
      ),
      preferenceRecoveryReplyText,
    ], {
      matchInputContains: preferenceRecoveryInboundText,
    });

    const webhookResponse = await postSignedLinqWebhook(buildHostedLinqInboundEvent(
      preferenceRecoveryUserId,
      preferenceRecoveryChatId,
      {
        eventId: `evt_preference_receipt_recovery_${runId}`,
        messageId: `msg_preference_receipt_recovery_${runId}`,
        text: preferenceRecoveryInboundText,
      },
    ));
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(preferenceRecoveryUserId);
    const reply = await requireLinqStub().waitForAdditionalSend({
      baselineCount: outboundBaseline,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId: preferenceRecoveryUserId,
    });
    expect(requireLinqStub().readObservedMessageText(reply)).toBe(
      preferenceRecoveryReplyText,
    );

    const finalStatus = await requireScenario().waitForHostedCompletion(
      preferenceRecoveryUserId,
    );
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalStatus.workspace).not.toBeNull();
    expect(BigInt(finalStatus.workspace!.version)).toBeGreaterThan(fixture.seededVersion);
    expect(requireLinqStub().countObservedSends(replyPath)).toBe(outboundBaseline + 1);

    const providerRequestText = requireScenario().assistantProviderRequests
      .filter((request) => request.url === "/v1/responses")
      .slice(providerBaseline)
      .map(readAssistantProviderRequestText)
      .join("\n\n");
    expect(providerRequestText).toContain(
      `PREFERENCE_RECOVERY_PREFERENCES_SHA256=${fixture.expectedPreferencesSha256}`,
    );
    expect(providerRequestText).toContain(
      `PREFERENCE_RECOVERY_MUTATIONS_SHA256=${fixture.expectedMutationsSha256}`,
    );
    for (const auditId of fixture.auditIds) {
      expect(providerRequestText).toContain(
        `PREFERENCE_RECOVERY_AUDIT_${auditId}=1`,
      );
    }
    expect(providerRequestText).toContain("PREFERENCE_RECOVERY_PREFERENCE_AUDIT_COUNT=2");
    expect(providerRequestText).toContain("PREFERENCE_RECOVERY_UNIQUE_PREFERENCE_AUDIT_COUNT=2");

    const finalRedactedStatus = finalStatus.workspace?.redactedStatus ?? {};
    for (const key of HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS) {
      expect(Object.hasOwn(finalRedactedStatus, key)).toBe(false);
    }
    expect(Object.hasOwn(finalRedactedStatus, "hostedCanonicalWriteReceiptLogEntryCount"))
      .toBe(false);

    const runtimeLogs = await listHostedRuntimeLogsForTest({
      environment: requireScenario().runtimeEnv,
      limit: 1_500,
      userId: preferenceRecoveryUserId,
    });
    expect(runtimeLogs.some((entry) =>
      entry.redactedJson?.canonicalWriteReceiptRecoveryFailed === 1
    )).toBe(false);
  }, 420_000);
});

type HostedAuditAppendAction = Extract<
  HostedCanonicalWriteReceiptAction,
  { kind: "jsonl_append" }
>;

interface CapturedHostedAuditAppend {
  action: HostedAuditAppendAction;
  auditId: string;
  bytes: Uint8Array;
}

interface PreferenceReceiptRecoveryFixture {
  auditIds: readonly [string, string];
  auditRelativePath: string;
  expectedMutationsSha256: string;
  expectedPreferencesSha256: string;
  seededVersion: bigint;
}

async function seedPreferenceReceiptRecoveryIncident(): Promise<
  PreferenceReceiptRecoveryFixture
> {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "murph-preference-receipt-recovery-"),
  );
  cleanupPaths.push(fixtureRoot);
  const operatorHomeRoot = path.join(fixtureRoot, "operator-home");
  const vaultRoot = path.join(fixtureRoot, "vault");
  await mkdir(operatorHomeRoot, { recursive: true });
  await createIntegratedVaultServices().core.init({
    requestId: `seed-preference-receipt-recovery-${runId}`,
    timezone: "America/New_York",
    vault: vaultRoot,
  });

  const capturedWrites: HostedCanonicalWritePersistenceInput[] = [];
  const preferenceUpdatedAt = new Date().toISOString();
  await withHostedCanonicalWritePort({
    async persistCanonicalWrite(input) {
      capturedWrites.push(cloneCanonicalWritePersistenceInput(input));
    },
  }, async () => {
    await updateAssistantPreferences({
      causalOrigin: "event",
      causalSeq: "4",
      preferences: {
        tone: "casual",
      },
      updatedAt: preferenceUpdatedAt,
      vaultRoot,
    });
    await updateAssistantPreferences({
      causalOrigin: "event",
      causalSeq: "6",
      preferences: {
        voice: "warm",
      },
      updatedAt: preferenceUpdatedAt,
      vaultRoot,
    });
  });
  if (capturedWrites.length !== 2) {
    throw new Error("Preference receipt recovery fixture requires exactly two canonical writes.");
  }

  const firstAudit = readCapturedHostedAuditAppend(capturedWrites[0]!);
  const secondAudit = readCapturedHostedAuditAppend(capturedWrites[1]!);
  if (firstAudit.action.targetRelativePath !== secondAudit.action.targetRelativePath) {
    throw new Error("Preference receipt recovery fixture audit writes must share one shard.");
  }
  const auditRelativePath = firstAudit.action.targetRelativePath;
  const auditAbsolutePath = path.join(vaultRoot, auditRelativePath);
  const finalAuditBytes = new Uint8Array(await readFile(auditAbsolutePath));
  const firstOriginalSize = firstAudit.action.originalSize;
  if (firstOriginalSize === null) {
    throw new Error("Preference receipt recovery fixture requires an existing audit base.");
  }
  const auditBaseBytes = finalAuditBytes.slice(0, firstOriginalSize);
  if (
    sha256Hex(auditBaseBytes) !== firstAudit.action.baseSha256
    || auditBaseBytes.byteLength !== firstAudit.action.baseByteLength
  ) {
    throw new Error("Preference receipt recovery fixture audit base does not match receipt one.");
  }
  const expectedOriginalAuditBytes = concatenateBytes(
    auditBaseBytes,
    firstAudit.bytes,
    secondAudit.bytes,
  );
  if (!Buffer.from(finalAuditBytes).equals(Buffer.from(expectedOriginalAuditBytes))) {
    throw new Error("Preference receipt recovery fixture did not produce ordered audit appends.");
  }

  const incidentAuditBytes = concatenateBytes(auditBaseBytes, secondAudit.bytes);
  const expectedRecoveredAuditBytes = concatenateBytes(
    incidentAuditBytes,
    firstAudit.bytes,
  );
  assertAuditIdCount(incidentAuditBytes, firstAudit.auditId, 0);
  assertAuditIdCount(incidentAuditBytes, secondAudit.auditId, 1);
  assertAuditIdCount(expectedRecoveredAuditBytes, firstAudit.auditId, 1);
  assertAuditIdCount(expectedRecoveredAuditBytes, secondAudit.auditId, 1);
  await writeFile(auditAbsolutePath, incidentAuditBytes);

  const preferencesBytes = new Uint8Array(
    await readFile(path.join(vaultRoot, "bank/preferences.json")),
  );
  const mutationsBytes = new Uint8Array(
    await readFile(path.join(vaultRoot, "bank/assistant-preference-mutations.json")),
  );
  assertPreferenceFixtureDocuments(preferencesBytes, mutationsBytes);

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  const snapshotHash = sha256HostedBundleHex(snapshot.bundle);
  const snapshotRef = createSnapshotBundleRef({
    hash: snapshotHash,
    size: snapshot.bundle.byteLength,
  });
  const receiptArtifacts = capturedWrites.map((write) =>
    createJsonArtifact(write.receipt)
  );
  const receiptLogArtifact = createJsonArtifact({
    entries: receiptArtifacts.map((artifact) => artifact.ref),
    schema: "murph.hosted-canonical-write-receipt-log.v1",
  });
  const artifactsBySha256 = new Map<string, Uint8Array>();
  addArtifact(artifactsBySha256, snapshotHash, new Uint8Array(snapshot.bundle));
  for (const write of capturedWrites) {
    for (const payload of write.payloads) {
      addArtifact(artifactsBySha256, payload.sha256, payload.bytes);
    }
  }
  for (const receiptArtifact of receiptArtifacts) {
    addArtifact(
      artifactsBySha256,
      receiptArtifact.ref.sha256,
      receiptArtifact.bytes,
    );
  }
  addArtifact(
    artifactsBySha256,
    receiptLogArtifact.ref.sha256,
    receiptLogArtifact.bytes,
  );
  const checkpoint = await seedHostedWorkspaceCheckpointForTest({
    browserVaultReplicaRef: await createPreferenceRecoveryBrowserVaultReplicaRef(
      snapshotHash,
    ),
    environment: requireScenario().runtimeEnv,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: {
      [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY]:
        receiptLogArtifact.ref.byteSize,
      [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY]:
        receiptLogArtifact.ref.sha256,
    },
    snapshotRef,
    userId: preferenceRecoveryUserId,
  });
  expect(checkpoint.status).toBe("updated");
  for (const [sha256, bytes] of artifactsBySha256) {
    await uploadHostedArtifact(preferenceRecoveryUserId, sha256, bytes);
  }

  for (const [sha256, bytes] of artifactsBySha256) {
    await uploadHostedArtifact(preferenceRecoveryUserId, sha256, bytes);
  }

  return {
    auditIds: [firstAudit.auditId, secondAudit.auditId],
    auditRelativePath,
    expectedMutationsSha256: sha256Hex(mutationsBytes),
    expectedPreferencesSha256: sha256Hex(preferencesBytes),
    seededVersion: BigInt(checkpoint.version),
  };
}

function cloneCanonicalWritePersistenceInput(
  input: HostedCanonicalWritePersistenceInput,
): HostedCanonicalWritePersistenceInput {
  return {
    payloads: input.payloads.map((payload) => ({
      byteLength: payload.byteLength,
      bytes: new Uint8Array(payload.bytes),
      sha256: payload.sha256,
    })),
    receipt: structuredClone(input.receipt),
  };
}

function readCapturedHostedAuditAppend(
  write: HostedCanonicalWritePersistenceInput,
): CapturedHostedAuditAppend {
  const auditActions = write.receipt.actions.filter(
    (action): action is HostedAuditAppendAction =>
      action.kind === "jsonl_append"
      && action.targetRelativePath.startsWith("audit/"),
  );
  if (auditActions.length !== 1) {
    throw new Error("Preference receipt recovery write requires one audit append.");
  }
  const action = auditActions[0]!;
  const payload = write.payloads.find((candidate) =>
    candidate.sha256 === action.appendSha256
    && candidate.byteLength === action.appendByteLength
  );
  if (!payload) {
    throw new Error("Preference receipt recovery audit payload is unavailable.");
  }
  const parsed: unknown = JSON.parse(Buffer.from(payload.bytes).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Preference receipt recovery audit payload must be an object.");
  }
  const auditId = (parsed as Record<string, unknown>).id;
  if (typeof auditId !== "string" || !/^aud_[0-9A-Za-z]+$/u.test(auditId)) {
    throw new Error("Preference receipt recovery audit payload has an invalid id.");
  }
  return {
    action,
    auditId,
    bytes: new Uint8Array(payload.bytes),
  };
}

function assertPreferenceFixtureDocuments(
  preferencesBytes: Uint8Array,
  mutationsBytes: Uint8Array,
): void {
  const preferences = parseJsonObject(Buffer.from(preferencesBytes).toString("utf8"));
  const assistant = readRecord(preferences.assistant);
  if (assistant?.tone !== "casual" || assistant.voice !== "warm") {
    throw new Error("Preference receipt recovery fixture has unexpected assistant preferences.");
  }
  const mutations = parseJsonObject(Buffer.from(mutationsBytes).toString("utf8"));
  const applied = readRecord(mutations.applied);
  if (applied?.tone !== "4" || applied.voice !== "6") {
    throw new Error("Preference receipt recovery fixture has unexpected causal watermarks.");
  }
}

function assertAuditIdCount(bytes: Uint8Array, auditId: string, expected: number): void {
  const actual = Buffer.from(bytes).toString("utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => parseJsonObject(line).id)
    .filter((id) => id === auditId)
    .length;
  if (actual !== expected) {
    throw new Error(
      `Preference receipt recovery fixture expected audit id count ${expected}, got ${actual}.`,
    );
  }
}

function createJsonArtifact(value: unknown): {
  bytes: Uint8Array;
  ref: {
    byteSize: number;
    sha256: string;
  };
} {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  return {
    bytes,
    ref: {
      byteSize: bytes.byteLength,
      sha256: sha256Hex(bytes),
    },
  };
}

function addArtifact(
  artifactsBySha256: Map<string, Uint8Array>,
  sha256: string,
  bytes: Uint8Array,
): void {
  if (sha256Hex(bytes) !== sha256) {
    throw new Error("Preference receipt recovery artifact hash does not match its key.");
  }
  const existing = artifactsBySha256.get(sha256);
  if (existing && !Buffer.from(existing).equals(Buffer.from(bytes))) {
    throw new Error("Preference receipt recovery artifact hash collision detected.");
  }
  artifactsBySha256.set(sha256, new Uint8Array(bytes));
}

async function uploadHostedArtifact(
  memberId: string,
  sha256: string,
  bytes: Uint8Array,
): Promise<void> {
  const search = new URLSearchParams({
    sha256,
    userId: memberId,
  });
  const response = await requireScenario().harness.request(
    `/__test/artifacts?${search.toString()}`,
    {
      body: new Blob([new Uint8Array(bytes)]),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: memberId,
      },
      method: "PUT",
    },
  );
  expect(response.status).toBe(200);
}

function createSnapshotBundleRef(input: {
  hash: string;
  size: number;
}): HostedExecutionSnapshotRef {
  return {
    hash: input.hash,
    key: `cloudflare-workspace-snapshots/${input.hash}.bundle`,
    size: input.size,
    updatedAt: new Date().toISOString(),
  };
}

async function createPreferenceRecoveryBrowserVaultReplicaRef(
  sourceBundleHash: string,
): Promise<HostedBrowserVaultReplicaRef> {
  const dataVersion = `preference-receipt-${sourceBundleHash.slice(0, 16)}`;
  const generatedAt = new Date().toISOString();
  return {
    byteLength: 256,
    dataVersion,
    generatedAt,
    keyId: "browser-vault-replica:preference-receipt-recovery",
    objectKey: await hostedBrowserVaultReplicaObjectKey({
      dataVersion,
      generatedAt,
      userId: preferenceRecoveryUserId,
    }),
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:preference-receipt-recovery",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function buildPreferenceRecoveryStateProbeCommand(
  fixture: PreferenceReceiptRecoveryFixture,
): string {
  const script = [
    'const crypto = require("node:crypto");',
    'const fs = require("node:fs");',
    `const auditPath = ${JSON.stringify(fixture.auditRelativePath)};`,
    `const ids = ${JSON.stringify(fixture.auditIds)};`,
    'const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");',
    'const preferences = fs.readFileSync("bank/preferences.json");',
    'const mutations = fs.readFileSync("bank/assistant-preference-mutations.json");',
    'const records = fs.readFileSync(auditPath, "utf8").split(/\\r?\\n/u).filter(Boolean).map((line) => JSON.parse(line));',
    'const preferenceAudits = records.filter((record) => record.commandName === "core.updateAssistantPreferences");',
    'console.log("PREFERENCE_RECOVERY_PREFERENCES_SHA256=" + hash(preferences));',
    'console.log("PREFERENCE_RECOVERY_MUTATIONS_SHA256=" + hash(mutations));',
    'for (const id of ids) console.log("PREFERENCE_RECOVERY_AUDIT_" + id + "=" + records.filter((record) => record.id === id).length);',
    'console.log("PREFERENCE_RECOVERY_PREFERENCE_AUDIT_COUNT=" + preferenceAudits.length);',
    'console.log("PREFERENCE_RECOVERY_UNIQUE_PREFERENCE_AUDIT_COUNT=" + new Set(preferenceAudits.map((record) => record.id)).size);',
  ].join("");
  return `node -e ${quoteShellArgument(script)}`;
}

function buildCanonicalAutomationStateMarker(input: { dueAt: string }): string {
  return [
    "CANONICAL_AUTOMATION_STATE",
    automationSlug,
    input.dueAt,
    chatId,
    "audit=1",
  ].join("|");
}

function buildCanonicalAutomationStateProbeCommand(input: {
  dueAt: string;
  marker: string;
}): string {
  const script = [
    'const fs = require("node:fs");',
    'const { execFileSync } = require("node:child_process");',
    `const slug = ${JSON.stringify(automationSlug)};`,
    `const dueAt = ${JSON.stringify(input.dueAt)};`,
    `const chatId = ${JSON.stringify(chatId)};`,
    `const marker = ${JSON.stringify(input.marker)};`,
    'const shown = JSON.parse(execFileSync("vault-cli", ["automation", "show", slug, "--format", "json"], { encoding: "utf8" }));',
    'const automation = shown && (shown.data || shown).automation;',
    'if (!automation || automation.slug !== slug || automation.status !== "active" || automation.continuityPolicy !== "fresh") throw new Error("Canonical automation readback mismatch.");',
    'if (automation.instructions !== "Record the hosted canonical checkpoint recovery probe." || automation.title !== "Canonical receipt recovery probe" || automation.summary !== "Hosted canonical checkpoint recovery probe.") throw new Error("Canonical automation content mismatch.");',
    'if (!automation.schedule || automation.schedule.kind !== "at" || automation.schedule.at !== dueAt) throw new Error("Canonical automation schedule mismatch.");',
    'if (!automation.route || automation.route.channel !== "linq" || automation.route.deliveryTarget !== chatId || automation.route.threadId !== chatId) throw new Error("Canonical automation route mismatch.");',
    'if (!Array.isArray(automation.tags) || !automation.tags.includes("assistant")) throw new Error("Canonical automation tags mismatch.");',
    'const auditRecords = fs.readdirSync("audit", { recursive: true }).filter((entry) => typeof entry === "string" && entry.endsWith(".jsonl")).flatMap((entry) => fs.readFileSync("audit/" + entry, "utf8").split(/\\r?\\n/u).filter(Boolean).map((line) => JSON.parse(line)));',
    'const matchingAudits = auditRecords.filter((record) => record.commandName === "core.upsertAutomation" && Array.isArray(record.targetIds) && record.targetIds.includes(automation.automationId));',
    'if (matchingAudits.length !== 1) throw new Error("Canonical automation audit count mismatch.");',
    'console.log(marker);',
  ].join("");
  return `node -e ${quoteShellArgument(script)}`;
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function concatenateBytes(...values: readonly Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(values.map((value) => Buffer.from(value))));
}

function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  const record = readRecord(parsed);
  if (!record) {
    throw new Error("Expected JSON object.");
  }
  return record;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function postSignedLinqWebhook(event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", linqWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return await fetch(`${requireScenario().harness.webBaseUrl}/api/hosted-onboarding/linq/webhook`, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-webhook-signature": `sha256=${signature}`,
      "x-webhook-timestamp": timestamp,
    },
    method: "POST",
  });
}

function readAssistantProviderRequestText(request: { body: string }): string {
  return collectJsonStrings(JSON.parse(request.body)).join("\n\n");
}

function collectJsonStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectJsonStrings(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectJsonStrings(entry));
  }
  return [];
}

function countResponsesApiRequests(): number {
  return requireScenario().assistantProviderRequests
    .filter((request) => request.url === "/v1/responses").length;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function buildActivationWake(memberId: string) {
  return buildHostedExecutionMemberActivatedWake({
    eventId: `member.activated:local:${memberId}:evt_canonical_lost_ack`,
    memberChannels: {
      email: false,
      linq: true,
      telegram: false,
    },
    memberId,
    occurredAt: new Date().toISOString(),
  });
}

function requireScenario(): HostedLocalFullStackScenario {
  if (!scenario) {
    throw new Error("Hosted local canonical lost-ack scenario was not started.");
  }
  return scenario;
}

function requireLinqStub(): HostedLocalLinqStub {
  if (!linqStub) {
    throw new Error("Hosted local canonical lost-ack Linq stub was not started.");
  }
  return linqStub;
}
