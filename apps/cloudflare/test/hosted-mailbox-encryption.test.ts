import { describe, expect, it } from "vitest";

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
