import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

import {
  createGatewayConversationSessionKey,
  type GatewayProjectionSnapshot,
} from "@murphai/gateway-core";
import {
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  deriveHostedExecutionErrorCode,
  parseHostedWakeAppendRequest,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionDispatchResult,
  HostedExecutionWake,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedAssistantDeliveryEffect,
} from "@murphai/hosted-execution/side-effects";
import {
  encodeHostedBundleBase64,
  listHostedBundleArtifacts,
  snapshotHostedBundleRoots,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
  createHostedRunnerSecretsStore,
} from "../src/bundle-store.js";
import { HostedBundleGarbageCollector } from "../src/bundle-gc.js";
import { deriveHostedStorageOpaqueId } from "../src/crypto-context.js";
import { encryptHostedBundle } from "../src/crypto.js";
import {
  createHostedExecutionJournalStore,
  persistHostedExecutionCommit,
  persistHostedExecutionFinalBundles,
  type HostedExecutionCommittedResult,
} from "../src/execution-journal.js";
import {
  type HostedExecutionEnvironment,
} from "../src/env.ts";
import {
  createHostedExecutionVercelOidcValidationEnvironment,
} from "../src/auth-adapter.ts";
import { writeHostedEmailRawMessage } from "../src/hosted-email.js";
import { hostedArtifactObjectKey } from "../src/storage-paths.js";
import { createHostedUserKeyStore } from "../src/user-key-store.js";
import { HostedUserRunner as BaseHostedUserRunner } from "../src/user-runner.js";
import { encodeHostedRunnerSecretsPayload } from "../src/runner-secrets.js";
import {
  TEST_AUTOMATION_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_RECOVERY_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK as TEST_RECOVERY_RECIPIENT_PUBLIC_JWK,
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  TEST_TEE_AUTOMATION_RECIPIENT_KEY_ID,
  TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK,
} from "./hosted-execution-fixtures.js";
import { createTestSqlStorage } from "./sql-storage.js";
import {
  appendTestHostedWake,
  commitTestHostedWakeCursor,
  fetchTestHostedWakeBatch,
  quarantineTestHostedWake,
  readTestHostedWakeStatus,
} from "./workers/test-hosted-wake-control.ts";

const describe = baseDescribe.sequential;

class HostedUserRunner extends BaseHostedUserRunner {
  wake(input: HostedExecutionWake): Promise<HostedExecutionUserStatus> {
    return this.enqueueHostedWake(input);
  }

  wakeWithOutcome(input: HostedExecutionWake): Promise<HostedExecutionDispatchResult> {
    return this.enqueueHostedWakeWithOutcome(input);
  }
}

describe("HostedUserRunner", () => {
  const bucket = createBucket();
  const storage = createStorage();
  const environment: HostedExecutionEnvironment = {
    allowedRunnerSecretKeys: null,
    automationRecipientKeyId: TEST_AUTOMATION_RECIPIENT_KEY_ID,
    automationRecipientPrivateKey: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
    automationRecipientPrivateKeysById: {
      [TEST_AUTOMATION_RECIPIENT_KEY_ID]: TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
    },
    automationRecipientPublicKey: TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    platformEnvelopeKey: Uint8Array.from({ length: 32 }, () => 7),
    platformEnvelopeKeyId: "v1",
    platformEnvelopeKeysById: {
      v1: Uint8Array.from({ length: 32 }, () => 7),
    },
    maxEventAttempts: 3,
    recoveryRecipientKeyId: TEST_RECOVERY_RECIPIENT_KEY_ID,
    recoveryRecipientPublicKey: TEST_RECOVERY_RECIPIENT_PUBLIC_JWK,
    teeAutomationRecipientKeyId: TEST_TEE_AUTOMATION_RECIPIENT_KEY_ID,
    teeAutomationRecipientPublicKey: TEST_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK,
    hostedWebBaseUrl: "https://web.example.test/",
    retryDelayMs: 10_000,
    runnerReadyTimeoutMs: 20_000,
    runnerTimeoutMs: 60_000,
    vercelOidcValidation: createHostedExecutionVercelOidcValidationEnvironment({
      environment: "production",
      projectName: "murph-web",
      teamSlug: "murph-team",
    }),
    webCallbackSigning: {
      keyId: "v1",
      privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
    },
  };

  beforeEach(() => {
    bucket.clear();
    storage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createAssistantDeliveryEffect(input: {
    effectId: string;
    fingerprint: string;
  }): HostedAssistantDeliveryEffect {
    return {
      effectId: input.effectId,
      fingerprint: input.fingerprint,
      kind: "assistant.delivery",
      payload: {
        actorId: "actor_123",
        bindingDeliveryKind: "participant",
        bindingDeliveryTarget: "chat_123",
        channel: "telegram",
        explicitTarget: null,
        idempotencyKey: `assistant-outbox:${input.effectId}`,
        identityId: "identity_123",
        message: "hello from hosted runner",
        subject: null,
        replyToMessageId: null,
        sessionId: `session_${input.effectId}`,
        threadId: "thread_123",
        threadIsDirect: true,
        transportIdempotent: false,
        turnId: `turn_${input.effectId}`,
      },
    };
  }

  async function seedManagedUserCryptoForTest(
    runner: HostedUserRunner,
    userId: string,
    envOverride: HostedExecutionEnvironment = environment,
  ): Promise<void> {
    await runner.bootstrapUser(userId);
    await resolveHostedUserCryptoContextForTest({
      bucket,
      environment: envOverride,
      userId,
    });
  }

  async function writeRunnerSecretsForTest(input: {
    env: Record<string, string>;
    environmentOverride?: HostedExecutionEnvironment;
    userId: string;
  }): Promise<void> {
    const environmentOverride = input.environmentOverride ?? environment;
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment: environmentOverride,
      userId: input.userId,
    });
    const store = createHostedRunnerSecretsStore({
      bucket: bucket.api,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    });
    const payload = encodeHostedRunnerSecretsPayload({
      env: input.env,
    });

    if (payload) {
      await store.writeRunnerSecrets(input.userId, payload);
      return;
    }

    await store.clearRunnerSecrets(input.userId);
  }

  it("roundtrips encrypted bundle payloads through object storage", async () => {
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: environment.platformEnvelopeKey,
      keyId: environment.platformEnvelopeKeyId,
    });
    const plaintext = new TextEncoder().encode("vault bundle");

    const ref = await bundleStore.writeBundle("vault", plaintext);

    expect(ref).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
      size: plaintext.byteLength,
    });
    await expect(bundleStore.readBundle(ref)).resolves.toEqual(plaintext);
  });

  it("fails clearly when reading hosted objects encrypted with a different key id", async () => {
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: environment.platformEnvelopeKey,
      keyId: "v2",
    });
    const plaintext = new TextEncoder().encode("vault bundle");
    const legacyRef = await createHostedBundleStore({
      bucket: bucket.api,
      key: environment.platformEnvelopeKey,
      keyId: "v1",
    }).writeBundle("vault", plaintext);

    await expect(bundleStore.readBundle(legacyRef)).rejects.toThrow(
      "Hosted cipher envelope keyId mismatch: expected v2, got v1. No keyring is configured for multi-key decryption.",
    );
  });

  it("reads hosted objects encrypted with previous key ids when a keyring is configured", async () => {
    const previousKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const currentKey = Uint8Array.from({ length: 32 }, () => 7);
    const legacyRef = await createHostedBundleStore({
      bucket: bucket.api,
      key: previousKey,
      keyId: "v1",
    }).writeBundle("vault", new TextEncoder().encode("vault bundle"));
    const bundleStore = createHostedBundleStore({
      bucket: bucket.api,
      key: currentKey,
      keyId: "v2",
      keysById: {
        v1: previousKey,
        v2: currentKey,
      },
    });
    const writesBeforeRead = bucket.putCount();

    await expect(bundleStore.readBundle(legacyRef)).resolves.toEqual(
      new TextEncoder().encode("vault bundle"),
    );
    expect(bucket.putCount()).toBe(writesBeforeRead);
    const storedEnvelope = JSON.parse(
      Buffer.from(await (await bucket.api.get(legacyRef.key))!.arrayBuffer()).toString("utf8"),
    ) as { keyId: string };
    expect(storedEnvelope.keyId).toBe("v1");
  });

  it("cleans up orphaned per-user artifacts without deleting shared bundle objects", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-bundle-gc-"));

    try {
      const previousVaultRoot = path.join(workspaceRoot, "previous-vault");
      const nextVaultRoot = path.join(workspaceRoot, "next-vault");
      const previousRawAttachmentPath = path.join(
        previousVaultRoot,
        "raw",
        "inbox",
        "example",
        "photo.jpg",
      );
      await mkdir(path.dirname(previousRawAttachmentPath), { recursive: true });
      await mkdir(nextVaultRoot, { recursive: true });
      await writeFile(path.join(previousVaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
      await writeFile(previousRawAttachmentPath, Buffer.from("image-bytes-placeholder\n", "utf8"));
      await writeFile(path.join(nextVaultRoot, "vault.json"), "{\"schema\":\"vault\",\"next\":true}\n");

      const artifactStore = createHostedArtifactStore({
        bucket: bucket.api,
        key: environment.platformEnvelopeKey,
        keyId: environment.platformEnvelopeKeyId,
        userId: "member_gc",
      });
      const previousVaultBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (artifact) => {
          const ref = {
            byteSize: artifact.bytes.byteLength,
            sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
          };
          await artifactStore.writeArtifact(ref.sha256, artifact.bytes);
          return ref;
        },
        kind: "vault",
        roots: [
          {
            root: previousVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const nextVaultBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: nextVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const bundleStore = createHostedBundleStore({
        bucket: bucket.api,
        key: environment.platformEnvelopeKey,
        keyId: environment.platformEnvelopeKeyId,
      });
      const [previousArtifact] = listHostedBundleArtifacts({
        bytes: previousVaultBundle!,
        expectedKind: "vault",
      });
      const previousVaultRef = await bundleStore.writeBundle("vault", previousVaultBundle!);
      const nextVaultRef = await bundleStore.writeBundle("vault", nextVaultBundle!);
      const previousAgentRef = await bundleStore.writeBundle(
        "vault",
        new TextEncoder().encode("agent-state-previous"),
      );
      const nextAgentRef = await bundleStore.writeBundle(
        "vault",
        new TextEncoder().encode("agent-state-next"),
      );
      const otherUserSharedVaultRef = await bundleStore.writeBundle("vault", previousVaultBundle!);
      const otherUserSharedAgentRef = await bundleStore.writeBundle(
        "vault",
        new TextEncoder().encode("agent-state-previous"),
      );

      const collector = new HostedBundleGarbageCollector(
        bucket.api,
        environment.platformEnvelopeKey,
        environment.platformEnvelopeKeyId,
      );

      await collector.cleanupBundleTransition({
        nextBundleRef: nextVaultRef,
        previousBundleRef: previousVaultRef,
        userId: "member_gc",
      });

      expect(otherUserSharedVaultRef.key).toBe(previousVaultRef.key);
      expect(otherUserSharedAgentRef.key).toBe(previousAgentRef.key);
      expect(bucket.keys()).toContain(previousAgentRef.key);
      expect(bucket.keys()).toContain(previousVaultRef.key);
      expect(bucket.keys()).not.toContain(
        await hostedArtifactObjectKey(
          environment.platformEnvelopeKey,
          "member_gc",
          previousArtifact!.ref.sha256,
        ),
      );
      expect(bucket.keys()).toContain(nextAgentRef.key);
      expect(bucket.keys()).toContain(nextVaultRef.key);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps per-user artifacts when bundle refs only differ by updatedAt", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-bundle-gc-updated-at-"));

    try {
      const vaultRoot = path.join(workspaceRoot, "vault");
      const rawAttachmentPath = path.join(
        vaultRoot,
        "raw",
        "inbox",
        "example",
        "photo.jpg",
      );
      await mkdir(path.dirname(rawAttachmentPath), { recursive: true });
      await writeFile(path.join(vaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
      await writeFile(rawAttachmentPath, Buffer.from("image-bytes-placeholder\n", "utf8"));

      const artifactStore = createHostedArtifactStore({
        bucket: bucket.api,
        key: environment.platformEnvelopeKey,
        keyId: environment.platformEnvelopeKeyId,
        userId: "member_gc_same_ref",
      });
      const vaultBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (artifact) => {
          const ref = {
            byteSize: artifact.bytes.byteLength,
            sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
          };
          await artifactStore.writeArtifact(ref.sha256, artifact.bytes);
          return ref;
        },
        kind: "vault",
        roots: [
          {
            root: vaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const bundleStore = createHostedBundleStore({
        bucket: bucket.api,
        key: environment.platformEnvelopeKey,
        keyId: environment.platformEnvelopeKeyId,
      });
      const [artifact] = listHostedBundleArtifacts({
        bytes: vaultBundle!,
        expectedKind: "vault",
      });
      const previousVaultRef = await bundleStore.writeBundle("vault", vaultBundle!);
      const nextVaultRef = {
        ...previousVaultRef,
        updatedAt: "2026-03-27T00:00:01.000Z",
      };
      const collector = new HostedBundleGarbageCollector(
        bucket.api,
        environment.platformEnvelopeKey,
        environment.platformEnvelopeKeyId,
      );

      await collector.cleanupBundleTransition({
        nextBundleRef: nextVaultRef,
        previousBundleRef: previousVaultRef,
        userId: "member_gc_same_ref",
      });

      expect(bucket.keys()).toContain(
        await hostedArtifactObjectKey(
          environment.platformEnvelopeKey,
          "member_gc_same_ref",
          artifact!.ref.sha256,
        ),
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("cleans up orphaned per-user artifacts when a prefinalized commit is recovered", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-recovered-bundle-gc-"));

    try {
      const crypto = await resolveHostedUserCryptoContextForTest({
        bucket,
        environment,
        userId: "member_recovered_gc",
      });
      const previousVaultRoot = path.join(workspaceRoot, "previous-vault");
      const nextVaultRoot = path.join(workspaceRoot, "next-vault");
      const previousRawAttachmentPath = path.join(
        previousVaultRoot,
        "raw",
        "inbox",
        "example",
        "photo.jpg",
      );
      await mkdir(path.dirname(previousRawAttachmentPath), { recursive: true });
      await mkdir(nextVaultRoot, { recursive: true });
      await writeFile(path.join(previousVaultRoot, "vault.json"), "{\"schema\":\"vault\"}\n");
      await writeFile(previousRawAttachmentPath, Buffer.from("image-bytes-placeholder\n", "utf8"));
      await writeFile(path.join(nextVaultRoot, "vault.json"), "{\"schema\":\"vault\",\"next\":true}\n");

      const artifactStore = createHostedArtifactStore({
        bucket: bucket.api,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
        userId: "member_recovered_gc",
      });
      const previousVaultBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (artifact) => {
          const ref = {
            byteSize: artifact.bytes.byteLength,
            sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
          };
          await artifactStore.writeArtifact(ref.sha256, artifact.bytes);
          return ref;
        },
        kind: "vault",
        roots: [
          {
            root: previousVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const nextVaultBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: nextVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const bundleStore = createHostedBundleStore({
        bucket: bucket.api,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      });
      const [previousArtifact] = listHostedBundleArtifacts({
        bytes: previousVaultBundle!,
        expectedKind: "vault",
      });
      const previousAgentBytes = new TextEncoder().encode("agent-state-previous");
      const nextAgentBytes = new TextEncoder().encode("agent-state-next");
      const previousAgentRef = await bundleStore.writeBundle("vault", previousAgentBytes);
      const previousVaultRef = await bundleStore.writeBundle("vault", previousVaultBundle!);

      await seedRunnerQueueState({
        runtimeBootstrapped: true,
        bucket,
        environment,
        pendingEvents: [
          {
            attempts: 1,
            availableAt: "2026-03-26T12:00:00.000Z",
            dispatch: {
              event: {
                kind: "assistant.cron.tick",
                reason: "manual",
                userId: "member_recovered_gc",
              },
              eventId: "evt_recovered_gc",
              occurredAt: "2026-03-26T12:00:00.000Z",
            },
            enqueuedAt: "2026-03-26T12:00:00.000Z",
            lastError: "lost ack",
          },
        ],
        retryingEventId: "evt_recovered_gc",
        storage,
        userId: "member_recovered_gc",
      });

      const sql = storage.state.storage.sql;
      if (!sql) {
        throw new Error("Test storage.sql is required.");
      }
      sql.exec(
        `UPDATE runner_bundle_slots
         SET bundle_ref_json = ?, bundle_version = ?
         WHERE slot = ?`,
        JSON.stringify(previousAgentRef),
        1,
        "agentState",
      );
      sql.exec(
        `UPDATE runner_bundle_slots
         SET bundle_ref_json = ?, bundle_version = ?
         WHERE slot = ?`,
        JSON.stringify(previousVaultRef),
        1,
        "vault",
      );

      await persistHostedExecutionCommit({
        bucket: bucket.api,
        currentBundleRef: previousVaultRef,
        eventId: "evt_recovered_gc",
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
        payload: {
          assistantDeliveryEffects: [],
          bundle: Buffer.from(nextVaultBundle!).toString("base64"),
          result: {
            eventsHandled: 1,
            summary: "recovered",
          },
        },
        userId: "member_recovered_gc",
      });
      await persistHostedExecutionFinalBundles({
        bucket: bucket.api,
        eventId: "evt_recovered_gc",
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
        payload: {
          bundle: Buffer.from(nextVaultBundle!).toString("base64"),
        },
        userId: "member_recovered_gc",
      });

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchMock }));
      const runner = new HostedUserRunner(storage.state, environment, bucket.api);

      const status = await runner.wake(createWake("evt_recovered_gc", "member_recovered_gc"));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(status.lastError).toBeNull();
      expect(bucket.keys()).toContain(previousVaultRef.key);
      expect(bucket.keys()).toContain(previousAgentRef.key);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("roundtrips committed execution journal records through object storage", async () => {
    const journalStore = createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: environment.platformEnvelopeKey,
      keyId: environment.platformEnvelopeKeyId,
    });
    const committedResult = {
      assistantDeliveryEffects: [],
      bundleRef: null,
      committedAt: "2026-03-27T00:00:00.000Z",
      eventId: "evt_roundtrip",
      finalizedAt: null,
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      userId: "member_123",
    };

    await journalStore.writeCommittedResult("member_123", "evt_roundtrip", committedResult);

    await expect(journalStore.readCommittedResult("member_123", "evt_roundtrip")).resolves.toEqual(
      committedResult,
    );
  });

  it("rejects duplicate durable commits whose payload diverges from the first write", async () => {
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRef: null,
      eventId: "evt_duplicate_commit",
      key: environment.platformEnvelopeKey,
      keyId: environment.platformEnvelopeKeyId,
      payload: {
        assistantDeliveryEffects: [],
        bundle: Buffer.from("vault").toString("base64"),
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: "member_123",
    });

    await expect(
      persistHostedExecutionCommit({
        bucket: bucket.api,
        currentBundleRef: null,
        eventId: "evt_duplicate_commit",
        key: environment.platformEnvelopeKey,
        keyId: environment.platformEnvelopeKeyId,
        payload: {
          assistantDeliveryEffects: [],
          bundle: Buffer.from("vault").toString("base64"),
          result: {
            eventsHandled: 1,
            summary: "changed",
          },
        },
        userId: "member_123",
      }),
    ).rejects.toThrow(
      "Hosted execution commit evt_duplicate_commit result does not match the existing durable commit.",
    );
  });

  it("does not rewrite finalized journal records when bundle refs only differ by updatedAt", async () => {
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRef: null,
      eventId: "evt_finalize_same_ref",
      key: environment.platformEnvelopeKey,
      keyId: environment.platformEnvelopeKeyId,
      payload: {
        assistantDeliveryEffects: [],
        bundle: Buffer.from("vault").toString("base64"),
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: "member_123",
    });

    const journalStore = createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: environment.platformEnvelopeKey,
      keyId: environment.platformEnvelopeKeyId,
    });
    const existing = await journalStore.readCommittedResult("member_123", "evt_finalize_same_ref");
    if (!existing?.bundleRef) {
      throw new Error("Expected committed bundle ref to exist.");
    }

    const finalizedRecord = {
      ...existing,
      bundleRef: {
        ...existing.bundleRef,
        updatedAt: "2026-03-27T00:00:01.000Z",
      },
      finalizedAt: "2026-03-27T00:00:02.000Z",
    };
    await journalStore.writeCommittedResult("member_123", "evt_finalize_same_ref", finalizedRecord);
    const writesBeforeFinalize = bucket.putCount();

    const finalized = await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: "evt_finalize_same_ref",
      key: environment.platformEnvelopeKey,
      keyId: environment.platformEnvelopeKeyId,
      payload: {
        bundle: Buffer.from("vault").toString("base64"),
      },
      userId: "member_123",
    });

    expect(finalized).toEqual(finalizedRecord);
    expect(bucket.putCount()).toBe(writesBeforeFinalize);
  });
  it("reapplies committed gateway snapshots from the durable journal before finalize completes", async () => {
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });
    await seedRunnerQueueState({
      runtimeBootstrapped: true,
      bucket,
      environment,
      pendingEvents: [{
        attempts: 1,
        availableAt: "2026-03-26T12:00:00.000Z",
        dispatch: createWake("evt_gateway_recovery"),
        enqueuedAt: "2026-03-26T12:00:00.000Z",
        lastError: "lost ack",
      }],
      retryingEventId: "evt_gateway_recovery",
      storage,
      userId: "member_123",
    });

    await createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    }).writeCommittedResult("member_123", "evt_gateway_recovery", {
      assistantDeliveryEffects: [],
      bundleRef: null,
      committedAt: "2026-03-26T12:00:01.000Z",
      eventId: "evt_gateway_recovery",
      finalizedAt: null,
      gatewayProjectionSnapshot: createGatewayProjectionSnapshot({
        generatedAt: "2026-03-26T12:00:01.000Z",
        lastActivityAt: "2026-03-26T12:00:01.000Z",
        lastMessagePreview: "Committed before finalize.",
        messages: [{
          actorDisplayName: "Alex",
          createdAt: "2026-03-26T12:00:01.000Z",
          direction: "inbound",
          messageId: "gwcm_projection_recovery",
          text: "Committed before finalize.",
        }],
        messageCount: 1,
        title: "Recovery thread",
      }),
      result: {
        eventsHandled: 1,
        summary: "commit recorded",
      },
      userId: "member_123",
    });

    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const status = await runner.wake(createWake("evt_gateway_recovery"));

    expect(status.pendingEventCount).toBe(1);
    expect(status.retryingEventId).toBe("evt_gateway_recovery");
  });


  it("recovers finalized committed results after automation-key rotation via the user root key envelope", async () => {
    const rotatedEnvironment = {
      ...environment,
      platformEnvelopeKey: Uint8Array.from({ length: 32 }, () => 9),
      platformEnvelopeKeyId: "v2",
      platformEnvelopeKeysById: {
        v1: environment.platformEnvelopeKey,
        v2: Uint8Array.from({ length: 32 }, () => 9),
      },
    };
    const runner = new HostedUserRunner(storage.state, rotatedEnvironment, bucket.api);
    const dispatch = createWake("evt_rotated_commit_recovery");
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment: rotatedEnvironment,
      userId: dispatch.userId,
    });

    await seedRunnerQueueState({
      runtimeBootstrapped: true,
      bucket,
      environment: rotatedEnvironment,
      pendingEvents: [
        {
          attempts: 1,
          availableAt: "2026-03-26T12:00:00.000Z",
          dispatch,
          enqueuedAt: "2026-03-26T12:00:00.000Z",
          lastError: "lost ack",
        },
      ],
      retryingEventId: dispatch.eventId,
      storage,
      userId: dispatch.userId,
    });

    await createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    }).writeCommittedResult(dispatch.userId, dispatch.eventId, {
      assistantDeliveryEffects: [],
      bundleRef: null,
      committedAt: "2026-03-26T12:00:01.000Z",
      eventId: dispatch.eventId,
      finalizedAt: "2026-03-26T12:00:02.000Z",
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "recovered",
      },
      userId: dispatch.userId,
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchMock }));

    const status = await runner.wake(dispatch);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(status.pendingEventCount).toBe(0);
    expect(status.retryingEventId).toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.lastEventId).toBe(dispatch.eventId);
    await expect(
      createHostedExecutionJournalStore({
        bucket: bucket.api,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      }).readCommittedResult(dispatch.userId, dispatch.eventId),
    ).resolves.toBeNull();
  });

  it("dispatches work through the runner endpoint and persists encrypted bundles", async () => {
    const resultPayload = {
      bundles: {
        agentState: Buffer.from("agent-state").toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(resultPayload)), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.wake(createActivationWake("evt_123", "member_123"));

    expect(status.userId).toBe("member_123");
    expect(status.lastEventId).toBe("evt_123");
    expect(status.lastError).toBeNull();
    expect(status.bundleRef).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
    });
    expect(status.pendingEventCount).toBe(0);
    expect(status.poisonedEventIds).toEqual([]);
    expect(status.retryingEventId).toBeNull();
    expect(status.run).toBeUndefined();
    expect(status.timeline?.map((entry) => entry.phase)).toEqual([
      "claimed",
      "dispatch.running",
      "commit.recorded",
      "completed",
    ]);
    expect(new Set((status.timeline ?? []).map((entry) => entry.runId)).size).toBe(1);
    expect(storage.lastAlarm).toBeNull();
    expectHostedBundleKeys(bucket.keys(), ["vault"]);
    await expect(createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: (await resolveHostedUserCryptoContextForTest({
        bucket,
        environment,
        userId: "member_123",
      })).rootKey,
      keyId: (await resolveHostedUserCryptoContextForTest({
        bucket,
        environment,
        userId: "member_123",
      })).rootKeyId,
      keysById: (await resolveHostedUserCryptoContextForTest({
        bucket,
        environment,
        userId: "member_123",
      })).keysById,
    }).readCommittedResult("member_123", "evt_123")).resolves.toBeNull();
  });

  it("starts the native container runner and applies the next wake hint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const resultPayload = {
      bundles: {
        agentState: Buffer.from("agent-state").toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        nextWakeAt: "2026-03-27T18:00:00.000Z",
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(resultPayload)), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.wake(createActivationWake("evt_native_container", "member_123"));

    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(2);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);
    expect(status.lastEventId).toBe("evt_native_container");
    expect(status.nextWakeAt).toBe("2026-03-27T18:00:00.000Z");
    expectHostedBundleKeys(bucket.keys(), ["vault"]);
  });

  it("deletes hosted raw email bodies from the per-user root-key path after a successful run", async () => {
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: createRunnerSuccessPayload({
              summary: "processed email",
            }),
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(createRunnerSuccessPayload({
            summary: "processed email",
          }))), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const userId = "member_email_cleanup";
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId,
    });
    const rawMessageKey = await writeHostedEmailRawMessage({
      bucket: bucket.api,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      plaintext: new TextEncoder().encode("From: alice@example.test\r\n\r\nhello"),
      userId,
    });

    expect(bucket.keys().filter((key) => key.includes("/messages/"))).toHaveLength(1);

    await runner.wake(createEmailWake({
      eventId: `email:`,
      identityId: "assistant@mail.example.test",
      rawMessageKey,
      userId,
    }));

    expect(bucket.keys().filter((key) => key.includes("/messages/"))).toEqual([]);
  });

  it("deletes hosted raw email bodies after recovering a finalized committed email dispatch", async () => {
    const userId = "member_email_recovery_cleanup";
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId,
    });
    const rawMessageKey = await writeHostedEmailRawMessage({
      bucket: bucket.api,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      plaintext: new TextEncoder().encode("From: alice@example.test\r\n\r\nrecovered"),
      userId,
    });
    const dispatch = createEmailWake({
      eventId: `email:`,
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-03-26T12:00:00.000Z",
      rawMessageKey,
      userId,
    });

    await seedRunnerQueueState({
      runtimeBootstrapped: true,
      bucket,
      environment,
      pendingEvents: [
        {
          attempts: 1,
          availableAt: "2026-03-26T12:00:00.000Z",
          dispatch,
          enqueuedAt: "2026-03-26T12:00:00.000Z",
          lastError: "lost ack",
        },
      ],
      retryingEventId: dispatch.eventId,
      storage,
      userId,
    });

    await createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    }).writeCommittedResult(userId, dispatch.eventId, {
      assistantDeliveryEffects: [],
      bundleRef: null,
      committedAt: "2026-03-26T12:00:01.000Z",
      eventId: dispatch.eventId,
      finalizedAt: "2026-03-26T12:00:02.000Z",
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "recovered email",
      },
      userId,
    });

    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async () => {
          throw new Error("Unexpected runner fetch.");
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    expect(bucket.keys().filter((key) => key.includes("/messages/"))).toHaveLength(1);

    const status = await runner.wake(dispatch);

    expect(status.pendingEventCount).toBe(0);
    expect(bucket.keys().filter((key) => key.includes("/messages/"))).toEqual([]);
  });

  it("sends forwarded env and worker-only runtime config through the per-job runtime payload instead of the container start envelope", async () => {
    const fetchSpy = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

        const payload = {
          bundles: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: Buffer.from("vault").toString("base64"),
          },
          result: {
            eventsHandled: 1,
            summary: "ok",
          },
        };
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload,
          requestBody: JSON.parse(String(init?.body)),
        });

      return new Response(JSON.stringify(serializeRunnerSuccessPayload(payload)), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));
    const runner = new HostedUserRunner(
      storage.state,
      {
        ...environment,
        allowedRunnerSecretKeys: "CUSTOM_API_KEY",
      },
      bucket.api,
      {
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
        OPENAI_API_KEY: "sk-worker",
      },
    );
    await seedManagedUserCryptoForTest(runner, "member_123");
    await writeRunnerSecretsForTest({
      env: {
        CUSTOM_API_KEY: "custom-user",
      },
      userId: "member_123",
    });

    await runner.wake(createActivationWake("evt_native_runtime_env", "member_123"));

    const invokeRequest = storage.runnerContainerFetch.mock.calls.find(([input]) => {
      const request = input instanceof Request ? input : new Request(String(input));
      return new URL(request.url).pathname === "/internal/invoke";
    })?.[0];
    expect(invokeRequest).toBeInstanceOf(Request);
    const invokePayload = JSON.parse(
      await (invokeRequest as Request).clone().text(),
    ) as {
      job: {
        runtime?: {
          commitTimeoutMs?: number;
          forwardedEnv?: Record<string, string>;
          userEnv?: Record<string, string>;
        };
      };
      runnerEnvironment?: unknown;
    };

    expect(invokePayload.runnerEnvironment).toBeUndefined();
    expect(invokePayload.job.runtime).toMatchObject({
      commitTimeoutMs: 45_000,
      forwardedEnv: {
        OPENAI_API_KEY: "sk-worker",
      },
      userEnv: {
        CUSTOM_API_KEY: "custom-user",
      },
    });
  });

  it("reschedules the next wake when alarm handling requires the hosted web callback path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchSpy = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

        const payload = {
          bundles: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: Buffer.from("vault").toString("base64"),
          },
          result: {
            eventsHandled: 1,
            nextWakeAt: null,
            summary: "alarm",
          },
        };
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload,
          requestBody: JSON.parse(String(init?.body)),
        });

      return new Response(JSON.stringify(serializeRunnerSuccessPayload(payload)), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));
    await seedRunnerQueueState({
      runtimeBootstrapped: true,
      bucket,
      environment,
      lastError: null,
      lastEventId: "evt_seed_wake",
      lastRunAt: "2026-03-26T11:59:00.000Z",
      nextWakeAt: "2026-03-26T12:00:05.000Z",
      storage,
      userId: "member_123",
    });
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();

    const status = await runner.status();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(status.lastEventId).toBe("evt_seed_wake");
    expect(status.nextWakeAt).not.toBe("2026-03-26T12:00:05.000Z");
    expect(status.nextWakeAt).toBe("2026-03-26T12:00:15.000Z");
    expect(storage.lastAlarm).toBe(Date.parse("2026-03-26T12:00:15.000Z"));
  });

  it("passes the worker commit callback metadata through the runner container invoke request", async () => {
    const resultPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state").toString("base64"),
      summary: "ok",
      vault: Buffer.from("vault").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(resultPayload)), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");

    await runner.wake(createWake("evt_commit_callback"));

    const invokeCall = storage.runnerContainerFetch.mock.calls.find(([input]) => {
      const request = input instanceof Request ? input : new Request(input);
      return new URL(request.url).pathname === "/internal/invoke";
    });
    expect(invokeCall).toBeDefined();
    const invokeInput = invokeCall?.[0] as Request | string | URL;
    const invokeRequest = invokeInput instanceof Request
      ? invokeInput
      : new Request(invokeInput);
    const invokePayload = JSON.parse(await invokeRequest.text()) as {
      job: {
        request: {
          currentBundleRef: null | { hash: string; key: string; size: number; updatedAt: string };
          run: {
            attempt: number;
            runId: string;
            startedAt: string;
          };
        };
      };
    };

    expect(invokePayload.job.request.currentBundleRef).toBeNull();
    expect(invokePayload.job.request.run).toMatchObject({
      attempt: 1,
      runId: expect.any(String),
      startedAt: expect.any(String),
    });
  });

  it("forwards stored runner secrets through the runner container invoke payload", async () => {
    const resultPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state").toString("base64"),
      summary: "ok",
      vault: Buffer.from("vault").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(resultPayload)), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(
      storage.state,
      {
        ...environment,
        allowedRunnerSecretKeys: "OPENAI_API_KEY",
      },
      bucket.api,
    );

    await seedManagedUserCryptoForTest(runner, "member_123");
    await writeRunnerSecretsForTest({
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      userId: "member_123",
    });
    await runner.wake(createWake("evt_user_env_set"));
    await writeRunnerSecretsForTest({
      env: {},
      userId: "member_123",
    });
    await runner.wake(createWake("evt_user_env_cleared"));

    const invokePayloads = await Promise.all(
      storage.runnerContainerFetch.mock.calls
        .filter(([input]) => {
          const request = input instanceof Request ? input : new Request(input);
          return new URL(request.url).pathname === "/internal/invoke";
        })
        .map(async ([input]) => {
          const request = input instanceof Request ? input : new Request(input);
          const payload = JSON.parse(await request.text()) as {
            job: {
              request: {
                wake: {
                  eventId: string;
                };
              };
              runtime?: {
                userEnv?: Record<string, string>;
              };
            };
          };

          return {
            eventId: payload.job.request.wake.eventId,
            userEnv: payload.job.runtime?.userEnv ?? {},
          };
        }),
    );

    expect(invokePayloads).toEqual([
      {
        eventId: "evt_user_env_set",
        userEnv: {
          OPENAI_API_KEY: "sk-user",
        },
      },
      {
        eventId: "evt_user_env_set",
        userEnv: {
          OPENAI_API_KEY: "sk-user",
        },
      },
      {
        eventId: "evt_user_env_cleared",
        userEnv: {},
      },
      {
        eventId: "evt_user_env_cleared",
        userEnv: {},
      },
    ]);
  });

  it("reconciles final runner bundles after the durable commit path advances earlier bundle refs", async () => {
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: committedPayload,
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(finalPayload)), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");

    const status = await runner.wake(createActivationWake("evt_final_bundles", "member_123"));

    expect(status.bundleRef).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
    });
  });

  it("keeps a successful dispatch green when artifact cleanup deletes fail during commit and finalize transitions", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-cleanup-failure-"));

    try {
      const crypto = await resolveHostedUserCryptoContextForTest({
        bucket,
        environment,
        userId: "member_cleanup_failure",
      });
      const bundleStore = createHostedBundleStore({
        bucket: bucket.api,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
      });
      const artifactStore = createHostedArtifactStore({
        bucket: bucket.api,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
        keysById: crypto.keysById,
        userId: "member_cleanup_failure",
      });
      const previousVaultRoot = path.join(workspaceRoot, "previous-vault");
      const committedVaultRoot = path.join(workspaceRoot, "committed-vault");
      const finalVaultRoot = path.join(workspaceRoot, "final-vault");
      const previousArtifactPath = path.join(previousVaultRoot, "raw", "captures", "previous.jpg");
      const committedArtifactPath = path.join(committedVaultRoot, "raw", "captures", "committed.jpg");

      await mkdir(path.dirname(previousArtifactPath), { recursive: true });
      await mkdir(path.dirname(committedArtifactPath), { recursive: true });
      await mkdir(finalVaultRoot, { recursive: true });
      await writeFile(path.join(previousVaultRoot, "vault.json"), "{\"stage\":\"previous\"}\n");
      await writeFile(previousArtifactPath, Buffer.from("previous-artifact\n", "utf8"));
      await writeFile(path.join(committedVaultRoot, "vault.json"), "{\"stage\":\"committed\"}\n");
      await writeFile(committedArtifactPath, Buffer.from("committed-artifact\n", "utf8"));
      await writeFile(path.join(finalVaultRoot, "vault.json"), "{\"stage\":\"final\"}\n");

      const previousVaultBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (artifact) => {
          const ref = {
            byteSize: artifact.bytes.byteLength,
            sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
          };
          await artifactStore.writeArtifact(ref.sha256, artifact.bytes);
          return ref;
        },
        kind: "vault",
        roots: [
          {
            root: previousVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const committedVaultBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (artifact) => {
          const ref = {
            byteSize: artifact.bytes.byteLength,
            sha256: createHash("sha256").update(artifact.bytes).digest("hex"),
          };
          await artifactStore.writeArtifact(ref.sha256, artifact.bytes);
          return ref;
        },
        kind: "vault",
        roots: [
          {
            root: committedVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const finalVaultBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: finalVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      const [previousArtifact] = listHostedBundleArtifacts({
        bytes: previousVaultBundle!,
        expectedKind: "vault",
      });
      const [committedArtifact] = listHostedBundleArtifacts({
        bytes: committedVaultBundle!,
        expectedKind: "vault",
      });
      const previousVaultRef = await bundleStore.writeBundle("vault", previousVaultBundle!);
      const queueStore = new (await import("../src/user-runner/runner-queue-store.js")).RunnerQueueStore(
        storage.state,
      );
      await queueStore.bootstrapUser("member_cleanup_failure");
      await queueStore.compareAndSwapBundleRefs({
        expectedVersion: 0,
        nextBundleRef: previousVaultRef,
      });

      const deleteArtifactSpy = vi.spyOn(bucket.api, "delete").mockImplementation(async (key: string) => {
        if (key.includes("/artifacts/")) {
          throw new Error("artifact delete failed");
        }

        return undefined;
      });
      vi.stubGlobal(
        "fetch",
        createHostedWakeAwareFetch({
          bucket,
          handler: vi.fn(async (_url, init) => {
            await commitResultForRunnerRequest({
              bucket,
              environment,
              payload: createRunnerSuccessPayload({
                agentState: Buffer.from("agent-state-committed").toString("base64"),
                summary: "committed",
                vault: encodeHostedBundleBase64(committedVaultBundle),
              }),
              requestBody: JSON.parse(String(init?.body)),
            });

            return new Response(JSON.stringify(serializeRunnerSuccessPayload(createRunnerSuccessPayload({
              agentState: Buffer.from("agent-state-final").toString("base64"),
              summary: "final",
              vault: encodeHostedBundleBase64(finalVaultBundle),
            }))), {
              status: 200,
            });
          }),
        }),
      );
      const runner = new HostedUserRunner(storage.state, environment, bucket.api);

      const status = await runner.wake(createWake("evt_cleanup_failure", "member_cleanup_failure"));

      expect(status.lastError).toBeNull();
      expect(status.pendingEventCount).toBe(0);
      expect(status.bundleRef).toMatchObject({
        key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
      });
      expect(bucket.keys()).toContain(
        await hostedArtifactObjectKey(crypto.rootKey, "member_cleanup_failure", previousArtifact!.ref.sha256),
      );
      expect(bucket.keys()).toContain(
        await hostedArtifactObjectKey(crypto.rootKey, "member_cleanup_failure", committedArtifact!.ref.sha256),
      );
      const deletedArtifactKeys = deleteArtifactSpy.mock.calls
        .map(([key]) => String(key))
        .filter((key) => key.includes("users/artifacts/"));
      expect(deletedArtifactKeys.length).toBeGreaterThan(0);
      expect(new Set(deletedArtifactKeys).size).toBe(deletedArtifactKeys.length);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("recovers finalized bundle refs when the runner fails after durable finalize but before returning", async () => {
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-finalized").toString("base64"),
      summary: "finalized",
      vault: Buffer.from("vault-finalized").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          const requestBody = JSON.parse(String(init?.body));
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: committedPayload,
            requestBody,
          });
          await finalizeResultForRunnerRequest({
            bucket,
            environment,
            payload: finalPayload,
            requestBody,
          });
          throw new Error("runner connection dropped after finalize");
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.wake(createActivationWake("evt_finalized_recovery", "member_123"));

    expect(status.lastError).toBeNull();
    expect(status.pendingEventCount).toBe(0);
    expect(status.bundleRef).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
    });
  });

  it("keeps committed events pending until the hosted web callback path can resume finalize retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const sideEffects = [
      createAssistantDeliveryEffect({
        effectId: "outbox_retry",
        fingerprint: "dedupe_retry",
      }),
    ];
    const expectedResumeSideEffects = sideEffects;
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      assistantDeliveryEffects: sideEffects,
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });
    const fetchSpy = vi.fn()
      .mockImplementation(async (url, init) => {
        const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
          bucket,
          init,
          url,
        });
        if (hostedWakeResponse) {
          return hostedWakeResponse;
        }

        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: committedPayload,
          requestBody: JSON.parse(String(init?.body)),
        });
        throw new Error("finalize failed");
      })
      .mockImplementationOnce(async (url, init) => {
        const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
          bucket,
          init,
          url,
        });
        if (hostedWakeResponse) {
          return hostedWakeResponse;
        }

        const requestBody = JSON.parse(String(init?.body));
        expect(readRunnerJobRequest(requestBody).resume).toEqual({
          committedResult: {
            assistantDeliveryEffects: expectedResumeSideEffects,
            result: committedPayload.result,
          },
        });
        await finalizeResultForRunnerRequest({
          bucket,
          environment,
          payload: finalPayload,
          requestBody,
        });

        return new Response(JSON.stringify(serializeRunnerSuccessPayload(finalPayload)), {
          status: 200,
        });
      });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");

    const firstStatus = await runner.wake(createActivationWake("evt_finalize_retry", "member_123"));
    expect(firstStatus.pendingEventCount).toBe(1);
    expect(firstStatus.retryingEventId).toBe("evt_finalize_retry");
    expect(firstStatus.timeline?.at(-1)).toMatchObject({
      message:
        "Hosted wake execution deferred after a direct runner failure. Hosted execution runtime failed. Detail: expected undefined to deeply equal { committedResult: { …(2) } }",
      phase: "retry.scheduled",
    });
    expect(firstStatus.bundleRef).toBeNull();
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);

    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();

    const finalStatus = await runner.status();
    expect(finalStatus.pendingEventCount).toBe(1);
    expect(finalStatus.retryingEventId).toBe("evt_finalize_retry");
    expect(finalStatus.bundleRef).toBeNull();
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);
  });

  it("leaves committed pending crash recovery to the hosted web callback path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const dispatch = createWake("evt_resume_after_crash", "member_123", "2026-03-26T12:00:00.000Z");
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });

    await seedRunnerQueueState({
      activeRunLease: {
        attempt: 1,
        eventId: dispatch.eventId,
        runId: "run_crashed",
        startedAt: dispatch.occurredAt,
      },
      bucket,
      environment,
      inFlight: true,
      pendingEvents: [{
        attempts: 0,
        availableAt: dispatch.occurredAt,
        dispatch,
        enqueuedAt: dispatch.occurredAt,
        lastError: null,
      }],
      storage,
      userId: dispatch.userId,
    });
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: dispatch.userId,
    });
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRef: null,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        assistantDeliveryEffects: [],
        bundle: committedPayload.bundles.vault,
        result: committedPayload.result,
      },
      userId: dispatch.userId,
    });

    const fetchSpy = vi.fn(async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body));
      expect(readRunnerJobRequest(requestBody).resume).toEqual({
        committedResult: {
          assistantDeliveryEffects: [],
          result: committedPayload.result,
        },
      });
      await finalizeResultForRunnerRequest({
        bucket,
        environment,
        payload: finalPayload,
        requestBody,
      });

      return new Response(JSON.stringify(serializeRunnerSuccessPayload(finalPayload)), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    vi.setSystemTime(new Date("2026-03-26T12:01:01.000Z"));
    await runner.alarm();

    const status = await runner.status();
    expect(status.pendingEventCount).toBe(0);
    expect(status.retryingEventId).toBe(dispatch.eventId);
    expect(status.inFlight).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not launch a second resumed run while the first runner is still alive after commit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const dispatch = createWake("evt_live_runner_guard", "member_123", "2026-03-26T12:00:00.000Z");
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });
    const firstCommitRecorded = createDeferred<void>();
    const releaseFirstRunner = createDeferred<void>();
    const fetchSpy = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

      const requestBody = JSON.parse(String(init?.body));
      await commitResultForRunnerRequest({
        bucket,
        environment,
        payload: committedPayload,
        requestBody,
      });
      firstCommitRecorded.resolve();
      await releaseFirstRunner.promise;
      await finalizeResultForRunnerRequest({
        bucket,
        environment,
        payload: finalPayload,
        requestBody,
      });

      return new Response(JSON.stringify(serializeRunnerSuccessPayload(finalPayload)), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");

    const firstDispatch = runner.wake(dispatch);
    await firstCommitRecorded.promise;

    vi.setSystemTime(new Date("2026-03-26T12:00:20.000Z"));
    await runner.alarm();
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(1);

    releaseFirstRunner.resolve();
    await firstDispatch;
    expect((await runner.status()).pendingEventCount).toBe(0);
  });

  it("does not steal a live commit lease after a runner restart before finalize completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const dispatch = createWake("evt_restart_live_commit_guard", "member_123", "2026-03-26T12:00:00.000Z");
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });
    const firstCommitRecorded = createDeferred<void>();
    const releaseFirstRunner = createDeferred<void>();
    const fetchSpy = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

      const requestBody = JSON.parse(String(init?.body));
      await commitResultForRunnerRequest({
        bucket,
        environment,
        payload: committedPayload,
        requestBody,
      });
      firstCommitRecorded.resolve();
      await releaseFirstRunner.promise;
      await finalizeResultForRunnerRequest({
        bucket,
        environment,
        payload: finalPayload,
        requestBody,
      });

      return new Response(JSON.stringify(serializeRunnerSuccessPayload(finalPayload)), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));
    const firstRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(firstRunner, "member_123");

    const firstDispatch = firstRunner.wake(dispatch);
    await firstCommitRecorded.promise;

    vi.setSystemTime(new Date("2026-03-26T12:00:20.000Z"));
    const restartedRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await restartedRunner.alarm();

    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(1);

    releaseFirstRunner.resolve();
    const finalStatus = await firstDispatch;
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);
    expect((await restartedRunner.status()).pendingEventCount).toBe(0);
  });

  it("does not clear a live commit lease when the same event is redispatched before finalize completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const dispatch = createWake("evt_restart_dispatch_guard", "member_123", "2026-03-26T12:00:00.000Z");
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });
    const firstCommitRecorded = createDeferred<void>();
    const releaseFirstRunner = createDeferred<void>();
    const fetchSpy = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

      const requestBody = JSON.parse(String(init?.body));
      await commitResultForRunnerRequest({
        bucket,
        environment,
        payload: committedPayload,
        requestBody,
      });
      firstCommitRecorded.resolve();
      await releaseFirstRunner.promise;
      await finalizeResultForRunnerRequest({
        bucket,
        environment,
        payload: finalPayload,
        requestBody,
      });

      return new Response(JSON.stringify(serializeRunnerSuccessPayload(finalPayload)), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));
    const firstRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(firstRunner, "member_123");

    const firstDispatch = firstRunner.wake(dispatch);
    await firstCommitRecorded.promise;

    vi.setSystemTime(new Date("2026-03-26T12:00:20.000Z"));
    const restartedRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    const duplicateStatus = await restartedRunner.wake(dispatch);

    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(1);
    expect(duplicateStatus).toMatchObject({
      inFlight: true,
      lastEventId: dispatch.eventId,
    });

    releaseFirstRunner.resolve();
    const finalStatus = await firstDispatch;
    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(0);
  });

  it("keeps the active run lease through a long commit-to-finalize handoff so alarms do not start a duplicate finalize", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const commitInvokeStarted = createDeferred<void>();
    const releaseCommitPhase = createDeferred<void>();
    const resumeInvokeStarted = createDeferred<void>();
    const releaseFinalizePhase = createDeferred<void>();
    let resumeInvokeCount = 0;
    const committedPayload = createRunnerSuccessPayload({
      summary: "committed",
    });
    const finalPayload = createRunnerSuccessPayload({
      summary: "completed",
    });

    vi.stubGlobal("fetch", createHostedWakeAwareFetch({
      bucket,
      handler: vi.fn().mockImplementation(async (url, init) => {
        const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
          bucket,
          init,
          url,
        });
        if (hostedWakeResponse) {
          return hostedWakeResponse;
        }

      const request = readRunnerJobRequest(JSON.parse(String(init?.body)));

      if (request.resume) {
        resumeInvokeCount += 1;
        if (resumeInvokeCount === 1) {
          resumeInvokeStarted.resolve();
        }
        await releaseFinalizePhase.promise;
        return new Response(JSON.stringify(serializeRunnerSuccessPayload(finalPayload)), {
          status: 200,
        });
      }

      commitInvokeStarted.resolve();
      await releaseCommitPhase.promise;
      return new Response(JSON.stringify(serializeRunnerCommittedPayload(committedPayload)), {
        status: 200,
      });
      }),
    }));

    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");
    const dispatch = createWake("evt_long_finalize_lease");

    const firstDispatch = runner.wake(dispatch);
    await commitInvokeStarted.promise;

    vi.setSystemTime(new Date("2026-03-26T12:00:20.000Z"));
    releaseCommitPhase.resolve();
    await resumeInvokeStarted.promise;

    const alarmPromise = runner.alarm();
    await Promise.resolve();
    await Promise.resolve();

    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(2);

    releaseFinalizePhase.resolve();
    const [finalStatus] = await Promise.all([firstDispatch, alarmPromise]);

    expect(finalStatus.lastError).toBeNull();
    expect(finalStatus.pendingEventCount).toBe(1);
    expect(finalStatus.lastEventId).toBe("evt_long_finalize_lease");
    expect(finalStatus.run).toBeUndefined();
  });


  it("reuses existing bundle refs when the runner returns unchanged bundle payloads", async () => {
    const encodedAgent = Buffer.from("agent-state").toString("base64");
    const encodedVault = Buffer.from("vault").toString("base64");
    const resultPayload = {
      bundles: {
        agentState: encodedAgent,
        vault: encodedVault,
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(resultPayload)), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");

    const first = await runner.wake(createActivationWake("evt_first", "member_123"));
    const writeCountAfterFirstRun = bucket.putCount();

    const second = await runner.wake(createWake("evt_second", "member_123"));

    expect(second.bundleRef).toEqual(first.bundleRef);
    expect(bucket.putCount()).toBe(writeCountAfterFirstRun + 4);
  });

  it("does not locally poison retrying events once alarm handling depends on hosted web wakes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url, init) => {
        const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
          bucket,
          init,
          url,
        });
        if (hostedWakeResponse) {
          return hostedWakeResponse;
        }

        return new Response("runner failed", {
          status: 503,
        });
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");

    const first = await runner.wake(createWake("evt_retry_1", "member_123"));

    expect(first.lastError).toBe("Hosted runner container returned an HTTP error.");
    expect(first.lastErrorCode).toBe("runner_http_error");
    expect(first.pendingEventCount).toBe(1);
    expect(first.retryingEventId).toBe("evt_retry_1");
    expect(first.run).toMatchObject({
      attempt: 1,
      eventId: "evt_retry_1",
      phase: "retry.scheduled",
    });
    expect(first.timeline?.map((entry) => entry.phase)).toEqual([
      "claimed",
      "dispatch.running",
      "retry.scheduled",
    ]);
    expect(new Set((first.timeline ?? []).map((entry) => entry.runId)).size).toBe(1);
    expect(first.timeline?.at(-1)).toMatchObject({
      errorCode: "runner_http_error",
      phase: "retry.scheduled",
    });

    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();
    vi.setSystemTime(new Date("2026-03-26T12:00:30.000Z"));
    await runner.alarm();

    const final = await runner.status();

    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(final.pendingEventCount).toBe(1);
    expect(final.poisonedEventIds).toEqual([]);
    expect(final.retryingEventId).toBe("evt_retry_1");
    expect(final.lastError).toBe("Hosted runner container returned an HTTP error.");
    expect(final.lastErrorCode).toBe("runner_http_error");
    expect(final.run).toMatchObject({
      attempt: 1,
      eventId: "evt_retry_1",
      phase: "retry.scheduled",
    });
    expect(final.timeline?.slice(-3).map((entry) => entry.phase)).toEqual([
      "claimed",
      "dispatch.running",
      "retry.scheduled",
    ]);
  });

  it("redacts retryable runner failures before persisting hosted status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn().mockRejectedValue(
          new Error("Authorization: Bearer secret-token for ops@example.com OPENAI_API_KEY=sk-live-secret"),
        ),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");

    const status = await runner.wake(createWake("evt_secret_failure", "member_123"));

    expect(status.lastError).toBe("Hosted execution authorization failed.");
    expect(status.lastErrorCode).toBe("authorization_error");
    expect(status.lastError).not.toContain("secret-token");
    expect(status.lastError).not.toContain("ops@example.com");
    expect(status.pendingEventCount).toBe(1);
    expect(status.retryingEventId).toBe("evt_secret_failure");
  });

  it("does not drain queued work locally from alarm without the hosted web callback path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchMock = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

      const requestBody = readRunnerJobRequest(JSON.parse(String(init?.body)));

      if (requestBody.wake.eventId === "evt_retry_head") {
        return new Response("runner failed", {
          status: 503,
        });
      }

      return createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchMock }));
    await seedRunnerQueueState({
      bucket,
      environment,
      pendingEvents: [
        {
          attempts: 0,
          availableAt: "2026-03-26T12:00:00.000Z",
          dispatch: createWake("evt_retry_head"),
          enqueuedAt: "2026-03-26T12:00:00.000Z",
          lastError: null,
        },
        {
          attempts: 0,
          availableAt: "2026-03-26T12:00:00.000Z",
          dispatch: createWake("evt_tail"),
          enqueuedAt: "2026-03-26T12:00:01.000Z",
          lastError: null,
        },
      ],
      storage,
      userId: "member_123",
    });
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.alarm();

    expect(readDispatchedEventIds(fetchMock)).toEqual([]);
    await expect(runner.status()).resolves.toMatchObject({
      pendingEventCount: 0,
      poisonedEventIds: [],
    });
  });

  it("recovers a durable finalize when the runner response is lost", async () => {
    let sideEffects = 0;
    const resultPayload = {
      bundles: {
        agentState: Buffer.from("agent-state").toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          sideEffects += 1;
          const requestBody = JSON.parse(String(init?.body));
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody,
          });
          await finalizeResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody,
          });
          throw new Error("network timeout");
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");
    const dispatch = createWake("evt_lost_response", "member_123", "2026-03-26T12:15:00.000Z");

    const first = await runner.wake(dispatch);
    const second = await runner.wake(dispatch);

    expect(first.pendingEventCount).toBe(0);
    expect(first.lastError).toBeNull();
    expect(first.lastEventId).toBe("evt_lost_response");
    expect(second.pendingEventCount).toBe(0);
    expect(sideEffects).toBe(1);
  });

  it("resolves duplicate queued wakes through the canonical web wake queue", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");
    const dispatch = createWake("evt_duplicate_pending");
    await appendTestHostedWake({
      bucket: bucket.api,
      wake: dispatch,
    });
    const fetchMock = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

      return createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchMock }));

    const result = await runner.wakeWithOutcome(dispatch);

    expect(result.event).toEqual({
      eventId: "evt_duplicate_pending",
      lastError: null,
      state: "completed",
      userId: "member_123",
    });
    expect(result.status.pendingEventCount).toBe(0);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBeGreaterThan(0);
  });

  it("reports duplicate consumed events through the shared dispatch outcome surface", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

      return createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchMock }));
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");
    const dispatch = createWake("evt_duplicate_consumed");

    const first = await runner.wakeWithOutcome(dispatch);
    const invokesAfterFirstDispatch = countRunnerContainerCalls(
      storage.runnerContainerFetch,
      "/internal/invoke",
    );
    const second = await runner.wakeWithOutcome(dispatch);

    expect(first.event.state).toBe("completed");
    expect(second.event).toEqual({
      eventId: "evt_duplicate_consumed",
      lastError: null,
      state: "completed",
      userId: "member_123",
    });
    expect(invokesAfterFirstDispatch).toBeGreaterThan(0);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(
      invokesAfterFirstDispatch,
    );
  });

  it("degrades duplicate dispatch outcomes to queued when canonical dispatch status is unavailable", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

      return createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      });
    });
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchMock }));
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");
    const dispatch = createWake("evt_duplicate_consumed_status_fallback");

    const first = await runner.wakeWithOutcome(dispatch);
    const invokesAfterFirstDispatch = countRunnerContainerCalls(
      storage.runnerContainerFetch,
      "/internal/invoke",
    );
    const readHostedWakeStatusSpy = vi.spyOn(
      runner as unknown as {
        readHostedWakeStatus: (...args: never[]) => Promise<unknown>;
      },
      "readHostedWakeStatus",
    );
    readHostedWakeStatusSpy.mockResolvedValueOnce(null);
    const second = await runner.wakeWithOutcome(dispatch);

    expect(first.event.state).toBe("completed");
    expect(second.event).toEqual({
      eventId: "evt_duplicate_consumed_status_fallback",
      lastError: null,
      state: "queued",
      userId: "member_123",
    });
    expect(second.status.pendingEventCount).toBe(0);
    expect(second.status.lastEventId).toBe("evt_duplicate_consumed_status_fallback");
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(
      invokesAfterFirstDispatch,
    );
  });

  it("reports poisoned events through the shared dispatch outcome surface without rerunning them", async () => {
    const dispatch = createWake("evt_duplicate_poisoned");
    const appended = await appendTestHostedWake({
      bucket: bucket.api,
      wake: dispatch,
    });
    await seedRunnerQueueState({
      bucket,
      environment,
      lastError: "Hosted runner container returned an HTTP error.",
      lastErrorAt: "2026-03-26T12:00:30.000Z",
      storage,
      userId: dispatch.userId,
    });
    await quarantineTestHostedWake({
      body: {
        quarantineCode: "duplicate-poisoned-test",
        wakeId: appended.wake.id,
      },
      bucket: bucket.api,
      userId: dispatch.userId,
    });
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, dispatch.userId);
    const replayFetch = vi.fn(async (url, init) => {
      const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
        bucket,
        init,
        url,
      });
      if (hostedWakeResponse) {
        return hostedWakeResponse;
      }

      throw new Error(`Unexpected fetch during poisoned duplicate replay: ${String(url)}`);
    });
    vi.stubGlobal("fetch", replayFetch);

    const replayed = await runner.wakeWithOutcome(dispatch);

    expect(replayed.event).toEqual({
      eventId: "evt_duplicate_poisoned",
      lastError: null,
      state: "poisoned",
      userId: "member_123",
    });
    expect(replayed.status.poisonedEventIds).toEqual([]);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(0);
  });

  it("keeps an event pending when the runner returns 200 before the durable commit exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          bundles: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: Buffer.from("vault").toString("base64"),
          },
          result: {
            eventsHandled: 1,
            summary: "ok",
          },
        }),
        {
          status: 200,
        },
      ),
    );
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchMock }));
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");
    const dispatch = createWake("evt_missing_commit", "member_123", "2026-03-26T12:18:00.000Z");

    const first = await runner.wake(dispatch);

    expect(first.pendingEventCount).toBe(1);
    expect(first.retryingEventId).toBe("evt_missing_commit");
    expect(first.lastError).toBe("Hosted execution failed before recording a durable commit.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: dispatch.userId,
    });
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRef: null,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        assistantDeliveryEffects: [],
        bundle: Buffer.from("vault").toString("base64"),
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: dispatch.userId,
    });
    await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        bundle: Buffer.from("vault").toString("base64"),
      },
      userId: dispatch.userId,
    });

    const second = await runner.wake(dispatch);

    expect(second.pendingEventCount).toBe(0);
    expect(second.retryingEventId).toBeNull();
    expect(second.lastError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies a prefinalized event on retry without rerunning side effects", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = createWake("evt_ack_lost", "member_123", "2026-03-26T12:20:00.000Z");
    await seedRunnerQueueState({
      runtimeBootstrapped: false,
      bucket,
      environment,
      lastError: "timeout",
      lastEventId: dispatch.eventId,
      pendingEvents: [
        {
          attempts: 1,
          availableAt: dispatch.occurredAt,
          dispatch,
          enqueuedAt: dispatch.occurredAt,
          lastError: "timeout",
        },
      ],
      retryingEventId: dispatch.eventId,
      storage,
      userId: dispatch.userId,
    });
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: dispatch.userId,
    });
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRef: null,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        assistantDeliveryEffects: [],
        bundle: Buffer.from("vault").toString("base64"),
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: dispatch.userId,
    });
    await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        bundle: Buffer.from("vault").toString("base64"),
      },
      userId: dispatch.userId,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchMock }));

    const status = await runner.wake(dispatch);

    expect(status.pendingEventCount).toBe(0);
    expect(status.retryingEventId).toBeNull();
    expect(status.lastError).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      createHostedExecutionJournalStore({
        bucket: bucket.api,
        key: environment.platformEnvelopeKey,
        keyId: environment.platformEnvelopeKeyId,
      }).readCommittedResult(dispatch.userId, dispatch.eventId),
    ).resolves.toBeNull();
  });

  it("does not require an ambient runner control token because the container shell manages its own supervisor token", async () => {
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        })),
      }),
    );
    const runner = new HostedUserRunner(storage.state, {
      ...environment,
    }, bucket.api);
    await seedManagedUserCryptoForTest(runner, "member_123");

    const status = await runner.wake(createWake("evt_per_run_runner_token", "member_123"));

    expect(status.pendingEventCount).toBe(0);
    expect(status.poisonedEventIds).toEqual([]);
    expect(status.retryingEventId).toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.lastErrorCode).toBeUndefined();
    expect(status.run).toBeUndefined();
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(2);
  });

  it("keeps replay suppression after a durable-object restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    }));
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));

    const firstRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(firstRunner, "member_123");
    await firstRunner.wake(createWake("evt_restart_safe", "member_123"));

    const restartedRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    vi.setSystemTime(new Date("2026-03-26T12:30:00.000Z"));
    await restartedRunner.wake(createWake("evt_restart_safe", "member_123"));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("allows consumed event ids to be retried after the 30-day exact tombstone expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    }));
    vi.stubGlobal("fetch", createHostedWakeAwareFetch({ bucket, handler: fetchSpy }));

    const firstRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await seedManagedUserCryptoForTest(firstRunner, "member_123");
    await firstRunner.wake(createWake("evt_ttl_expiry", "member_123"));

    vi.setSystemTime(new Date("2026-04-26T12:00:01.000Z"));
    const restartedRunner = new HostedUserRunner(storage.state, environment, bucket.api);

    await restartedRunner.status();
    await restartedRunner.wake(createWake("evt_ttl_expiry", "member_123"));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps poisoned wakes blocked even after the old replay TTL window passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const dispatch = createWake("evt_poison_expiry");
    const appended = await appendTestHostedWake({
      bucket: bucket.api,
      wake: dispatch,
    });
    await seedRunnerQueueState({
      bucket,
      environment,
      lastError: "Hosted runner container returned an HTTP error.",
      lastErrorAt: "2026-03-26T12:00:30.000Z",
      storage,
      userId: "member_123",
    });
    await quarantineTestHostedWake({
      body: {
        quarantineCode: "poison-expiry-test",
        wakeId: appended.wake.id,
      },
      bucket: bucket.api,
      userId: "member_123",
    });
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    expect((await runner.status()).poisonedEventIds).toEqual([]);

    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        })),
      }),
    );
    vi.setSystemTime(new Date("2026-04-02T12:00:31.000Z"));
    const replayed = await runner.wakeWithOutcome(dispatch);

    expect(replayed.event).toEqual({
      eventId: "evt_poison_expiry",
      lastError: null,
      state: "poisoned",
      userId: "member_123",
    });
    expect(replayed.status.poisonedEventIds).toEqual([]);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(0);
  });

  it("stores encrypted runner-secret config in a dedicated hosted object", async () => {
    const runner = new HostedUserRunner(storage.state, {
      ...environment,
      allowedRunnerSecretKeys: "OPENAI_API_KEY,XAI_API_KEY",
    }, bucket.api);

    await seedManagedUserCryptoForTest(runner, "member_123");
    await writeRunnerSecretsForTest({
      env: {
        OPENAI_API_KEY: "sk-user",
        XAI_API_KEY: "xai-user",
      },
      userId: "member_123",
    });

    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });
    expect(bucket.keys()).toEqual(expect.arrayContaining([
      await runnerSecretsObjectKeyForTest(crypto.rootKey, "member_123"),
      await userKeyEnvelopeObjectKeyForTest(environment.platformEnvelopeKey, "member_123"),
    ]));
  });

  it("reads runner secrets encrypted with a previous key id after rotation", async () => {
    const previousKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const previousEnvironment = {
      ...environment,
      allowedRunnerSecretKeys: "OPENAI_API_KEY",
      platformEnvelopeKey: previousKey,
      platformEnvelopeKeyId: "v1",
      platformEnvelopeKeysById: {
        v1: previousKey,
      },
    };
    const rotatedEnvironment = {
      ...environment,
      allowedRunnerSecretKeys: "OPENAI_API_KEY",
      platformEnvelopeKey: Uint8Array.from({ length: 32 }, () => 7),
      platformEnvelopeKeyId: "v2",
      platformEnvelopeKeysById: {
        v1: previousKey,
        v2: Uint8Array.from({ length: 32 }, () => 7),
      },
    };
    const previousRunner = new HostedUserRunner(storage.state, previousEnvironment, bucket.api);

    await seedManagedUserCryptoForTest(previousRunner, "member_123", previousEnvironment);
    await writeRunnerSecretsForTest({
      env: {
        OPENAI_API_KEY: "sk-legacy",
      },
      environmentOverride: previousEnvironment,
      userId: "member_123",
    });

    const runner = new HostedUserRunner(storage.state, rotatedEnvironment, bucket.api);

    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
          bucket,
          environment: rotatedEnvironment,
          init,
        })),
      }),
    );

    await runner.wake(createWake("evt_rotated_user_env"));

    const invokePayloads = await Promise.all(
      storage.runnerContainerFetch.mock.calls
        .filter(([input]) => {
          const request = input instanceof Request ? input : new Request(input);
          return new URL(request.url).pathname === "/internal/invoke";
        })
        .map(async ([input]) => {
          const request = input instanceof Request ? input : new Request(input);
          const payload = JSON.parse(await request.text()) as {
            job: {
              request: {
                wake: {
                  eventId: string;
                };
              };
              runtime?: {
                userEnv?: Record<string, string>;
              };
            };
          };

          return {
            eventId: payload.job.request.wake.eventId,
            userEnv: payload.job.runtime?.userEnv ?? {},
          };
        }),
    );

    expect(invokePayloads).toEqual([
      {
        eventId: "evt_rotated_user_env",
        userEnv: {
          OPENAI_API_KEY: "sk-legacy",
        },
      },
      {
        eventId: "evt_rotated_user_env",
        userEnv: {
          OPENAI_API_KEY: "sk-legacy",
        },
      },
    ]);
  });

  it("clears runner secrets without dropping unrelated agent-state bundle data", async () => {
    const initialAgentState = writeHostedBundleTextFile({
      bytes: null,
      kind: "vault",
      path: "automation.json",
      root: "assistant-state",
      text: "{\"autoReplyChannels\":[\"linq\"]}\n",
    });
    const resultPayload = {
      bundles: {
        agentState: Buffer.from(initialAgentState).toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(resultPayload)), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.wake(createActivationWake("evt_bootstrap", "member_123"));
    const writesAfterBootstrap = bucket.putCount();

    await writeRunnerSecretsForTest({
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      userId: "member_123",
    });
    expect(bucket.putCount()).toBe(writesAfterBootstrap + 1);
    expectHostedBundleKeys(bucket.keys(), ["vault"]);
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });
    expect(bucket.keys()).toContain(
      await runnerSecretsObjectKeyForTest(crypto.rootKey, "member_123"),
    );

    await writeRunnerSecretsForTest({
      env: {},
      userId: "member_123",
    });

    expectHostedBundleKeys(bucket.keys(), ["vault"]);
    expect(bucket.keys()).not.toContain(
      await runnerSecretsObjectKeyForTest(crypto.rootKey, "member_123"),
    );
  });

  it("reschedules the durable-object alarm when no hosted web callback path is configured", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const resultPayload = {
      bundles: {
        agentState: Buffer.from("agent-state").toString("base64"),
        vault: Buffer.from("vault").toString("base64"),
      },
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
    };
    vi.stubGlobal(
      "fetch",
      createHostedWakeAwareFetch({
        bucket,
        handler: vi.fn(async (_url, init) => {
          await commitResultForRunnerRequest({
            bucket,
            environment,
            payload: resultPayload,
            requestBody: JSON.parse(String(init?.body)),
          });

          return new Response(JSON.stringify(serializeRunnerSuccessPayload(resultPayload)), {
            status: 200,
          });
        }),
      }),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.wake(createActivationWake("evt_alarm_clear", "member_123"));
    expect(storage.lastAlarm).toBeNull();
    storage.lastAlarm = Date.parse("2026-03-26T12:05:00.000Z");
    await runner.alarm();

    expect(storage.lastAlarm).toBeNull();
  });
});

function createBucket() {
  const values = new Map<string, string>();
  let writes = 0;

  return {
    api: {
      async delete(key: string) {
        values.delete(key);
      },
      async get(key: string) {
        const value = values.get(key);

        if (!value) {
          return null;
        }

        return {
          async arrayBuffer() {
            const bytes = new TextEncoder().encode(value);
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer;
          },
        };
      },
      async put(key: string, value: string) {
        writes += 1;
        values.set(key, value);
      },
      async list(input?: { cursor?: string; limit?: number; prefix?: string }) {
        const prefix = input?.prefix ?? "";
        const matching = [...values.keys()]
          .filter((key) => key.startsWith(prefix))
          .sort();
        const startIndex = input?.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0;
        const limit = Math.max(1, input?.limit ?? matching.length ?? 1);
        const page = matching.slice(startIndex, startIndex + limit);
        const nextIndex = startIndex + page.length;

        return {
          cursor: nextIndex < matching.length ? String(nextIndex) : undefined,
          objects: page.map((key) => ({ key })),
          truncated: nextIndex < matching.length,
        };
      },
    },
    clear() {
      values.clear();
      writes = 0;
    },
    keys() {
      return [...values.keys()].sort();
    },
    putCount() {
      return writes;
    },
  };
}

function createStorage() {
  const values = new Map<string, unknown>();
  const sql = createTestSqlStorage();
  const runnerContainerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === "/internal/invoke") {
      return globalThis.fetch("https://runner-container.internal/__internal/run", {
        body: await request.clone().text(),
        headers: {
          authorization: request.headers.get("authorization") ?? "",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      });
    }

    if (url.pathname === "/internal/destroy") {
      return new Response(null, { status: 204 });
    }

    return new Response("Not found", { status: 404 });
  });
  const runnerContainerNamespace = {
    getByName() {
      return {
        async destroyInstance() {
          await runnerContainerFetch(new Request("https://runner.internal/internal/destroy", {
            headers: {
              authorization: "Bearer runner-token",
            },
            method: "POST",
          }));
        },
        async invoke(payload: Record<string, unknown>) {
          const response = await runnerContainerFetch(new Request("https://runner.internal/internal/invoke", {
            body: JSON.stringify(payload),
            headers: {
              authorization: "Bearer runner-token",
              "content-type": "application/json; charset=utf-8",
            },
            method: "POST",
          }));

          if (!response.ok) {
            throw new Error(`Runner container returned HTTP ${response.status}.`);
          }

          return await response.json();
        },
      };
    },
  };
  const state = {
    runnerContainerNamespace,
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return values.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        values.set(key, value);
      },
      async deleteAlarm(): Promise<void> {
        storage.lastAlarm = null;
      },
      async getAlarm(): Promise<number | null> {
        return storage.lastAlarm;
      },
      async setAlarm(value: number | Date): Promise<void> {
        storage.lastAlarm = value instanceof Date ? value.getTime() : value;
      },
      sql,
    },
  };
  const storage = {
    clear() {
      values.clear();
      storage.lastAlarm = null;
      sql.reset();
      runnerContainerFetch.mockClear();
    },
    lastAlarm: null as number | null,
    runnerContainerFetch,
    runnerContainerNamespace,
    state,
  };

  return storage;
}

async function seedRunnerQueueState(
  input: {
    activeRunLease?: {
      attempt: number;
      eventId: string;
      runId: string;
      startedAt: string;
    } | null;
    runtimeBootstrapped?: boolean;
    backpressuredEventIds?: string[];
    bucket: ReturnType<typeof createBucket>;
    environment: HostedExecutionEnvironment;
    inFlight?: boolean;
    lastError?: string | null;
    lastErrorAt?: string | null;
    lastErrorCode?: string | null;
    lastEventId?: string | null;
    lastRunAt?: string | null;
    nextWakeAt?: string | null;
    run?: {
      attempt: number;
      eventId: string;
      phase: string;
      runId: string;
      startedAt: string;
      updatedAt: string;
    } | null;
    timeline?: Array<{
      at: string;
      attempt: number;
      component: string;
      errorCode?: string | null;
      eventId: string;
      level: string;
      message: string;
      phase: string;
      runId: string;
    }>;
    pendingEvents?: Array<{
      attempts: number;
      availableAt: string;
      dispatch: HostedExecutionWake | {
        event: Record<string, unknown>;
        eventId: string;
        occurredAt: string;
      };
      enqueuedAt: string;
      lastError: string | null;
    }>;
    poisonedEvents?: Array<{
      eventId: string;
      lastError: string;
      poisonedAt: string;
    }>;
    retryingEventId?: string | null;
    storage: ReturnType<typeof createStorage>;
    userId: string;
  },
): Promise<void> {
  const { storage } = input;
  const sql = storage.state.storage.sql;
  if (!sql) {
    throw new Error("Test storage.sql is required.");
  }

  sql.exec("DELETE FROM runner_bundle_slots");
  sql.exec("DELETE FROM runner_meta");

  const seedErrorCode = input.lastErrorCode
    ?? (input.lastError ? deriveHostedExecutionErrorCode(input.lastError) : null);

  sql.exec(
    `INSERT INTO runner_meta (
      singleton,
      user_id,
      active_run_event_id,
      active_run_id,
      active_run_attempt,
      active_run_started_at,
      runtime_bootstrapped,
      in_flight,
      last_error_at,
      last_error_code,
      last_event_id,
      last_run_at,
      next_wake_at,
      retrying_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    1,
    input.userId,
    input.activeRunLease?.eventId ?? null,
    input.activeRunLease?.runId ?? null,
    input.activeRunLease?.attempt ?? null,
    input.activeRunLease?.startedAt ?? null,
    input.runtimeBootstrapped ? 1 : 0,
      input.inFlight ? 1 : 0,
      input.lastErrorAt ?? null,
      seedErrorCode,
      input.lastEventId ?? null,
      input.lastRunAt ?? null,
      input.nextWakeAt ?? null,
      input.retryingEventId ?? null,
    );

  sql.exec(
    `INSERT INTO runner_bundle_slots (slot, bundle_ref_json, bundle_version)
    VALUES (?, ?, ?)`,
    "vault",
    null,
    0,
  );
}

function countRunnerContainerCalls(
  fetchMock: ReturnType<typeof vi.fn>,
  pathname: string,
): number {
  return fetchMock.mock.calls.filter(([input]) => {
    const request = input instanceof Request ? input : new Request(String(input));
    return new URL(request.url).pathname === pathname;
  }).length;
}

function expectHostedBundleKeys(
  keys: string[],
  kinds: Array<"vault">,
): void {
  for (const kind of kinds) {
    expect(keys).toContainEqual(expect.stringMatching(
      new RegExp(`^bundles/${kind}/[0-9a-f]+\\.bundle\\.json$`, "u"),
    ));
  }
}

async function runnerSecretsObjectKeyForTest(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "runner-secrets-path",
    value: `user:${userId}`,
  });

  return `users/runner-secrets/${userSegment}.json`;
}

async function userKeyEnvelopeObjectKeyForTest(
  envelopeEncryptionKey: Uint8Array,
  userId: string,
): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey: envelopeEncryptionKey,
    scope: "user-key-envelope-path",
    value: `user:${userId}`,
  });

  return `users/keys/${userSegment}.json`;
}

function createGatewayProjectionSnapshot(input: {
  generatedAt: string;
  lastActivityAt: string;
  lastMessagePreview: string;
  messageCount: number;
  messages: Array<{
    actorDisplayName: string | null;
    createdAt: string;
    direction: "inbound" | "outbound";
    messageId: string;
    text: string;
  }>;
  title: string;
}): GatewayProjectionSnapshot {
  const routeKey = "channel:email|identity:murph%40example.com|thread:thread-labs";
  const sessionKey = createGatewayConversationSessionKey(routeKey);

  return {
    conversations: [{
      canSend: true,
      lastActivityAt: input.lastActivityAt,
      lastMessagePreview: input.lastMessagePreview,
      messageCount: input.messageCount,
      route: {
        channel: "email",
        directness: "group",
        identityId: "murph@example.com",
        participantId: "contact:alex",
        reply: {
          kind: "thread",
          target: "thread-labs",
        },
        threadId: "thread-labs",
      },
      schema: "murph.gateway-conversation.v1",
      sessionKey,
      title: input.title,
      titleSource: "thread-title",
    }],
    generatedAt: input.generatedAt,
    messages: input.messages.map((message) => ({
      actorDisplayName: message.actorDisplayName,
      attachments: [],
      createdAt: message.createdAt,
      direction: message.direction,
      messageId: message.messageId,
      schema: "murph.gateway-message.v1",
      sessionKey,
      text: message.text,
    })),
    permissions: [],
    schema: "murph.gateway-projection-snapshot.v1",
  };
}

function createWake(
  eventId: string,
  userId = "member_123",
  occurredAt = "2026-03-26T12:00:00.000Z",
): HostedExecutionWake {
  return buildHostedExecutionAssistantCronTickWake({
    eventId,
    occurredAt,
    reason: "manual",
    userId,
  });
}

function createActivationWake(
  eventId: string,
  userId = "member_123",
  occurredAt = "2026-03-26T12:00:00.000Z",
): HostedExecutionWake {
  return buildHostedExecutionMemberActivatedWake({
    eventId,
    memberChannels: {
      email: false,
      linq: false,
      telegram: false,
    },
    memberId: userId,
    occurredAt,
  });
}

function createEmailWake(input: {
  eventId: string;
  identityId: string | null;
  occurredAt?: string;
  rawMessageKey: string;
  userId: string;
}): HostedExecutionWake {
  return buildHostedExecutionEmailConversationMessageWake({
    eventId: input.eventId,
    identityId: input.identityId,
    occurredAt: input.occurredAt ?? "2026-03-26T12:00:00.000Z",
    rawMessageKey: input.rawMessageKey,
    userId: input.userId,
  });
}

function createRunnerCommitContext(overrides: Partial<{
  attempt: number;
  runId: string;
  startedAt: string;
}> = {}) {
  return {
    attempt: overrides.attempt ?? 1,
    runId: overrides.runId ?? "run_123",
    startedAt: overrides.startedAt ?? "2026-03-26T12:00:00.000Z",
  };
}

async function seedPendingCommitEvent(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: HostedExecutionEnvironment;
  eventId: string;
  run?: ReturnType<typeof createRunnerCommitContext>;
  storage: ReturnType<typeof createStorage>;
  userId: string;
}): Promise<void> {
  const wake = createWake(input.eventId, input.userId);
  const run = input.run ?? createRunnerCommitContext();
  await seedRunnerQueueState({
    activeRunLease: {
      attempt: run.attempt,
      eventId: input.eventId,
      runId: run.runId,
      startedAt: run.startedAt,
    },
    bucket: input.bucket,
    environment: input.environment,
    inFlight: true,
    pendingEvents: [{
      attempts: 0,
      availableAt: wake.occurredAt,
      dispatch: wake,
      enqueuedAt: wake.occurredAt,
      lastError: null,
    }],
    storage: input.storage,
    userId: input.userId,
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

interface RunnerSuccessPayload {
  bundles: {
    agentState: string | null;
    vault: string | null;
  };
  gatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  result: {
    eventsHandled: number;
    nextWakeAt?: string | null;
    summary: string;
  };
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
}

type RunnerSuccessPayloadLike = Partial<
  Omit<RunnerSuccessPayload, "bundles" | "result">
> & {
  bundles?: Partial<RunnerSuccessPayload["bundles"]>;
  result?: Partial<RunnerSuccessPayload["result"]>;
};

function normalizeRunnerSuccessPayload(
  input: RunnerSuccessPayloadLike = {},
): RunnerSuccessPayload {
  const nextWakeAt = input.result?.nextWakeAt;

  return {
    bundles: {
      agentState: input.bundles?.agentState ?? null,
      vault: input.bundles?.vault ?? null,
    },
    gatewayProjectionSnapshot: input.gatewayProjectionSnapshot ?? null,
    result: {
      eventsHandled: input.result?.eventsHandled ?? 1,
      ...(nextWakeAt !== undefined ? { nextWakeAt } : {}),
      summary: input.result?.summary ?? "ok",
    },
    assistantDeliveryEffects: input.assistantDeliveryEffects ?? [],
  };
}

function createRunnerSuccessPayload(input: Partial<{
  agentState: string | null;
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  eventsHandled: number;
  gatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  nextWakeAt: string | null;
  summary: string;
  vault: string | null;
}> = {}): RunnerSuccessPayload {
  return normalizeRunnerSuccessPayload({
    bundles: {
      agentState: input.agentState,
      vault: input.vault,
    },
    gatewayProjectionSnapshot: input.gatewayProjectionSnapshot,
    result: {
      eventsHandled: input.eventsHandled,
      nextWakeAt: input.nextWakeAt,
      summary: input.summary,
    },
    assistantDeliveryEffects: input.assistantDeliveryEffects,
  });
}

function serializeRunnerSuccessPayload(
  payload: RunnerSuccessPayloadLike,
): {
  phase: "completed";
  finalGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  result: {
    bundle: string | null;
    result: RunnerSuccessPayload["result"];
  };
} {
  const normalized = normalizeRunnerSuccessPayload(payload);

  return {
    finalGatewayProjectionSnapshot: normalized.gatewayProjectionSnapshot,
    phase: "completed",
    result: {
      bundle: normalized.bundles.vault ?? normalized.bundles.agentState,
      result: normalized.result,
    },
  };
}

function serializeRunnerCommittedPayload(
  payload: RunnerSuccessPayloadLike,
): {
  committedAssistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  committedGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
  phase: "committed";
  result: {
    bundle: string | null;
    result: RunnerSuccessPayload["result"];
  };
} {
  const normalized = normalizeRunnerSuccessPayload(payload);

  return {
    committedAssistantDeliveryEffects: normalized.assistantDeliveryEffects,
    committedGatewayProjectionSnapshot: normalized.gatewayProjectionSnapshot,
    phase: "committed",
    result: {
      bundle: normalized.bundles.vault ?? normalized.bundles.agentState,
      result: normalized.result,
    },
  };
}

async function maybeCreateHostedWakeControlResponse(input: {
  bucket: ReturnType<typeof createBucket>;
  init?: RequestInit;
  url: unknown;
}): Promise<Response | null> {
  const url = String(input.url);
  const headers = new Headers(input.init?.headers);
  const userId = headers.get("x-hosted-execution-user-id") ?? "member_123";

  if (url.endsWith("/api/internal/hosted-wake/append")) {
    const requestBody = parseHostedWakeAppendRequest(JSON.parse(String(input.init?.body ?? "{}")));
    return Response.json(await appendTestHostedWake({
      bucket: input.bucket.api,
      wake: requestBody.wake,
    }));
  }

  if (url.endsWith("/api/internal/hosted-wake/unseen")) {
    return Response.json(await fetchTestHostedWakeBatch({
      afterSeq: null,
      body: JSON.parse(String(input.init?.body ?? "{}")),
      bucket: input.bucket.api,
      userId,
    }));
  }

  if (url.endsWith("/api/internal/hosted-wake/commit")) {
    return Response.json(await commitTestHostedWakeCursor({
      body: JSON.parse(String(input.init?.body ?? "{}")),
      bucket: input.bucket.api,
      userId,
    }));
  }

  if (url.endsWith("/api/internal/hosted-wake/quarantine")) {
    return Response.json(await quarantineTestHostedWake({
      body: JSON.parse(String(input.init?.body ?? "{}")),
      bucket: input.bucket.api,
      userId,
    }));
  }

  if (url.endsWith("/api/internal/hosted-wake/status")) {
    return Response.json(await readTestHostedWakeStatus({
      body: JSON.parse(String(input.init?.body ?? "{}")),
      bucket: input.bucket.api,
      userId,
    }));
  }

  return null;
}

function createHostedWakeAwareFetch(input: {
  bucket: ReturnType<typeof createBucket>;
  handler: (url: unknown, init?: RequestInit) => Promise<Response>;
}) {
  return async (url: unknown, init?: RequestInit): Promise<Response> => {
    const hostedWakeResponse = await maybeCreateHostedWakeControlResponse({
      bucket: input.bucket,
      init,
      url,
    });

    if (hostedWakeResponse) {
      return hostedWakeResponse;
    }

    return input.handler(url, init);
  };
}

async function createCommittedRunnerSuccessResponse(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: HostedExecutionEnvironment;
  init?: RequestInit;
  payload?: RunnerSuccessPayloadLike;
}): Promise<Response> {
  const payload = normalizeRunnerSuccessPayload(input.payload);
  const requestBody = JSON.parse(String(input.init?.body));
  const wakeAppendRequest = maybeReadHostedWakeAppendRequest(requestBody);

  if (wakeAppendRequest) {
    return new Response(JSON.stringify({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        createdAt: wakeAppendRequest.occurredAt,
        dedupeKey: `dispatch:${wakeAppendRequest.kind}:${wakeAppendRequest.eventId}`,
        id: `wake_${wakeAppendRequest.eventId}`,
        kind: wakeAppendRequest.kind,
        occurredAt: wakeAppendRequest.occurredAt,
        payloadSchema: wakeAppendRequest.kind === "conversation.message"
          ? "murph.hosted-wake-conversation-message.v1"
          : "murph.hosted-wake-system.v1",
        quarantineCode: null,
        quarantinedAt: null,
        seq: "1",
        updatedAt: wakeAppendRequest.occurredAt,
        userId: wakeAppendRequest.userId,
      },
    }), {
      status: 200,
    });
  }

  return new Response(JSON.stringify(
    readRunnerJobRequest(requestBody).resume
      ? serializeRunnerSuccessPayload(payload)
      : serializeRunnerCommittedPayload(payload),
  ), {
    status: 200,
  });
}

function readDispatchedEventIds(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.flatMap(([, init]) => {
    const body = typeof init?.body === "string" ? init.body : "";
    const request = maybeReadRunnerJobRequest(JSON.parse(body));

    return !request || request.resume ? [] : [request.wake.eventId];
  });
}

function maybeReadRunnerJobRequest(value: unknown): ReturnType<typeof readRunnerJobRequest> | null {
  try {
    return readRunnerJobRequest(value);
  } catch {
    return null;
  }
}

function readRunnerJobRequest(value: unknown): {
  currentBundleRef?: { hash: string; key: string; size: number; updatedAt: string } | null;
  wake: {
    userId: string;
    eventId: string;
  };
  resume?: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected hosted runner request payload to be an object.");
  }

  const record = value as {
    job?: {
      request?: unknown;
    };
  };
  const request = typeof record.job === "object" && record.job && "request" in record.job
    ? record.job.request
    : value;

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Expected hosted runner job request payload to be an object.");
  }

  const requestRecord = request as {
    currentBundleRef?: { hash: string; key: string; size: number; updatedAt: string } | null;
    resume?: unknown;
    wake?: {
      eventId?: string;
      userId?: string;
    };
  };
  if (
    !requestRecord.wake
    || typeof requestRecord.wake.eventId !== "string"
    || typeof requestRecord.wake.userId !== "string"
  ) {
    throw new TypeError("Expected hosted runner job request to carry a wake.");
  }

  const wake = {
    eventId: requestRecord.wake.eventId,
    userId: requestRecord.wake.userId,
  };

  return {
    currentBundleRef: requestRecord.currentBundleRef,
    resume: requestRecord.resume,
    wake,
  };
}

function maybeReadHostedWakeAppendRequest(value: unknown): {
  eventId: string;
  kind: string;
  occurredAt: string;
  userId: string;
} | null {
  try {
    const request = parseHostedWakeAppendRequest(value);

    return {
      eventId: request.wake.eventId,
      kind: request.wake.kind,
      occurredAt: request.wake.occurredAt,
      userId: request.wake.userId,
    };
  } catch {
    return null;
  }
}

async function commitResultForRunnerRequest(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: HostedExecutionEnvironment;
  payload: RunnerSuccessPayloadLike;
  requestBody: unknown;
}): Promise<void> {
  const payload = normalizeRunnerSuccessPayload(input.payload);
  const requestBody = readRunnerJobRequest(input.requestBody);
  const crypto = await resolveHostedUserCryptoContextForTest({
    bucket: input.bucket,
    environment: input.environment,
    userId: requestBody.wake.userId,
  });
  await persistHostedExecutionCommit({
    bucket: input.bucket.api,
    currentBundleRef: requestBody.currentBundleRef ?? null,
    eventId: requestBody.wake.eventId,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    payload: {
      assistantDeliveryEffects: payload.assistantDeliveryEffects,
      bundle: payload.bundles.vault ?? payload.bundles.agentState ?? null,
      gatewayProjectionSnapshot: payload.gatewayProjectionSnapshot,
      result: payload.result,
    },
    userId: requestBody.wake.userId,
  });
}

async function finalizeResultForRunnerRequest(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: HostedExecutionEnvironment;
  payload: RunnerSuccessPayloadLike;
  requestBody: unknown;
}): Promise<void> {
  const payload = normalizeRunnerSuccessPayload(input.payload);
  const requestBody = readRunnerJobRequest(input.requestBody);
  const crypto = await resolveHostedUserCryptoContextForTest({
    bucket: input.bucket,
    environment: input.environment,
    userId: requestBody.wake.userId,
  });
  await persistHostedExecutionFinalBundles({
    bucket: input.bucket.api,
    eventId: requestBody.wake.eventId,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    payload: {
      bundle: payload.bundles.vault ?? payload.bundles.agentState ?? null,
      gatewayProjectionSnapshot: payload.gatewayProjectionSnapshot,
    },
    userId: requestBody.wake.userId,
  });
}

async function resolveHostedUserCryptoContextForTest(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: HostedExecutionEnvironment;
  userId: string;
}) {
  const store = createHostedUserKeyStore({
    automationRecipientKeyId: input.environment.automationRecipientKeyId,
    automationRecipientPrivateKey: input.environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: input.environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: input.environment.automationRecipientPublicKey,
    bucket: input.bucket.api,
    envelopeEncryptionKey: input.environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: input.environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: input.environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: input.environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: input.environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: input.environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: input.environment.teeAutomationRecipientPublicKey,
  });
  await store.provisionManagedUserCryptoAtActivation(input.userId);
  return store.requireUserCryptoContext(input.userId);
}
