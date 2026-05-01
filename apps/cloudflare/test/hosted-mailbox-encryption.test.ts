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

    for (const field of [
      "hosted-mailbox-inline-payload",
      "hosted-mailbox-ref-payload",
    ] as const) {
      const ciphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
        aad: buildHostedSecureBoxAad({
          domain: "ingress",
          field,
          lane: "mailbox-payload",
          purpose: "hosted-mailbox-payload",
          scope: `hosted-mailbox-payload:${field}`,
          userId: "member_mailbox_1",
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
        userId: "member_mailbox_1",
      })).resolves.toEqual({
        field,
        kind: "member.channels.updated",
      });
    }
  });
});
