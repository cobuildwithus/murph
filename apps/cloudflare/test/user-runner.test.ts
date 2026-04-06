import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

import { createGatewayConversationSessionKey } from "@murphai/gateway-core";
import { deriveHostedExecutionErrorCode } from "@murphai/hosted-execution";
import {
  encodeHostedBundleBase64,
  listHostedBundleArtifacts,
  snapshotHostedBundleRoots,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node";

import {
  createHostedArtifactStore,
  createHostedBundleStore,
} from "../src/bundle-store.js";
import { HostedBundleGarbageCollector } from "../src/bundle-gc.js";
import { deriveHostedStorageOpaqueId } from "../src/crypto-context.js";
import { encryptHostedBundle } from "../src/crypto.js";
import {
  createHostedExecutionJournalStore,
  persistHostedExecutionCommit,
  persistHostedExecutionFinalBundles,
} from "../src/execution-journal.js";
import { createHostedDispatchPayloadStore } from "../src/dispatch-payload-store.js";
import { writeHostedEmailRawMessage } from "../src/hosted-email.js";
import { hostedArtifactObjectKey } from "../src/storage-paths.js";
import { createHostedPendingUsageStore } from "../src/usage-store.js";
import { createHostedUserKeyStore } from "../src/user-key-store.js";
import { HostedUserRunner } from "../src/user-runner.js";
import {
  TEST_AUTOMATION_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
  TEST_RECOVERY_RECIPIENT_KEY_ID,
  TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK as TEST_RECOVERY_RECIPIENT_PUBLIC_JWK,
} from "./hosted-execution-fixtures";
import { createTestSqlStorage } from "./sql-storage.js";

const describe = baseDescribe.sequential;

describe("HostedUserRunner", () => {
  const bucket = createBucket();
  const storage = createStorage();
  const environment = {
    allowedUserEnvKeys: null,
    allowedUserEnvPrefixes: null,
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
    controlToken: null,
    defaultAlarmDelayMs: 60_000,
    dispatchSigningSecret: "dispatch-secret",
    maxEventAttempts: 3,
    recoveryRecipientKeyId: TEST_RECOVERY_RECIPIENT_KEY_ID,
    recoveryRecipientPublicKey: TEST_RECOVERY_RECIPIENT_PUBLIC_JWK,
    retryDelayMs: 10_000,
    runnerControlToken: "runner-token",
    runnerTimeoutMs: 60_000,
  };

  beforeEach(() => {
    bucket.clear();
    storage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

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
      "Hosted bundle envelope keyId mismatch: expected v2, got v1. No keyring is configured for multi-key decryption.",
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
        "agent-state",
        new TextEncoder().encode("agent-state-previous"),
      );
      const nextAgentRef = await bundleStore.writeBundle(
        "agent-state",
        new TextEncoder().encode("agent-state-next"),
      );
      const otherUserSharedVaultRef = await bundleStore.writeBundle("vault", previousVaultBundle!);
      const otherUserSharedAgentRef = await bundleStore.writeBundle(
        "agent-state",
        new TextEncoder().encode("agent-state-previous"),
      );

      const collector = new HostedBundleGarbageCollector(
        bucket.api,
        environment.platformEnvelopeKey,
        environment.platformEnvelopeKeyId,
      );

      await collector.cleanupBundleTransition({
        nextBundleRefs: {
          agentState: nextAgentRef,
          vault: nextVaultRef,
        },
        previousBundleRefs: {
          agentState: previousAgentRef,
          vault: previousVaultRef,
        },
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
        nextBundleRefs: {
          agentState: null,
          vault: nextVaultRef,
        },
        previousBundleRefs: {
          agentState: null,
          vault: previousVaultRef,
        },
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
      const previousAgentRef = await bundleStore.writeBundle("agent-state", previousAgentBytes);
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
      vi.stubGlobal("fetch", fetchMock);
      const runner = new HostedUserRunner(storage.state, environment, bucket.api);

      const status = await runner.dispatch({
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_recovered_gc",
        },
        eventId: "evt_recovered_gc",
        occurredAt: "2026-03-26T12:00:00.000Z",
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(status.pendingEventCount).toBe(0);
      expect(status.retryingEventId).toBeNull();
      expect(status.lastError).toBeNull();
      expect(bucket.keys()).not.toContain(
        await hostedArtifactObjectKey(crypto.rootKey, "member_recovered_gc", previousArtifact!.ref.sha256),
      );
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
      bundleRef: null,
      committedAt: "2026-03-27T00:00:00.000Z",
      eventId: "evt_roundtrip",
      finalizedAt: null,
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "ok",
      },
      sideEffects: [],
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

  it("rejects duplicate runner commits whose payload diverges from the first write", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });

    await runner.commit({
      eventId: "evt_duplicate_runner_commit",
      payload: {
        bundle: Buffer.from("vault").toString("base64"),
        currentBundleRef: null,
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
    });

    await expect(
      runner.commit({
        eventId: "evt_duplicate_runner_commit",
        payload: {
          bundle: Buffer.from("vault-updated").toString("base64"),
          currentBundleRef: null,
          result: {
            eventsHandled: 1,
            summary: "ok",
          },
        },
      }),
    ).rejects.toThrow(
      "Hosted execution commit evt_duplicate_runner_commit vault bundle ref does not match the existing durable commit.",
    );
  });

  it("projects gateway snapshots into the hot hosted gateway store during commit and finalize", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const routeKey = "channel:email|identity:murph%40example.com|thread:thread-labs";
    const sessionKey = createGatewayConversationSessionKey(routeKey);
    await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });

    await runner.commit({
      eventId: "evt_gateway_projection",
      payload: {
        bundle: Buffer.from("vault").toString("base64"),
        currentBundleRef: null,
        gatewayProjectionSnapshot: {
          conversations: [{
            canSend: true,
            lastActivityAt: "2026-03-26T12:00:00.000Z",
            lastMessagePreview: "Here is the latest lab PDF.",
            messageCount: 1,
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
            title: "Lab thread",
          }],
          generatedAt: "2026-03-26T12:00:00.000Z",
          messages: [{
            actorDisplayName: "Alex",
            attachments: [],
            createdAt: "2026-03-26T12:00:00.000Z",
            direction: "inbound",
            messageId: "gwcm_projection_initial",
            schema: "murph.gateway-message.v1",
            sessionKey,
            text: "Here is the latest lab PDF.",
          }],
          permissions: [],
          schema: "murph.gateway-projection-snapshot.v1",
        },
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
    });

    const listed = await runner.gatewayListConversations({ limit: 10 });
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.sessionKey).toBe(sessionKey);

    const baselineEvents = await runner.gatewayPollEvents({ cursor: 0, limit: 10 });
    expect(baselineEvents.events).toHaveLength(0);

    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });
    await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: "evt_gateway_projection",
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        bundle: {
          agentState: Buffer.from("agent-state-final").toString("base64"),
          vault: Buffer.from("vault-final").toString("base64"),
        },
        gatewayProjectionSnapshot: {
          conversations: [{
            canSend: true,
            lastActivityAt: "2026-03-26T12:05:00.000Z",
            lastMessagePreview: "Please send the latest PDF.",
            messageCount: 2,
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
            title: "Lab thread",
          }],
          generatedAt: "2026-03-26T12:05:00.000Z",
          messages: [{
            actorDisplayName: "Alex",
            attachments: [],
            createdAt: "2026-03-26T12:00:00.000Z",
            direction: "inbound",
            messageId: "gwcm_projection_initial",
            schema: "murph.gateway-message.v1",
            sessionKey,
            text: "Here is the latest lab PDF.",
          }, {
            actorDisplayName: null,
            attachments: [],
            createdAt: "2026-03-26T12:05:00.000Z",
            direction: "outbound",
            messageId: "gwcm_projection_followup",
            schema: "murph.gateway-message.v1",
            sessionKey,
            text: "Please send the latest PDF.",
          }],
          permissions: [],
          schema: "murph.gateway-projection-snapshot.v1",
        },
      },
      userId: "member_123",
    });
    await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_gateway_projection",
      occurredAt: "2026-03-26T12:05:00.000Z",
    });

    const messages = await runner.gatewayReadMessages({
      oldestFirst: true,
      sessionKey,
    });
    expect(messages.messages).toHaveLength(2);
    expect(messages.messages[1]?.messageId).toBe("gwcm_projection_followup");

    const updatedEvents = await runner.gatewayPollEvents({ cursor: 0, limit: 10 });
    expect(updatedEvents.events.map((event) => event.kind)).toContain("message.created");
    expect(updatedEvents.events.map((event) => event.kind)).toContain("conversation.updated");
  });

  it("stores pending hosted AI usage in worker-owned storage and supports read/delete", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });
    await expect(runner.putPendingUsage({
      usage: [{
        apiKeyEnv: null,
        attemptCount: 1,
        baseUrl: null,
        cacheWriteTokens: null,
        cachedInputTokens: null,
        credentialSource: "platform",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: "2026-03-29T10:05:00.000Z",
        outputTokens: 4,
        provider: "codex-cli",
        providerMetadataJson: null,
        providerName: null,
        providerRequestId: null,
        providerSessionId: "sess_usage_flush",
        rawUsageJson: null,
        reasoningTokens: null,
        requestedModel: "gpt-5.4",
        routeId: "primary",
        schema: "murph.assistant-usage.v1",
        servedModel: "gpt-5.4",
        sessionId: "asst_usage_flush",
        totalTokens: 14,
        turnId: "turn_usage_flush",
        usageId: "turn_usage_flush.attempt-1",
      }],
    })).resolves.toEqual({
      recorded: 1,
      usageIds: ["turn_usage_flush.attempt-1"],
    });

    await expect(runner.readPendingUsage({ limit: 50 })).resolves.toEqual([expect.objectContaining({
      memberId: "member_123",
      usageId: "turn_usage_flush.attempt-1",
    })]);
    await expect(runner.deletePendingUsage({
      usageIds: ["turn_usage_flush.attempt-1"],
    })).resolves.toBeUndefined();
    await expect(runner.readPendingUsage({ limit: 50 })).resolves.toEqual([]);
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
        dispatch: createDispatch("evt_gateway_recovery"),
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
      sideEffects: [],
      userId: "member_123",
    });

    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const status = await runner.dispatch(createDispatch("evt_gateway_recovery"));

    expect(status.run?.phase).toBe("commit.recorded");
    const listed = await runner.gatewayListConversations({ limit: 10 });
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.title).toBe("Recovery thread");
    expect(listed.conversations[0]?.lastMessagePreview).toBe("Committed before finalize.");
  });

  it("ignores stale gateway snapshots so finalize cannot rewind the hot projection", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });

    await runner.commit({
      eventId: "evt_gateway_stale_projection",
      payload: {
        bundle: {
          agentState: Buffer.from("agent-state-newer").toString("base64"),
          vault: Buffer.from("vault-newer").toString("base64"),
        },
        currentBundleRef: null,
        gatewayProjectionSnapshot: createGatewayProjectionSnapshot({
          generatedAt: "2026-03-26T12:05:00.000Z",
          lastActivityAt: "2026-03-26T12:05:00.000Z",
          lastMessagePreview: "Newer projection",
          messages: [{
            actorDisplayName: "Alex",
            createdAt: "2026-03-26T12:00:00.000Z",
            direction: "inbound",
            messageId: "gwcm_projection_initial",
            text: "Initial projection",
          }, {
            actorDisplayName: null,
            createdAt: "2026-03-26T12:05:00.000Z",
            direction: "outbound",
            messageId: "gwcm_projection_newer",
            text: "Newer projection",
          }],
          messageCount: 2,
          title: "Lab thread",
        }),
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
    });

    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });
    await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: "evt_gateway_stale_projection",
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        bundle: {
          agentState: Buffer.from("agent-state-older").toString("base64"),
          vault: Buffer.from("vault-older").toString("base64"),
        },
        gatewayProjectionSnapshot: createGatewayProjectionSnapshot({
          generatedAt: "2026-03-26T12:00:00.000Z",
          lastActivityAt: "2026-03-26T12:00:00.000Z",
          lastMessagePreview: "Initial projection",
          messages: [{
            actorDisplayName: "Alex",
            createdAt: "2026-03-26T12:00:00.000Z",
            direction: "inbound",
            messageId: "gwcm_projection_initial",
            text: "Initial projection",
          }],
          messageCount: 1,
          title: "Lab thread",
        }),
      },
      userId: "member_123",
    });
    await runner.dispatch(createDispatch("evt_gateway_stale_projection"));

    const listed = await runner.gatewayListConversations({ limit: 10 });
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.lastMessagePreview).toBe("Newer projection");
    expect(listed.conversations[0]?.messageCount).toBe(2);

    const messages = await runner.gatewayReadMessages({
      oldestFirst: true,
      sessionKey: listed.conversations[0]!.sessionKey,
    });
    expect(messages.messages).toHaveLength(2);
    expect(messages.messages[1]?.messageId).toBe("gwcm_projection_newer");
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
    const dispatch = createDispatch("evt_rotated_commit_recovery");
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment: rotatedEnvironment,
      userId: dispatch.event.userId,
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
      userId: dispatch.event.userId,
    });

    await createHostedExecutionJournalStore({
      bucket: bucket.api,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    }).writeCommittedResult(dispatch.event.userId, dispatch.eventId, {
      bundleRef: null,
      committedAt: "2026-03-26T12:00:01.000Z",
      eventId: dispatch.eventId,
      finalizedAt: "2026-03-26T12:00:02.000Z",
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "recovered",
      },
      sideEffects: [],
      userId: dispatch.event.userId,
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const status = await runner.dispatch(dispatch);

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
      }).readCommittedResult(dispatch.event.userId, dispatch.eventId),
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
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(status.userId).toBe("member_123");
    expect(status.lastEventId).toBe("evt_123");
    expect(status.lastError).toBeNull();
    expect(status.bundleRef).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
    });
    expect(status.pendingEventCount).toBe(0);
    expect(status.poisonedEventIds).toEqual([]);
    expect(status.retryingEventId).toBeNull();
    expect(status.run).toMatchObject({
      attempt: 1,
      eventId: "evt_123",
      phase: "completed",
    });
    expect(status.timeline?.map((entry) => entry.phase)).toEqual([
      "claimed",
      "dispatch.running",
      "commit.recorded",
      "completed",
    ]);
    expect(new Set((status.timeline ?? []).map((entry) => entry.runId)).size).toBe(1);
    expect(storage.lastAlarm).not.toBeNull();
    expectHostedBundleKeys(bucket.keys(), ["agent-state", "vault"]);
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
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_native_container",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(1);
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);
    expect(status.lastEventId).toBe("evt_native_container");
    expect(status.nextWakeAt).toBe("2026-03-27T18:00:00.000Z");
    expectHostedBundleKeys(bucket.keys(), ["agent-state", "vault"]);
  });

  it("stores queued dispatch payload blobs under the per-user root key", async () => {
    const firstRun = createDeferred<Response>();
    const fetchMock = vi.fn().mockImplementationOnce(async () => firstRun.promise);
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = createDispatch("evt_root_key_payload");

    const dispatchPromise = runner.dispatch(dispatch);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const sql = storage.state.storage.sql;
    if (!sql) {
      throw new Error("Test storage.sql is required.");
    }

    const payloadKey = sql.exec<{ payload_key: string }>(
      "SELECT payload_key FROM pending_events WHERE event_id = ?",
      dispatch.eventId,
    ).one().payload_key;

    const workerStore = createHostedDispatchPayloadStore({
      bucket: bucket.api,
      key: environment.platformEnvelopeKey,
      keyId: environment.platformEnvelopeKeyId,
      keysById: environment.platformEnvelopeKeysById,
    });
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: dispatch.event.userId,
    });
    const userStore = createHostedDispatchPayloadStore({
      bucket: bucket.api,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
    });

    await expect(workerStore.readDispatchPayload({ key: payloadKey })).rejects.toThrow();
    await expect(userStore.readDispatchPayload({ key: payloadKey })).resolves.toEqual(dispatch);

    firstRun.resolve(new Response("runner failed", { status: 503 }));
    await dispatchPromise;
  });

  it("deletes hosted raw email bodies from the per-user root-key path after a successful run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: createRunnerSuccessPayload({
            summary: "processed email",
          }),
          requestBody: JSON.parse(String(init?.body)),
        });

        return new Response(JSON.stringify(createRunnerSuccessPayload({
          summary: "processed email",
        })), {
          status: 200,
        });
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

    await runner.dispatch({
      event: {
        identityId: "assistant@mail.example.test",
        kind: "email.message.received",
        rawMessageKey,
        userId,
      },
      eventId: `email:${rawMessageKey}`,
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

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
    const dispatch = {
      event: {
        identityId: "assistant@mail.example.test",
        kind: "email.message.received" as const,
        rawMessageKey,
        userId,
      },
      eventId: `email:${rawMessageKey}`,
      occurredAt: "2026-03-26T12:00:00.000Z",
    };

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
      bundleRef: null,
      committedAt: "2026-03-26T12:00:01.000Z",
      eventId: dispatch.eventId,
      finalizedAt: "2026-03-26T12:00:02.000Z",
      gatewayProjectionSnapshot: null,
      result: {
        eventsHandled: 1,
        summary: "recovered email",
      },
      sideEffects: [],
      userId,
    });

    vi.stubGlobal("fetch", vi.fn());
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    expect(bucket.keys().filter((key) => key.includes("/messages/"))).toHaveLength(1);

    const status = await runner.dispatch(dispatch);

    expect(status.pendingEventCount).toBe(0);
    expect(bucket.keys().filter((key) => key.includes("/messages/"))).toEqual([]);
  });

  it("sends forwarded env and worker-only runtime config through the per-job runtime payload instead of the container start envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
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

        return new Response(JSON.stringify(payload), {
          status: 200,
        });
      }),
    );
    const runner = new HostedUserRunner(
      storage.state,
      environment,
      bucket.api,
      {
        HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
        OPENAI_API_KEY: "sk-worker",
      },
    );

    await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_native_runtime_env",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

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
    });
  });

  it("does not reuse stale past nextWakeAt values after an alarm run returns no next wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
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

        return new Response(JSON.stringify(payload), {
          status: 200,
        });
      }),
    );
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

    const status = await runner.status("member_123");
    expect(status.lastEventId).toMatch(/^alarm:/u);
    expect(status.nextWakeAt).not.toBe("2026-03-26T12:00:05.000Z");
    expect(status.nextWakeAt).toBe("2026-03-26T12:01:10.000Z");
    expect(storage.lastAlarm).toBe(Date.parse("2026-03-26T12:01:10.000Z"));
  });

  it("passes the worker commit callback metadata through the runner container invoke request", async () => {
    const resultPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state").toString("base64"),
      summary: "ok",
      vault: Buffer.from("vault").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await runner.provisionManagedUserCrypto("member_123");

    await runner.dispatch(createDispatch("evt_commit_callback"));

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
          commit: {
            bundleRef: null | { hash: string; key: string; size: number; updatedAt: string };
          };
          run: {
            attempt: number;
            runId: string;
            startedAt: string;
          };
        };
      };
    };

    expect(invokePayload.job.request.commit.bundleRef).toBeNull();
    expect(invokePayload.job.request.run).toMatchObject({
      attempt: 1,
      runId: expect.any(String),
      startedAt: expect.any(String),
    });
  });

  it("forwards stored per-user env through the runner container invoke payload", async () => {
    const resultPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state").toString("base64"),
      summary: "ok",
      vault: Buffer.from("vault").toString("base64"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(
      storage.state,
      {
        ...environment,
        allowedUserEnvKeys: "OPENAI_API_KEY",
      },
      bucket.api,
    );

    await runner.provisionManagedUserCrypto("member_123");
    await runner.updateUserEnv({
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      mode: "replace",
    });
    await runner.dispatch(createDispatch("evt_user_env_set"));
    await runner.clearUserEnv();
    await runner.dispatch(createDispatch("evt_user_env_cleared"));

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
                dispatch: {
                  eventId: string;
                };
              };
              runtime?: {
                userEnv?: Record<string, string>;
              };
            };
          };

          return {
            eventId: payload.job.request.dispatch.eventId,
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
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await runner.provisionManagedUserCrypto("member_123");

    const status = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_final_bundles",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

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
      const previousAgentRef = await bundleStore.writeBundle(
        "agent-state",
        new TextEncoder().encode("agent-state-previous"),
      );
      const queueStore = new (await import("../src/user-runner/runner-queue-store.js")).RunnerQueueStore(
        storage.state,
      );
      await queueStore.bootstrapUser("member_cleanup_failure");
      await queueStore.compareAndSwapBundleRefs({
        expectedVersions: {
          agentState: 0,
          vault: 0,
        },
        nextBundleRefs: {
          agentState: previousAgentRef,
          vault: previousVaultRef,
        },
      });

      const deleteArtifactSpy = vi.spyOn(bucket.api, "delete").mockImplementation(async (key: string) => {
        if (key.includes("/artifacts/")) {
          throw new Error("artifact delete failed");
        }

        return undefined;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
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

          return new Response(JSON.stringify(createRunnerSuccessPayload({
            agentState: Buffer.from("agent-state-final").toString("base64"),
            summary: "final",
            vault: encodeHostedBundleBase64(finalVaultBundle),
          })), {
            status: 200,
          });
        }),
      );
      const runner = new HostedUserRunner(storage.state, environment, bucket.api);

      const status = await runner.dispatch({
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "member_cleanup_failure",
        },
        eventId: "evt_cleanup_failure",
        occurredAt: "2026-03-26T12:00:00.000Z",
      });

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
      expect(
        deleteArtifactSpy.mock.calls
          .map(([key]) => String(key))
          .filter((key) => key.includes("users/artifacts/")),
      ).toEqual(expect.arrayContaining([
        await hostedArtifactObjectKey(crypto.rootKey, "member_cleanup_failure", previousArtifact!.ref.sha256),
        await hostedArtifactObjectKey(crypto.rootKey, "member_cleanup_failure", committedArtifact!.ref.sha256),
      ]));
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
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_finalized_recovery",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(status.lastError).toBeNull();
    expect(status.pendingEventCount).toBe(0);
    expect(status.bundleRef).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
    });
  });

  it("keeps committed events retryable until durable finalize succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const sideEffects = [
      {
        effectId: "outbox_retry",
        fingerprint: "dedupe_retry",
        intentId: "outbox_retry",
        kind: "assistant.delivery" as const,
      },
    ];
    const committedPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-committed").toString("base64"),
      sideEffects,
      summary: "committed",
      vault: Buffer.from("vault-committed").toString("base64"),
    });
    const finalPayload = createRunnerSuccessPayload({
      agentState: Buffer.from("agent-state-final").toString("base64"),
      summary: "final",
      vault: Buffer.from("vault-final").toString("base64"),
    });
    const fetchSpy = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await commitResultForRunnerRequest({
          bucket,
          environment,
          payload: committedPayload,
          requestBody: JSON.parse(String(init?.body)),
        });
        throw new Error("finalize failed");
      })
      .mockImplementationOnce(async (_url, init) => {
        const requestBody = JSON.parse(String(init?.body));
        expect(requestBody.resume).toEqual({
          committedResult: {
            result: committedPayload.result,
            sideEffects,
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
    vi.stubGlobal("fetch", fetchSpy);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await runner.provisionManagedUserCrypto("member_123");

    const firstStatus = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_finalize_retry",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(firstStatus.pendingEventCount).toBe(1);
    expect(firstStatus.retryingEventId).toBe("evt_finalize_retry");
    expect(firstStatus.bundleRef).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
    });
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);

    vi.setSystemTime(new Date("2026-03-26T12:00:11.000Z"));
    await runner.alarm();

    const finalStatus = await runner.status("member_123");
    expect(finalStatus.pendingEventCount).toBe(0);
    expect(finalStatus.retryingEventId).toBeNull();
    expect(finalStatus.bundleRef).toMatchObject({
      key: expect.stringMatching(/^bundles\/vault\/[0-9a-f]+\.bundle\.json$/u),
    });
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/destroy")).toBe(0);
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
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    await runner.provisionManagedUserCrypto("member_123");

    const first = await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_first",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    const writeCountAfterFirstRun = bucket.putCount();

    const second = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_second",
      occurredAt: "2026-03-26T12:01:00.000Z",
    });

    expect(second.bundleRef).toEqual(first.bundleRef);
    expect(bucket.putCount()).toBe(writeCountAfterFirstRun + 3);
  });

  it("serializes duplicate commit attempts for the same event through one transition lock", async () => {
    const originalPut = bucket.api.put;
    const firstWriteStarted = createDeferred<void>();
    const releaseFirstWrite = createDeferred<void>();
    let blocked = false;

    try {
      const runner = new HostedUserRunner(storage.state, environment, bucket.api);
      await runner.bootstrapUser("member_123");
      bucket.api.put = vi.fn(async (key: string, value: string) => {
        if (!blocked) {
          blocked = true;
          firstWriteStarted.resolve();
          await releaseFirstWrite.promise;
        }

        await originalPut.call(bucket.api, key, value);
      });

      const commitPromise = runner.commit({
        eventId: "evt_transition_lock",
        payload: {
          bundle: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: Buffer.from("vault").toString("base64"),
          },
          currentBundleRef: null,
          result: {
            eventsHandled: 1,
            summary: "ok",
          },
        },
      });

      await firstWriteStarted.promise;
      let secondCommitSettled = false;
      const secondCommitPromise = runner.commit({
        eventId: "evt_transition_lock",
        payload: {
          bundle: {
            agentState: Buffer.from("agent-state").toString("base64"),
            vault: Buffer.from("vault").toString("base64"),
          },
          currentBundleRef: null,
          result: {
            eventsHandled: 1,
            summary: "ok",
          },
        },
      }).finally(() => {
        secondCommitSettled = true;
      });

      await Promise.resolve();
      expect(secondCommitSettled).toBe(false);

      releaseFirstWrite.resolve();
      await expect(commitPromise).resolves.toMatchObject({
        eventId: "evt_transition_lock",
      });
      await expect(secondCommitPromise).resolves.toMatchObject({
        eventId: "evt_transition_lock",
        finalizedAt: null,
      });
    } finally {
      bucket.api.put = originalPut;
    }
  });

  it("retries failed events and eventually poisons them after repeated runner failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("runner failed", {
          status: 503,
        }),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const first = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_retry_1",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(first.lastError).toBe("Hosted runner container returned an HTTP error.");
    expect(first.lastErrorCode).toBe("runner_http_error");
    expect(first.pendingEventCount).toBe(1);
    expect(first.retryingEventId).toBe("evt_retry_1");
    expect(first.run).toMatchObject({
      attempt: 1,
      eventId: "evt_retry_1",
      phase: "retry.scheduled",
    });
    expect(first.timeline?.at(-1)).toMatchObject({
      errorCode: "runner_http_error",
      phase: "retry.scheduled",
    });

    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();
    vi.setSystemTime(new Date("2026-03-26T12:00:30.000Z"));
    await runner.alarm();

    const final = await runner.status("member_123");

    expect(final.pendingEventCount).toBe(0);
    expect(final.poisonedEventIds).toEqual(["evt_retry_1"]);
    expect(final.retryingEventId).toBeNull();
    expect(final.lastError).toBe("Hosted runner container returned an HTTP error.");
    expect(final.lastErrorCode).toBe("runner_http_error");
    expect(final.run).toMatchObject({
      attempt: 3,
      eventId: "evt_retry_1",
      phase: "poisoned",
    });
  });

  it("redacts retryable runner failures before persisting hosted status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new Error("Authorization: Bearer secret-token for ops@example.com OPENAI_API_KEY=sk-live-secret"),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId: "evt_secret_failure",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(status.lastError).toBe("Hosted execution authorization failed.");
    expect(status.lastErrorCode).toBe("authorization_error");
    expect(status.lastError).not.toContain("secret-token");
    expect(status.lastError).not.toContain("ops@example.com");
    expect(status.pendingEventCount).toBe(1);
    expect(status.retryingEventId).toBe("evt_secret_failure");
  });

  it("continues past a rescheduled head event and runs later due work in the same pass", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchMock = vi.fn(async (_url, init) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        dispatch: {
          eventId: string;
        };
      };

      if (requestBody.dispatch.eventId === "evt_retry_head") {
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
    vi.stubGlobal("fetch", fetchMock);
    await seedRunnerQueueState({
      bucket,
      environment,
      pendingEvents: [
        {
          attempts: 0,
          availableAt: "2026-03-26T12:00:00.000Z",
          dispatch: createDispatch("evt_retry_head"),
          enqueuedAt: "2026-03-26T12:00:00.000Z",
          lastError: null,
        },
        {
          attempts: 0,
          availableAt: "2026-03-26T12:00:00.000Z",
          dispatch: createDispatch("evt_tail"),
          enqueuedAt: "2026-03-26T12:00:01.000Z",
          lastError: null,
        },
      ],
      storage,
      userId: "member_123",
    });
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.alarm();

    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_retry_head", "evt_tail"]);
    await expect(runner.status("member_123")).resolves.toMatchObject({
      lastEventId: "evt_tail",
      pendingEventCount: 1,
      poisonedEventIds: [],
    });
  });

  it("backpressures new overflow events instead of evicting the oldest pending work", async () => {
    const firstRun = createDeferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await runner.dispatch(createDispatch(`evt_${index.toString().padStart(3, "0")}`));
    }

    const overflow = await runner.dispatch(createDispatch("evt_overflow"));

    expect(overflow.pendingEventCount).toBe(64);
    expect(overflow.backpressuredEventIds).toEqual(["evt_overflow"]);
    expect(overflow.poisonedEventIds).toEqual([]);

    firstRun.resolve();
    await firstDispatch;

    expect(readDispatchedEventIds(fetchMock)).toEqual([
      ...Array.from({ length: 64 }, (_, index) => `evt_${index.toString().padStart(3, "0")}`),
    ]);
    await expect(runner.status("member_123")).resolves.toMatchObject({
      backpressuredEventIds: ["evt_overflow"],
      lastEventId: "evt_063",
      pendingEventCount: 0,
      poisonedEventIds: [],
    });
  });

  it("serializes concurrent enqueue mutations while another run is already in flight", async () => {
    const firstRun = createDeferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await Promise.all([
      runner.dispatch(createDispatch("evt_concurrent_a")),
      runner.dispatch(createDispatch("evt_concurrent_b")),
    ]);

    firstRun.resolve();
    await firstDispatch;

    expect(readDispatchedEventIds(fetchMock)).toHaveLength(3);
    expect(readDispatchedEventIds(fetchMock)).toContain("evt_concurrent_a");
    expect(readDispatchedEventIds(fetchMock)).toContain("evt_concurrent_b");
    await expect(runner.status("member_123")).resolves.toMatchObject({
      pendingEventCount: 0,
      poisonedEventIds: [],
    });
  });

  it("claims due work atomically so concurrent idle dispatches execute each event once", async () => {
    const firstRun = createDeferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const dispatchA = runner.dispatch(createDispatch("evt_idle_a"));
    const dispatchB = runner.dispatch(createDispatch("evt_idle_b"));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    firstRun.resolve();
    await Promise.all([dispatchA, dispatchB]);

    expect(readDispatchedEventIds(fetchMock)).toHaveLength(2);
    expect(readDispatchedEventIds(fetchMock).filter((eventId) => eventId === "evt_idle_a")).toHaveLength(1);
    expect(readDispatchedEventIds(fetchMock).filter((eventId) => eventId === "evt_idle_b")).toHaveLength(1);
    await expect(runner.status("member_123")).resolves.toMatchObject({
      pendingEventCount: 0,
      poisonedEventIds: [],
    });
  });

  it("keeps backpressured overflow events out of the poisoned set", async () => {
    const firstRun = createDeferred<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockImplementationOnce(async (_url, init) => {
          await firstRun.promise;
          return createCommittedRunnerSuccessResponse({
            bucket,
            environment,
            init,
          });
        })
        .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        })),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await runner.dispatch(createDispatch(`evt_fill_${index}`));
    }

    const overflow = await runner.dispatch(createDispatch("evt_backpressured"));

    expect(overflow.backpressuredEventIds).toEqual(["evt_backpressured"]);
    expect(overflow.poisonedEventIds).not.toContain("evt_backpressured");

    firstRun.resolve();
    await firstDispatch;

    await expect(runner.status("member_123")).resolves.toMatchObject({
      backpressuredEventIds: ["evt_backpressured"],
      poisonedEventIds: [],
    });
  });

  it("retries a previously backpressured event deterministically once queue capacity frees up", async () => {
    const firstRun = createDeferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_url, init) => {
        await firstRun.promise;
        return createCommittedRunnerSuccessResponse({
          bucket,
          environment,
          init,
        });
      })
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await runner.dispatch(createDispatch(`evt_fill_${index}`));
    }

    const firstBackpressure = await runner.dispatch(createDispatch("evt_retry"));
    const secondBackpressure = await runner.dispatch(createDispatch("evt_retry"));

    expect(firstBackpressure.pendingEventCount).toBe(64);
    expect(firstBackpressure.backpressuredEventIds).toEqual(["evt_retry"]);
    expect(secondBackpressure.pendingEventCount).toBe(64);
    expect(secondBackpressure.backpressuredEventIds).toEqual(["evt_retry"]);
    expect(readDispatchedEventIds(fetchMock)).toEqual(["evt_000"]);

    firstRun.resolve();
    await firstDispatch;

    const replayed = await runner.dispatch(createDispatch("evt_retry"));

    expect(replayed.backpressuredEventIds).toEqual([]);
    expect(replayed.lastEventId).toBe("evt_retry");
    expect(replayed.pendingEventCount).toBe(0);
    expect(replayed.poisonedEventIds).toEqual([]);
    expect(readDispatchedEventIds(fetchMock)).toContain("evt_retry");
    expect(readDispatchedEventIds(fetchMock).filter((eventId) => eventId === "evt_retry")).toHaveLength(1);
  });

  it("preserves newer queued work and backpressure markers when an in-flight runner call fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const firstRun = createDeferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => firstRun.promise)
      .mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
        bucket,
        environment,
        init,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    const firstDispatch = runner.dispatch(createDispatch("evt_000"));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    for (let index = 1; index < 64; index += 1) {
      await runner.dispatch(createDispatch(`evt_fail_fill_${index}`));
    }

    const overflow = await runner.dispatch(createDispatch("evt_fail_backpressured"));
    expect(overflow.backpressuredEventIds).toEqual(["evt_fail_backpressured"]);

    firstRun.resolve(new Response("runner failed", { status: 503 }));
    const failed = await firstDispatch;

    expect(failed.pendingEventCount).toBe(1);
    expect(failed.backpressuredEventIds).toEqual(["evt_fail_backpressured"]);
    expect(failed.poisonedEventIds).toEqual([]);
    expect(failed.retryingEventId).toBe("evt_000");

    await runner.alarm();

    await expect(runner.status("member_123")).resolves.toMatchObject({
      backpressuredEventIds: ["evt_fail_backpressured"],
      pendingEventCount: 1,
      poisonedEventIds: [],
    });
    expect(readDispatchedEventIds(fetchMock)).toContain("evt_fail_fill_1");
    expect(readDispatchedEventIds(fetchMock)).not.toContain("evt_fail_backpressured");
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
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId: "evt_lost_response",
      occurredAt: "2026-03-26T12:15:00.000Z",
    };

    const first = await runner.dispatch(dispatch);
    const second = await runner.dispatch(dispatch);

    expect(first.pendingEventCount).toBe(0);
    expect(first.lastError).toBeNull();
    expect(first.lastEventId).toBe("evt_lost_response");
    expect(second.pendingEventCount).toBe(0);
    expect(sideEffects).toBe(1);
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
    vi.stubGlobal("fetch", fetchMock);
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId: "evt_missing_commit",
      occurredAt: "2026-03-26T12:18:00.000Z",
    };

    const first = await runner.dispatch(dispatch);

    expect(first.pendingEventCount).toBe(1);
    expect(first.retryingEventId).toBe("evt_missing_commit");
    expect(first.lastError).toBe("Hosted execution failed before recording a durable commit.");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: dispatch.event.userId,
    });
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRef: null,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        bundle: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
        },
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: dispatch.event.userId,
    });
    await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        bundle: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
        },
      },
      userId: dispatch.event.userId,
    });

    const second = await runner.dispatch(dispatch);

    expect(second.pendingEventCount).toBe(0);
    expect(second.retryingEventId).toBeNull();
    expect(second.lastError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies a prefinalized event on retry without rerunning side effects", async () => {
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);
    const dispatch = {
      event: {
        kind: "assistant.cron.tick" as const,
        reason: "manual" as const,
        userId: "member_123",
      },
      eventId: "evt_ack_lost",
      occurredAt: "2026-03-26T12:20:00.000Z",
    };
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
      userId: dispatch.event.userId,
    });
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: dispatch.event.userId,
    });
    await persistHostedExecutionCommit({
      bucket: bucket.api,
      currentBundleRef: null,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        bundle: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
        },
        result: {
          eventsHandled: 1,
          summary: "ok",
        },
      },
      userId: dispatch.event.userId,
    });
    await persistHostedExecutionFinalBundles({
      bucket: bucket.api,
      eventId: dispatch.eventId,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      payload: {
        bundle: {
          agentState: Buffer.from("agent-state").toString("base64"),
          vault: Buffer.from("vault").toString("base64"),
        },
      },
      userId: dispatch.event.userId,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const status = await runner.dispatch(dispatch);

    expect(status.pendingEventCount).toBe(0);
    expect(status.retryingEventId).toBeNull();
    expect(status.lastError).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      createHostedExecutionJournalStore({
        bucket: bucket.api,
        key: environment.platformEnvelopeKey,
        keyId: environment.platformEnvelopeKeyId,
      }).readCommittedResult(dispatch.event.userId, dispatch.eventId),
    ).resolves.toBeNull();
  });

  it("does not require an ambient runner control token because each invoke uses a per-run token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    })));
    const runner = new HostedUserRunner(storage.state, {
      ...environment,
      runnerControlToken: null,
    }, bucket.api);

    const status = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_per_run_runner_token",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(status.pendingEventCount).toBe(0);
    expect(status.poisonedEventIds).toEqual([]);
    expect(status.retryingEventId).toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.lastErrorCode).toBeUndefined();
    expect(status.run).toMatchObject({
      attempt: 1,
      eventId: "evt_per_run_runner_token",
      phase: "completed",
    });
    expect(countRunnerContainerCalls(storage.runnerContainerFetch, "/internal/invoke")).toBe(1);
  });

  it("keeps replay suppression after a durable-object restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const firstRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await firstRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_restart_safe",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    const restartedRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    vi.setSystemTime(new Date("2026-03-26T12:30:00.000Z"));
    await restartedRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_restart_safe",
      occurredAt: "2026-03-26T12:30:00.000Z",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows consumed event ids to be retried after the 30-day exact tombstone expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    const fetchSpy = vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const firstRunner = new HostedUserRunner(storage.state, environment, bucket.api);
    await firstRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_ttl_expiry",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-04-26T12:00:01.000Z"));
    const restartedRunner = new HostedUserRunner(storage.state, environment, bucket.api);

    await restartedRunner.status("member_123");
    await restartedRunner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_ttl_expiry",
      occurredAt: "2026-04-26T12:00:01.000Z",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps poisoned event ids blocked even after the old replay TTL window passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("runner failed", {
          status: 503,
        }),
      ),
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_poison_expiry",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    vi.setSystemTime(new Date("2026-03-26T12:00:10.000Z"));
    await runner.alarm();
    vi.setSystemTime(new Date("2026-03-26T12:00:30.000Z"));
    await runner.alarm();

    expect((await runner.status("member_123")).poisonedEventIds).toContain("evt_poison_expiry");

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment,
      init,
    })));
    vi.setSystemTime(new Date("2026-04-02T12:00:31.000Z"));
    const replayed = await runner.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_poison_expiry",
      occurredAt: "2026-04-02T12:00:31.000Z",
    });

    expect(replayed.poisonedEventIds).toContain("evt_poison_expiry");
  });

  it("stores encrypted per-user env config in a dedicated hosted object", async () => {
    const runner = new HostedUserRunner(storage.state, {
      ...environment,
      allowedUserEnvKeys: "OPENAI_API_KEY,XAI_API_KEY",
    }, bucket.api);

    await runner.bootstrapUser("member_123");
    const saved = await runner.updateUserEnv({
      env: {
        OPENAI_API_KEY: "sk-user",
        XAI_API_KEY: "xai-user",
      },
      mode: "replace",
    });

    expect(saved.configuredUserEnvKeys).toEqual([
      "OPENAI_API_KEY",
      "XAI_API_KEY",
    ]);
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });
    expect(bucket.keys()).toEqual(expect.arrayContaining([
      await userEnvObjectKeyForTest(crypto.rootKey, "member_123"),
      await userKeyEnvelopeObjectKeyForTest(environment.platformEnvelopeKey, "member_123"),
    ]));
    await expect(runner.getUserEnvStatus("member_123")).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY", "XAI_API_KEY"],
      userId: "member_123",
    });
  });

  it("reads per-user env encrypted with a previous key id after rotation", async () => {
    const previousKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const previousEnvironment = {
      ...environment,
      allowedUserEnvKeys: "OPENAI_API_KEY",
      platformEnvelopeKey: previousKey,
      platformEnvelopeKeyId: "v1",
      platformEnvelopeKeysById: {
        v1: previousKey,
      },
    };
    const rotatedEnvironment = {
      ...environment,
      allowedUserEnvKeys: "OPENAI_API_KEY",
      platformEnvelopeKey: Uint8Array.from({ length: 32 }, () => 7),
      platformEnvelopeKeyId: "v2",
      platformEnvelopeKeysById: {
        v1: previousKey,
        v2: Uint8Array.from({ length: 32 }, () => 7),
      },
    };
    const previousRunner = new HostedUserRunner(storage.state, previousEnvironment, bucket.api);

    await previousRunner.bootstrapUser("member_123");
    await previousRunner.updateUserEnv({
      env: {
        OPENAI_API_KEY: "sk-legacy",
      },
      mode: "replace",
    });

    const runner = new HostedUserRunner(storage.state, rotatedEnvironment, bucket.api);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init) => createCommittedRunnerSuccessResponse({
      bucket,
      environment: rotatedEnvironment,
      init,
    })));

    await runner.dispatch(createDispatch("evt_rotated_user_env"));

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
                dispatch: {
                  eventId: string;
                };
              };
              runtime?: {
                userEnv?: Record<string, string>;
              };
            };
          };

          return {
            eventId: payload.job.request.dispatch.eventId,
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
    ]);
    await expect(runner.getUserEnvStatus("member_123")).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId: "member_123",
    });
  });

  it("clears per-user env config without dropping unrelated agent-state bundle data", async () => {
    const initialAgentState = writeHostedBundleTextFile({
      bytes: null,
      kind: "agent-state",
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
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_bootstrap",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    const writesAfterBootstrap = bucket.putCount();

    await runner.updateUserEnv({
      env: {
        OPENAI_API_KEY: "sk-user",
      },
      mode: "replace",
    });
    expect(bucket.putCount()).toBe(writesAfterBootstrap + 1);
    expectHostedBundleKeys(bucket.keys(), ["agent-state", "vault"]);
    const crypto = await resolveHostedUserCryptoContextForTest({
      bucket,
      environment,
      userId: "member_123",
    });
    expect(bucket.keys()).toContain(
      await userEnvObjectKeyForTest(crypto.rootKey, "member_123"),
    );

    const cleared = await runner.clearUserEnv();

    expect(cleared.configuredUserEnvKeys).toEqual([]);
    expectHostedBundleKeys(bucket.keys(), ["agent-state", "vault"]);
    expect(bucket.keys()).not.toContain(
      await userEnvObjectKeyForTest(crypto.rootKey, "member_123"),
    );
  });

  it("supports extension-only keys across update and status reads", async () => {
    const runner = new HostedUserRunner(
      storage.state,
      {
        ...environment,
        allowedUserEnvKeys: "CUSTOM_API_KEY",
      },
      bucket.api,
    );

    await runner.bootstrapUser("member_123");
    await expect(runner.updateUserEnv({
      env: {
        CUSTOM_API_KEY: "custom-secret",
      },
      mode: "replace",
    })).resolves.toEqual({
      configuredUserEnvKeys: ["CUSTOM_API_KEY"],
      userId: "member_123",
    });
    await expect(runner.getUserEnvStatus("member_123")).resolves.toEqual({
      configuredUserEnvKeys: ["CUSTOM_API_KEY"],
      userId: "member_123",
    });
  });

  it("clears the durable-object alarm when no next wake remains", async () => {
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
      vi.fn(async (_url, init) => {
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
    );
    const runner = new HostedUserRunner(storage.state, environment, bucket.api);

    await runner.dispatch({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_alarm_clear",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });
    expect(storage.lastAlarm).not.toBeNull();

    storage.clear();
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
            return Buffer.from(value, "utf8");
          },
        };
      },
      async put(key: string, value: string) {
        writes += 1;
        values.set(key, value);
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
      const payload = JSON.parse(await request.clone().text()) as {
        job: {
          request: Record<string, unknown>;
        };
      };

      return globalThis.fetch("https://runner-container.internal/__internal/run", {
        body: JSON.stringify(payload.job.request),
        headers: {
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
    runtimeBootstrapped?: boolean;
    backpressuredEventIds?: string[];
    bucket: ReturnType<typeof createBucket>;
    environment: {
      automationRecipientKeyId: string;
      automationRecipientPrivateKey: JsonWebKey;
      automationRecipientPrivateKeysById: Readonly<Record<string, JsonWebKey>>;
      automationRecipientPublicKey: JsonWebKey;
      platformEnvelopeKey: Uint8Array;
      platformEnvelopeKeyId: string;
      platformEnvelopeKeysById?: Readonly<Record<string, Uint8Array>>;
    };
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
      dispatch: {
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

  sql.exec("DELETE FROM pending_events");
  sql.exec("DELETE FROM consumed_events");
  sql.exec("DELETE FROM backpressured_events");
  sql.exec("DELETE FROM poisoned_events");
  sql.exec("DELETE FROM runner_bundle_slots");
  sql.exec("DELETE FROM runner_meta");

  const seedErrorCode = input.lastErrorCode
    ?? (input.lastError ? deriveHostedExecutionErrorCode(input.lastError) : null);

  sql.exec(
    `INSERT INTO runner_meta (
      singleton,
      user_id,
      runtime_bootstrapped,
      in_flight,
      last_error_at,
      last_error_code,
      last_run_at,
      next_wake_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    1,
    input.userId,
    input.runtimeBootstrapped ? 1 : 0,
    input.inFlight ? 1 : 0,
    input.lastErrorAt ?? null,
    seedErrorCode,
    input.lastRunAt ?? null,
    input.nextWakeAt ?? null,
  );

  sql.exec(
    `INSERT INTO runner_bundle_slots (slot, bundle_ref_json, bundle_version)
    VALUES (?, ?, ?), (?, ?, ?)`,
    "agentState",
    null,
    0,
    "vault",
    null,
    0,
  );

  const dispatchPayloadCrypto = await resolveHostedUserCryptoContextForTest({
    bucket: input.bucket,
    environment: input.environment,
    userId: input.userId,
  });
  const dispatchPayloadStore = createHostedDispatchPayloadStore({
    bucket: input.bucket.api,
    key: dispatchPayloadCrypto.rootKey,
    keyId: dispatchPayloadCrypto.rootKeyId,
    keysById: dispatchPayloadCrypto.keysById,
  });

  for (const pendingEvent of input.pendingEvents ?? []) {
    const payloadRef = await dispatchPayloadStore.writeDispatchPayload(
      pendingEvent.dispatch as never,
    );
    sql.exec(
      `INSERT INTO pending_events (
        event_id,
        payload_key,
        attempts,
        available_at,
        enqueued_at,
        last_error_code
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      pendingEvent.dispatch.eventId,
      payloadRef.key,
      pendingEvent.attempts,
      pendingEvent.availableAt,
      pendingEvent.enqueuedAt,
      pendingEvent.lastError ? deriveHostedExecutionErrorCode(pendingEvent.lastError) : null,
    );
  }

  for (const [index, eventId] of (input.backpressuredEventIds ?? []).entries()) {
    sql.exec(
      `INSERT INTO backpressured_events (
        event_id,
        rejected_at
      ) VALUES (?, ?)`,
      eventId,
      input.lastErrorAt
        ?? input.lastRunAt
        ?? new Date(Date.UTC(2026, 2, 26, 12, 0, index)).toISOString(),
    );
  }

  for (const poisonedEvent of input.poisonedEvents ?? []) {
    sql.exec(
      `INSERT INTO poisoned_events (
        event_id,
        poisoned_at,
        last_error_code
      ) VALUES (?, ?, ?)`,
      poisonedEvent.eventId,
      poisonedEvent.poisonedAt,
      deriveHostedExecutionErrorCode(poisonedEvent.lastError),
    );
  }

  if (input.lastEventId) {
    const isAlreadyTracked = (input.pendingEvents ?? []).some(
      (pendingEvent) => pendingEvent.dispatch.eventId === input.lastEventId,
    ) || (input.poisonedEvents ?? []).some(
      (poisonedEvent) => poisonedEvent.eventId === input.lastEventId,
    ) || (input.backpressuredEventIds ?? []).includes(input.lastEventId);

    if (!isAlreadyTracked) {
      sql.exec(
        `INSERT INTO consumed_events (
          event_id,
          recorded_at,
          expires_at
        ) VALUES (?, ?, ?)`,
        input.lastEventId,
        input.lastRunAt ?? input.lastErrorAt ?? "2026-03-26T12:00:00.000Z",
        "2026-04-25T12:00:00.000Z",
      );
    }
  }
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
  kinds: Array<"agent-state" | "vault">,
): void {
  for (const kind of kinds) {
    expect(keys).toContainEqual(expect.stringMatching(
      new RegExp(`^bundles/${kind}/[0-9a-f]+\\.bundle\\.json$`, "u"),
    ));
  }
}

async function userEnvObjectKeyForTest(rootKey: Uint8Array, userId: string): Promise<string> {
  const userSegment = await deriveHostedStorageOpaqueId({
    length: 24,
    rootKey,
    scope: "user-env-path",
    value: `user:${userId}`,
  });

  return `users/env/${userSegment}.json`;
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
}) {
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

function createDispatch(eventId: string) {
  return {
    event: {
      kind: "assistant.cron.tick" as const,
      reason: "manual" as const,
      userId: "member_123",
    },
    eventId,
    occurredAt: "2026-03-26T12:00:00.000Z",
  };
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

function createRunnerSuccessPayload(input: Partial<{
  agentState: string | null;
  eventsHandled: number;
  gatewayProjectionSnapshot: Record<string, unknown> | null;
  sideEffects: Array<{
    effectId: string;
    fingerprint: string;
    intentId: string;
    kind: "assistant.delivery";
  }>;
  summary: string;
  vault: string | null;
}> = {}) {
  return {
    bundles: {
      agentState: input.agentState ?? null,
      vault: input.vault ?? null,
    },
    result: {
      eventsHandled: input.eventsHandled ?? 1,
      summary: input.summary ?? "ok",
    },
    gatewayProjectionSnapshot: input.gatewayProjectionSnapshot ?? null,
    sideEffects: input.sideEffects ?? [],
  };
}

function serializeRunnerSuccessPayload(
  payload: ReturnType<typeof createRunnerSuccessPayload>,
): {
  finalGatewayProjectionSnapshot: Record<string, unknown> | null;
  result: {
    bundle: string | null;
    result: {
      eventsHandled: number;
      summary: string;
    };
  };
} {
  return {
    finalGatewayProjectionSnapshot: payload.gatewayProjectionSnapshot,
    result: {
      bundle: payload.bundles.vault ?? payload.bundles.agentState,
      result: payload.result,
    },
  };
}

async function createCommittedRunnerSuccessResponse(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: {
    platformEnvelopeKey: Uint8Array;
    platformEnvelopeKeyId: string;
  };
  init?: RequestInit;
  payload?: ReturnType<typeof createRunnerSuccessPayload>;
}): Promise<Response> {
  const payload = input.payload ?? createRunnerSuccessPayload();

  await commitResultForRunnerRequest({
    bucket: input.bucket,
    environment: input.environment,
    payload,
    requestBody: JSON.parse(String(input.init?.body)),
  });

  return new Response(JSON.stringify(serializeRunnerSuccessPayload(payload)), {
    status: 200,
  });
}

function readDispatchedEventIds(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([, init]) => {
    const body = typeof init?.body === "string" ? init.body : "";

    return (JSON.parse(body) as { dispatch: { eventId: string } }).dispatch.eventId;
  });
}

async function commitResultForRunnerRequest(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: {
    platformEnvelopeKey: Uint8Array;
    platformEnvelopeKeyId: string;
    platformEnvelopeKeysById?: Readonly<Record<string, Uint8Array>>;
  };
  payload: {
    bundles: {
      agentState: string | null;
      vault: string | null;
    };
    gatewayProjectionSnapshot?: Record<string, unknown> | null;
    result: {
      eventsHandled: number;
      summary: string;
    };
    sideEffects?: Array<{
      effectId: string;
      fingerprint: string;
      intentId: string;
      kind: "assistant.delivery";
    }>;
  };
  requestBody: {
    commit: {
      bundleRef: { hash: string; key: string; size: number; updatedAt: string } | null;
    };
    dispatch: {
      event: {
        userId: string;
      };
      eventId: string;
    };
  };
}): Promise<void> {
  const crypto = await resolveHostedUserCryptoContextForTest({
    bucket: input.bucket,
    environment: input.environment,
    userId: input.requestBody.dispatch.event.userId,
  });
  await persistHostedExecutionCommit({
    bucket: input.bucket.api,
    currentBundleRef: input.requestBody.commit.bundleRef,
    eventId: input.requestBody.dispatch.eventId,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    payload: {
      bundle: input.payload.bundles.vault ?? input.payload.bundles.agentState ?? null,
      gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
      result: input.payload.result,
      sideEffects: input.payload.sideEffects,
    },
    userId: input.requestBody.dispatch.event.userId,
  });
}

async function finalizeResultForRunnerRequest(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: {
    platformEnvelopeKey: Uint8Array;
    platformEnvelopeKeyId: string;
    platformEnvelopeKeysById?: Readonly<Record<string, Uint8Array>>;
  };
  payload: {
    bundles: {
      agentState: string | null;
      vault: string | null;
    };
    gatewayProjectionSnapshot?: Record<string, unknown> | null;
    sideEffects?: Array<{
      effectId: string;
      fingerprint: string;
      intentId: string;
      kind: "assistant.delivery";
    }>;
  };
  requestBody: {
    dispatch: {
      event: {
        userId: string;
      };
      eventId: string;
    };
  };
}): Promise<void> {
  const crypto = await resolveHostedUserCryptoContextForTest({
    bucket: input.bucket,
    environment: input.environment,
    userId: input.requestBody.dispatch.event.userId,
  });
  await persistHostedExecutionFinalBundles({
    bucket: input.bucket.api,
    eventId: input.requestBody.dispatch.eventId,
    key: crypto.rootKey,
    keyId: crypto.rootKeyId,
    keysById: crypto.keysById,
    payload: {
      bundle: input.payload.bundles.vault ?? input.payload.bundles.agentState ?? null,
      gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
    },
    userId: input.requestBody.dispatch.event.userId,
  });
}

async function resolveHostedUserCryptoContextForTest(input: {
  bucket: ReturnType<typeof createBucket>;
  environment: {
    platformEnvelopeKey: Uint8Array;
    platformEnvelopeKeyId: string;
    platformEnvelopeKeysById?: Readonly<Record<string, Uint8Array>>;
  };
  userId: string;
}) {
  return createHostedUserKeyStore({
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
  }).bootstrapManagedUserCryptoContext(input.userId);
}
