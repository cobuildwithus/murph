import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHostedWorkspaceRuntimeBridgeJobOptions } from "@murphai/assistant-runtime/hosted-invocation-testkit";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";

import {
  buildHostedSecureBoxAad,
  sealHostedSecureBox,
  serializeHostedSecureBoxEnvelope,
} from "@murphai/runtime-state";
import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  HOSTED_MAILBOX_PREPARED_PAYLOAD_AAD_SEQUENCE,
  HOSTED_MAILBOX_PREPARED_PAYLOAD_CIPHERTEXT_PREFIX,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedMailboxEncryptionEnvironmentFromIngressRootResolver,
  createHostedMailboxEncryptionEnvironmentFromIngressRoot,
  decryptHostedMailboxPayloadCiphertext,
} from "../src/hosted-mailbox-encryption.ts";

const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const rootKeyId = "udrk:ingress:test-root";

describe("hosted mailbox secure-box encryption", () => {
  it("decrypts inline and sidecar mailbox payloads from the ingress root", async () => {
    const environment = createHostedMailboxEncryptionEnvironmentFromIngressRoot({
      rootKey,
      rootKeyId,
    });

    for (const { field, payloadStorage } of [
      { field: "hosted-mailbox-inline-payload", payloadStorage: "inline" },
      { field: "hosted-mailbox-ref-payload", payloadStorage: "sidecar" },
    ] as const) {
      const metadata = {
        dedupeKey: `event:${field}`,
        itemId: `item:${field}`,
        kind: "member.channels.updated",
        lane: "system",
        laneSeq: field === "hosted-mailbox-inline-payload" ? "1" : "2",
        occurredAt: "2026-05-01T00:00:00.000Z",
        payloadSchema: payloadStorage === "inline"
          ? HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA
          : HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        payloadStorage,
        userId: "member_mailbox_1",
      };
      const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
      const secureBoxAad = buildHostedMailboxPayloadSecureBoxAad(metadata);
      const ciphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
        aad: buildHostedSecureBoxAad({
          domain: "ingress",
          ...secureBoxAad,
          lane: "mailbox-payload",
          scope,
          userId: metadata.userId,
        }),
        domain: "ingress",
        lane: "mailbox-payload",
        plaintext: new TextEncoder().encode(JSON.stringify({
          field,
          kind: "member.channels.updated",
        })),
        rootKey,
        rootKeyId,
        scope,
      }));

      await expect(decryptHostedMailboxPayloadCiphertext({
        ciphertext,
        environment,
        metadata,
      })).resolves.toEqual({
        field,
        kind: "member.channels.updated",
      });
    }
  });

  it.each(["creative-response", "creative-response-text"])("decrypts an old %s wake and terminally skips it without model or delivery effects", async (notificationPromptProfile) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-retired-encrypted-wake-"));
    try {
      const metadata = {
        dedupeKey: "assistant.notification.requested:synthetic-retired", itemId: "synthetic-retired",
        kind: "assistant.notification.requested" as const, lane: "system", laneSeq: "1",
        occurredAt: "2026-05-01T00:00:00.000Z", payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
        payloadStorage: "inline" as const, userId: "synthetic-group",
      };
      const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
      // Persist the historical producer shape, independent of current builders.
      const oldWake = {
        eventId: metadata.dedupeKey, kind: metadata.kind, occurredAt: metadata.occurredAt, userId: metadata.userId,
        notification: {
          notificationPromptProfile, instructions: "Retired synthetic creative request.",
          responsePolicy: { kind: "require_send" }, deliveryDispatchMode: "queue-only",
          deliveryDedupeToken: "synthetic-retired", deliveryIdempotencyKey: "synthetic-retired",
          route: { actorId: null, channel: "telegram", delivery: { kind: "thread", target: "synthetic-group" }, identityId: "synthetic-group", threadId: "synthetic-group", threadIsDirect: false },
        },
      };
      const ciphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
        aad: buildHostedSecureBoxAad({ ...buildHostedMailboxPayloadSecureBoxAad(metadata), domain: "ingress", lane: "mailbox-payload", scope, userId: metadata.userId }),
        domain: "ingress", lane: "mailbox-payload", plaintext: new TextEncoder().encode(JSON.stringify(oldWake)),
        rootKey, rootKeyId, scope,
      }));
      const decode = vi.fn(async () => ({
        status: "decoded" as const,
        wake: parseHostedExecutionWake(await decryptHostedMailboxPayloadCiphertext({
          ciphertext, environment: createHostedMailboxEncryptionEnvironmentFromIngressRoot({ rootKey, rootKeyId }), metadata,
        })),
      }));
      const unexpectedEffect = vi.fn(() => { throw new Error("Retired work must not access model, delivery, or other runtime effects."); });
      const options = createHostedWorkspaceRuntimeBridgeJobOptions({
        decodeMailboxPayload: { decode },
        platform: {
          artifactStore: { get: unexpectedEffect, put: unexpectedEffect },
          effectsPort: { readRawEmailMessage: unexpectedEffect, sendEmail: unexpectedEffect },
          providerFetch: unexpectedEffect,
        },
        request: { attemptId: "synthetic-attempt", leaseGeneration: "1", providerEgressToken: "synthetic-token", userId: metadata.userId, workspaceVersion: "1" },
        runtime: {}, snapshotArchiveBuilder: { buildEncryptedSnapshot: unexpectedEffect },
        vaultRoot, waitForBackgroundAssistantWork: async () => {},
      });
      await expect(options.importItem({
        item: {
          createdAt: metadata.occurredAt, dedupeKey: metadata.dedupeKey, expiresAt: null,
          id: metadata.itemId, kind: metadata.kind, lane: "system", laneSeq: "1", occurredAt: metadata.occurredAt,
          payloadBytes: ciphertext.length, payloadInlineCiphertext: ciphertext, payloadRef: null,
          payloadSchema: metadata.payloadSchema, updatedAt: metadata.occurredAt, userId: metadata.userId,
        },
        payload: { payloadCiphertext: ciphertext, payloadSchema: metadata.payloadSchema, requestId: null, source: "inline", status: "resolved" },
        route: { action: "dispatch-assistant-notification", advanceProgress: true, itemRef: { id: metadata.itemId, kind: metadata.kind, lane: "system", laneSeq: "1" }, state: "route" },
      })).resolves.toEqual({ reasonCode: "mailbox.notification_profile_retired", status: "skipped" });
      expect(decode).toHaveBeenCalledOnce();
      expect(unexpectedEffect).not.toHaveBeenCalled();
      expect(await readdir(vaultRoot)).toEqual([]);
    } finally {
      await rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it("requests the exact envelope root key id when decrypting mailbox payloads", async () => {
    const envelopeRootKey = Uint8Array.from({ length: 32 }, (_, index) => 33 + index);
    const envelopeRootKeyId = "udrk:ingress:exact-envelope-root";
    const resolvedRootKeyIds: string[] = [];
    const environment = createHostedMailboxEncryptionEnvironmentFromIngressRootResolver({
      async readIngressRoot(rootKeyId) {
        resolvedRootKeyIds.push(rootKeyId);
        if (rootKeyId !== envelopeRootKeyId) {
          throw new Error(`Unexpected hosted mailbox ingress root ${rootKeyId}.`);
        }
        return {
          rootKey: envelopeRootKey,
          rootKeyId: envelopeRootKeyId,
        };
      },
    });
    const metadata = {
      dedupeKey: "event:hosted-mailbox-exact-envelope-root",
      itemId: "item:hosted-mailbox-exact-envelope-root",
      kind: "member.channels.updated",
      lane: "system",
      laneSeq: "3",
      occurredAt: "2026-05-01T00:00:00.000Z",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      payloadStorage: "inline" as const,
      userId: "member_mailbox_1",
    };
    const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
    const secureBoxAad = buildHostedMailboxPayloadSecureBoxAad(metadata);
    const ciphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        domain: "ingress",
        ...secureBoxAad,
        lane: "mailbox-payload",
        scope,
        userId: metadata.userId,
      }),
      domain: "ingress",
      lane: "mailbox-payload",
      plaintext: new TextEncoder().encode(JSON.stringify({
        field: "hosted-mailbox-inline-payload",
        kind: "member.channels.updated",
      })),
      rootKey: envelopeRootKey,
      rootKeyId: envelopeRootKeyId,
      scope,
    }));

    await expect(decryptHostedMailboxPayloadCiphertext({
      ciphertext,
      environment,
      metadata,
    })).resolves.toEqual({
      field: "hosted-mailbox-inline-payload",
      kind: "member.channels.updated",
    });
    expect(resolvedRootKeyIds).toEqual([envelopeRootKeyId]);
  });

  it("decrypts a prepared payload after its terminal sequence is allocated", async () => {
    const environment = createHostedMailboxEncryptionEnvironmentFromIngressRoot({
      rootKey,
      rootKeyId,
    });
    const metadata = {
      dedupeKey: "event:prepared-channel-sync",
      itemId: "item:prepared-channel-sync",
      kind: "member.channels.updated",
      lane: "system",
      laneSeq: "27",
      occurredAt: "2026-08-11T12:00:00.000Z",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      payloadStorage: "inline" as const,
      userId: "member_mailbox_1",
    };
    const preparedMetadata = {
      ...metadata,
      laneSeq: HOSTED_MAILBOX_PREPARED_PAYLOAD_AAD_SEQUENCE,
    };
    const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
    const ciphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        domain: "ingress",
        ...buildHostedMailboxPayloadSecureBoxAad(preparedMetadata),
        lane: "mailbox-payload",
        scope,
        userId: metadata.userId,
      }),
      domain: "ingress",
      lane: "mailbox-payload",
      plaintext: new TextEncoder().encode(JSON.stringify({
        kind: "member.channels.updated",
      })),
      rootKey,
      rootKeyId,
      scope,
    }));

    await expect(decryptHostedMailboxPayloadCiphertext({
      ciphertext:
        `${HOSTED_MAILBOX_PREPARED_PAYLOAD_CIPHERTEXT_PREFIX}${ciphertext}`,
      environment,
      metadata,
    })).resolves.toEqual({ kind: "member.channels.updated" });
  });
});
