import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import path from "node:path";

import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedExecutionMemberActivatedWake,
} from "@murphai/hosted-execution";
import type {
  HostedBrowserVaultReplicaRef,
  HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeLogEntry,
} from "@murphai/hosted-execution/runtime-control";
import {
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  seedHostedWorkspaceCheckpointForTest,
} from "#hosted-web-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildHostedAssistantNotificationDecisionResponse,
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

const userId = `member_local_snapshot_stress_${Date.now()}`;
const replyText = "Got it - snapshot stress reply delivered.";
const linqWebhookSecret = "linq-local-snapshot-stress-secret";
const productionLikeAssistantModel = "gpt-5.5";
const stressCodexThreadId = "00000000-0000-4000-8000-000000000025";
const stressCodexRolloutRelativePath =
  `sessions/2026/05/05/rollout-2026-05-05T01-02-03-${stressCodexThreadId}.jsonl`;

const stressConversationCount = readPositiveIntegerEnv(
  "MURPH_E2E_SNAPSHOT_STRESS_CONVERSATIONS",
  36,
);
const stressTranscriptBytes = readPositiveIntegerEnv(
  "MURPH_E2E_SNAPSHOT_STRESS_TRANSCRIPT_BYTES",
  512 * 1024,
);
const stressCodexSessionBytes = readPositiveIntegerEnv(
  "MURPH_E2E_SNAPSHOT_STRESS_CODEX_BYTES",
  512 * 1024,
);
const stressVaultFileCount = readPositiveIntegerEnv("MURPH_E2E_SNAPSHOT_STRESS_VAULT_FILES", 8);
const stressVaultFileBytes = readPositiveIntegerEnv(
  "MURPH_E2E_SNAPSHOT_STRESS_VAULT_FILE_BYTES",
  128 * 1024,
);

const streamDevLogs = process.env.MURPH_E2E_STREAM_DEV_LOGS === "1";
const workerPersistDirOverride = process.env.MURPH_E2E_CF_PERSIST_DIR?.trim() || null;
const localDatabaseUrl = process.env.DATABASE_URL?.trim() || undefined;

const cleanupPaths: string[] = [];
let linqStub: HostedLocalLinqStub | null = null;
let scenario: HostedLocalFullStackScenario | null = null;

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

describe("hosted local snapshot stress e2e", () => {
  beforeAll(async () => {
    await startScenario();
  }, 300_000);

  it("measures signed Linq webhook to reply latency with a large restored Codex workspace", async () => {
    const memberPhone = buildLinqRecipientPhoneNumber(userId);
    const homePhone = buildLinqHomePhoneNumber(userId);
    await requireScenario().seedActiveHostedLinqMember({
      homePhone,
      memberId: userId,
      memberPhone,
    });

    const snapshot = await createSnapshotStressFixture();
    const checkpoint = await seedHostedWorkspaceCheckpointForTest({
      browserVaultReplicaRef: createBrowserVaultReplicaRef(snapshot.hash),
      environment: requireScenario().runtimeEnv,
      redactedStatusJson: {
        seededSnapshotStress: true,
        stressCodexSessionBytes,
        stressConversationCount,
        stressTranscriptBytes,
        stressVaultFileBytes,
        stressVaultFileCount,
      },
      snapshotRef: createSnapshotBundleRef({
        hash: snapshot.hash,
        size: snapshot.bytes.byteLength,
      }),
      userId,
    });
    expect(checkpoint.status).toBe("updated");
    await uploadHostedSnapshotArtifact(snapshot);

    await requireScenario().runWake(
      buildHostedExecutionMemberActivatedWake({
        eventId: `member.activated:snapshot-stress:${userId}`,
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
    const activationStatus = await requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: 420_000,
    });
    const importSnapshot = findLargestCheckpointLogOrNull(activationStatus.recentLogs, {
      eventCode: "checkpoint.snapshot_finished",
      reason: ["import", "system_mailbox_receipt"],
    });
    if (!importSnapshot) {
      expect(hasCheckpointLog(activationStatus.recentLogs, {
        eventCode: "checkpoint.runtime_residue_deferred",
        reason: ["activation_bootstrap", "system_mailbox_receipt"],
      })).toBe(true);
    }

    requireScenario().queueAssistantResponses([
      buildHostedAssistantNotificationDecisionResponse({
        privateSummary: "deliver snapshot stress welcome",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      }),
    ]);
    await requireScenario().runWake(
      buildHostedLinqSignupWelcomeWake({
        eventId: `assistant.notification.requested:snapshot-stress:${userId}`,
        userId,
      }),
      userId,
    );
    await requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: 420_000,
    });
    await requireLinqStub().waitForSend({
      expectedPath: requireLinqStub().createChatPath,
      matchRequest: requireLinqStub().createCreateChatRequestMatcher(userId),
      scenario: requireScenario(),
      userId,
    });

    const materializedChatId = requireLinqStub().requireObservedChatId(userId);
    const replyPath = `/chats/${encodeURIComponent(materializedChatId)}/messages`;
    const baselineReplyCount = requireLinqStub().countObservedSends(replyPath);
    const beforeInboundStatus = await requireScenario().harness.readUserStatus(userId);
    const beforeInboundWorkspaceVersion = beforeInboundStatus.workspace?.version ?? null;
    expect(beforeInboundWorkspaceVersion).not.toBeNull();
    requireScenario().queueAssistantResponses([replyText]);
    const inboundReplyLatencyStartedAt = performance.now();
    const webhookResponse = await postSignedLinqWebhook(
      buildHostedLinqInboundEvent(userId, materializedChatId, {
        eventId: `evt_snapshot_stress_${userId}`,
        messageId: `msg_snapshot_stress_${userId}`,
        text: "Can you reply after restoring this large local hosted workspace?",
      }),
    );
    expect(webhookResponse.status).toBe(202);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    await requireScenario().waitForLatestPendingWake(userId);
    const completionPromise = requireScenario().waitForHostedCompletion(userId, {
      timeoutMs: 420_000,
    });
    const sendRequest = await requireLinqStub().waitForAdditionalSend({
      baselineCount: baselineReplyCount,
      expectedPath: replyPath,
      scenario: requireScenario(),
      userId,
    });
    const inboundReplyLatencyMs = performance.now() - inboundReplyLatencyStartedAt;
    expect(inboundReplyLatencyMs).toBeGreaterThanOrEqual(0);
    console.info(
      `Hosted snapshot stress inbound webhook-to-reply latency: ${
        Math.round(inboundReplyLatencyMs)
      }ms`,
    );
    expect(sendRequest.method).toBe("POST");
    expect(requireLinqStub().readObservedMessageText(sendRequest)).toBe(replyText);

    const finalStatus = await completionPromise;
    expect(finalStatus.lastErrorCode ?? null).toBeNull();
    expect(finalStatus.mailboxLag.every((lane) => lane.lag === "0")).toBe(true);
    expect(finalStatus.workspace?.version ?? null).toBe(beforeInboundWorkspaceVersion);

    const postReplySnapshot = findLargestCheckpointLogOrNull(finalStatus.recentLogs, {
      eventCode: "checkpoint.snapshot_finished",
      reason: ["outbox_sending", "outbox_receipt", "canonical_runtime_commit"],
    });
    if (!postReplySnapshot) {
      expect(hasCheckpointLog(finalStatus.recentLogs, {
        eventCode: "checkpoint.runtime_residue_deferred",
        reason: ["outbox_sending", "outbox_receipt", "canonical_runtime_commit"],
      })).toBe(true);
    }
    expect(hasCheckpointLog(finalStatus.recentLogs, {
      eventCode: "checkpoint.hot_state_fallback",
      reason: ["outbox_sending", "outbox_receipt", "canonical_runtime_commit"],
    })).toBe(false);

    if (importSnapshot) {
      expect(readRedactedJsonString(importSnapshot, "snapshotMode")).toBe("working");
      expect(readRedactedJsonNumber(importSnapshot, "bundlePutBytes"))
        .toBeLessThan(16 * 1024 * 1024);
      expect(readRedactedJsonNumber(importSnapshot, "snapshotElapsedMs"))
        .toBeGreaterThanOrEqual(0);
    }
    if (postReplySnapshot) {
      expect(readRedactedJsonString(postReplySnapshot, "snapshotMode")).toBe("working");
      expect(readRedactedJsonNumber(postReplySnapshot, "bundlePutBytes"))
        .toBeLessThan(16 * 1024 * 1024);
      expect(readRedactedJsonNumber(postReplySnapshot, "snapshotElapsedMs"))
        .toBeGreaterThanOrEqual(0);
    }
  }, 480_000);
});

async function startScenario(): Promise<void> {
  linqStub = await startHostedLocalLinqStub();
  scenario = await startHostedLocalFullStackScenario({
    additionalEnv: {
      HOSTED_ASSISTANT_MODEL: productionLikeAssistantModel,
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS:
        buildLinqRecipientPhoneNumber(userId),
      LINQ_API_BASE_URL: requireLinqStub().containerBaseUrl,
      LINQ_API_TOKEN: "linq-local-test-token",
      LINQ_WEBHOOK_SECRET: linqWebhookSecret,
      MURPH_DEV_SKIP_HEALTH_COMMONS_WATCH: "1",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      OPENAI_API_KEY: "stub-local-openai-key",
    },
    assistantProviderStubModelId: productionLikeAssistantModel,
    localDatabaseUrl,
    persistDirOverride: workerPersistDirOverride,
    persistDirPrefix: "murph-hosted-local-snapshot-stress-",
    requiredRunnerEnvProfile: "linq",
    scenarioLabel: "Local hosted snapshot stress e2e",
    streamLogs: streamDevLogs,
  });
}

async function createSnapshotStressFixture(): Promise<{
  bytes: Uint8Array;
  hash: string;
}> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-hosted-snapshot-stress-"));
  const operatorHomeRoot = `${vaultRoot}-operator-home`;
  cleanupPaths.push(vaultRoot, operatorHomeRoot);

  await writeSyntheticVaultMetadata(vaultRoot);
  await writeSyntheticVaultFiles(vaultRoot);
  await writeSyntheticAssistantRuntimeState(vaultRoot);
  await writeSyntheticCodexContinuity(operatorHomeRoot);

  const snapshot = await snapshotHostedExecutionContext({
    operatorHomeRoot,
    vaultRoot,
  });
  return {
    bytes: snapshot.bundle,
    hash: sha256HostedBundleHex(snapshot.bundle),
  };
}

async function uploadHostedSnapshotArtifact(input: {
  bytes: Uint8Array;
  hash: string;
}): Promise<void> {
  await requireScenario().harness.request(
    `/__test/artifacts?userId=${encodeURIComponent(userId)}&sha256=${input.hash}`,
    {
      body: new Blob([new Uint8Array(input.bytes)]),
      headers: {
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      },
      method: "PUT",
    },
  );
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

async function writeSyntheticVaultMetadata(vaultRoot: string): Promise<void> {
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(
    path.join(vaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: "2026-05-05T00:00:00.000Z",
      formatVersion: 1,
      timezone: "Asia/Kuala_Lumpur",
      title: "Synthetic Snapshot Stress Vault",
      vaultId: "vault_01JZSNAPSHOTSTRESS000000000",
    }, null, 2)}\n`,
    "utf8",
  );
}

async function writeSyntheticVaultFiles(vaultRoot: string): Promise<void> {
  const notesDirectory = path.join(vaultRoot, "notes", "snapshot-stress");
  await mkdir(notesDirectory, { recursive: true });
  for (let index = 0; index < stressVaultFileCount; index += 1) {
    await writeFile(
      path.join(notesDirectory, `vault-note-${index}.md`),
      buildPaddedText({
        bytes: stressVaultFileBytes,
        label: `vault-note-${index}`,
      }),
      "utf8",
    );
  }
}

async function writeSyntheticAssistantRuntimeState(vaultRoot: string): Promise<void> {
  const assistantRoot = path.join(vaultRoot, ".runtime", "operations", "assistant");
  const sessionsDirectory = path.join(assistantRoot, "sessions");
  const transcriptsDirectory = path.join(assistantRoot, "transcripts");
  await mkdir(sessionsDirectory, { recursive: true });
  await mkdir(transcriptsDirectory, { recursive: true });
  await writeFile(
    path.join(sessionsDirectory, "snapshot-stress-session.json"),
    `${JSON.stringify({
      resumeState: {
        codexRolloutRelativePath: stressCodexRolloutRelativePath,
        providerSessionId: stressCodexThreadId,
        resumeRouteId: "route_snapshot_stress",
      },
      schema: "murph.synthetic-hosted-assistant-session.v1",
      updatedAt: "2026-05-05T00:00:00.000Z",
    }, null, 2)}\n`,
    "utf8",
  );

  for (let index = 0; index < stressConversationCount; index += 1) {
    await writeFile(
      path.join(transcriptsDirectory, `conversation-${index}.jsonl`),
      `${JSON.stringify({
        at: "2026-05-05T00:00:00.000Z",
        id: `turn_snapshot_stress_${index}`,
        role: index % 2 === 0 ? "assistant" : "user",
        text: buildPaddedText({
          bytes: stressTranscriptBytes,
          label: `assistant-transcript-${index}`,
        }),
      })}\n`,
      "utf8",
    );
  }
}

async function writeSyntheticCodexContinuity(operatorHomeRoot: string): Promise<void> {
  const rootSessionsDirectory = path.join(operatorHomeRoot, ".codex-hosted", "sessions");
  const datedSessionsDirectory = path.join(rootSessionsDirectory, "2026", "05", "05");
  await mkdir(datedSessionsDirectory, { recursive: true });

  const rolloutItems = Array.from({ length: stressConversationCount }, (_, index) => ({
    events: [
      {
        content: buildPaddedText({
          bytes: Math.max(1024, Math.floor(stressCodexSessionBytes / 8)),
          label: `codex-session-user-input-${index}`,
        }),
        role: "user",
        type: "message",
      },
      {
        output: buildPaddedText({
          bytes: stressCodexSessionBytes,
          label: `codex-session-function-output-${index}`,
        }),
        type: "function_call_output",
      },
    ],
    providerSessionId: stressCodexThreadId,
    schema: "murph.synthetic-codex-session.v1",
    turnId: `turn_snapshot_stress_${index}`,
  }));
  await writeFile(
    path.join(operatorHomeRoot, ".codex-hosted", stressCodexRolloutRelativePath),
    `${rolloutItems.map((item) => JSON.stringify(item)).join("\n")}\n`,
    "utf8",
  );

  for (let index = 0; index < 4; index += 1) {
    await writeFile(
      path.join(rootSessionsDirectory, `root-session-snapshot-stress-${index}.jsonl`),
      `${JSON.stringify({
        events: [
          {
            content: buildPaddedText({
              bytes: Math.max(1024, Math.floor(stressCodexSessionBytes / 4)),
              label: `codex-root-session-${index}`,
            }),
            role: "assistant",
            type: "message",
          },
        ],
        providerSessionId: stressCodexThreadId,
        schema: "murph.synthetic-codex-root-session.v1",
      })}\n`,
      "utf8",
    );
  }
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

function createBrowserVaultReplicaRef(
  sourceBundleHash: string,
): HostedBrowserVaultReplicaRef {
  return {
    byteLength: 256,
    dataVersion: `snapshot-stress-${sourceBundleHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    keyId: "browser-vault-replica:snapshot-stress",
    objectKey: `browser-vault/${userId}/snapshot-stress-replica.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:snapshot-stress",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function findLargestCheckpointLog(
  logs: readonly HostedRuntimeLogEntry[] | undefined,
  input: {
    eventCode: string;
    reason: string | readonly string[];
  },
): HostedRuntimeLogEntry {
  const expectedReasons = Array.isArray(input.reason) ? input.reason : [input.reason];
  const matches = logs?.filter((entry) =>
    entry.eventCode === input.eventCode
    && expectedReasons.includes(readRedactedJsonString(entry, "checkpointReason") ?? "")
  ) ?? [];
  const match = matches.sort((left, right) =>
    readRedactedJsonNumberOrZero(right, "bundlePutBytes")
    - readRedactedJsonNumberOrZero(left, "bundlePutBytes")
  )[0] ?? null;
  if (!match) {
    throw new Error(
      [
        `Expected hosted runtime log ${input.eventCode} for ${expectedReasons.join(" or ")}.`,
        `available checkpoint logs: ${JSON.stringify(summarizeCheckpointLogs(logs))}`,
      ].join("\n"),
    );
  }
  return match;
}

function findLargestCheckpointLogOrNull(
  logs: readonly HostedRuntimeLogEntry[] | undefined,
  input: {
    eventCode: string;
    reason: string | readonly string[];
  },
): HostedRuntimeLogEntry | null {
  const expectedReasons = Array.isArray(input.reason) ? input.reason : [input.reason];
  return logs?.filter((entry) =>
    entry.eventCode === input.eventCode
    && expectedReasons.includes(readRedactedJsonString(entry, "checkpointReason") ?? "")
  ).sort((left, right) =>
    readRedactedJsonNumberOrZero(right, "bundlePutBytes")
    - readRedactedJsonNumberOrZero(left, "bundlePutBytes")
  )[0] ?? null;
}

function hasCheckpointLog(
  logs: readonly HostedRuntimeLogEntry[] | undefined,
  input: {
    eventCode: string;
    reason: string | string[];
  },
): boolean {
  const expectedReasons = Array.isArray(input.reason) ? input.reason : [input.reason];
  return (logs ?? []).some((entry) =>
    entry.eventCode === input.eventCode
    && expectedReasons.includes(readRedactedJsonString(entry, "checkpointReason") ?? "")
  );
}

function summarizeCheckpointLogs(
  logs: readonly HostedRuntimeLogEntry[] | undefined,
): Array<{
  bundlePutBytes: number;
  eventCode: string;
  reason: string | null;
  snapshotMode: string | null;
}> {
  return (logs ?? [])
    .filter((entry) => entry.eventCode.startsWith("checkpoint."))
    .map((entry) => ({
      bundlePutBytes: readRedactedJsonNumberOrZero(entry, "bundlePutBytes"),
      eventCode: entry.eventCode,
      reason: readRedactedJsonString(entry, "checkpointReason"),
      snapshotMode: readRedactedJsonString(entry, "snapshotMode"),
    }));
}

function readRedactedJsonNumberOrZero(entry: HostedRuntimeLogEntry, key: string): number {
  const value = readRedactedJsonValue(entry, key);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readRedactedJsonString(entry: HostedRuntimeLogEntry, key: string): string | null {
  const value = readRedactedJsonValue(entry, key);
  return typeof value === "string" ? value : null;
}

function readRedactedJsonNumber(entry: HostedRuntimeLogEntry, key: string): number {
  const value = readRedactedJsonValue(entry, key);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected runtime log numeric field ${key}.`);
  }
  return value;
}

function readRedactedJsonValue(entry: HostedRuntimeLogEntry, key: string): unknown {
  const redactedJson = entry.redactedJson;
  if (
    !redactedJson
    || typeof redactedJson !== "object"
    || Array.isArray(redactedJson)
  ) {
    return null;
  }
  return (redactedJson as Record<string, unknown>)[key];
}

function buildPaddedText(input: {
  bytes: number;
  label: string;
}): string {
  const prefix = `${input.label}\n`;
  if (Buffer.byteLength(prefix, "utf8") >= input.bytes) {
    return prefix;
  }

  let text = prefix;
  let counter = 0;
  while (Buffer.byteLength(text, "utf8") < input.bytes) {
    text += `${hashFixtureChunk(`${input.label}:${counter}`)}\n`;
    counter += 1;
  }

  return text.slice(0, input.bytes);
}

function hashFixtureChunk(seed: string): string {
  return Array.from({ length: 8 }, (_, index) =>
    createHash("sha256")
      .update(`${seed}:${index}`)
      .digest("base64url")
  ).join(":");
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
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
