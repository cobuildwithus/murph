import { describe, expect, it } from "vitest";

import {
  buildHostedSecureBoxAad,
  sealHostedSecureBox,
  serializeHostedSecureBoxEnvelope,
} from "@murphai/runtime-state";

import {
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
        payloadSchema: "murph.hosted-mailbox-item-payload.v1",
        payloadStorage,
        userId: "member_mailbox_1",
      };
      const ciphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
        aad: buildHostedSecureBoxAad({
          domain: "ingress",
          field,
          lane: "mailbox-payload",
          objectKey: JSON.stringify({
            dedupeKey: metadata.dedupeKey,
            kind: metadata.kind,
            lane: metadata.lane,
            occurredAt: metadata.occurredAt,
            payloadSchema: metadata.payloadSchema,
            payloadStorage,
          }),
          purpose: "hosted-mailbox-payload",
          rowId: metadata.itemId,
          scope: `hosted-mailbox-payload:${field}`,
          sequence: metadata.laneSeq,
          table: "hosted_mailbox_item",
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
        scope: `hosted-mailbox-payload:${field}`,
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
});
