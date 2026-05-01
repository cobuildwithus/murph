import {
  buildHostedSecureBoxAad,
  openHostedSecureBox,
  parseSerializedHostedSecureBoxEnvelope,
} from "@murphai/runtime-state";

const HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD = "hosted-mailbox-inline-payload";
const HOSTED_MAILBOX_REF_PAYLOAD_FIELD = "hosted-mailbox-ref-payload";

export interface HostedMailboxEncryptionEnvironment {
  ingressRootKey: Uint8Array;
  ingressRootKeyId: string;
}

export function createHostedMailboxEncryptionEnvironmentFromIngressRoot(input: {
  rootKey: Uint8Array;
  rootKeyId: string;
}): HostedMailboxEncryptionEnvironment {
  if (input.rootKey.byteLength !== 32) {
    throw new TypeError("Hosted mailbox ingress root key must be 32 bytes.");
  }
  if (!input.rootKeyId) {
    throw new TypeError("Hosted mailbox ingress root key id is required.");
  }
  return { ingressRootKey: input.rootKey, ingressRootKeyId: input.rootKeyId };
}

export async function decryptHostedMailboxPayloadCiphertext(input: {
  ciphertext: string;
  environment: HostedMailboxEncryptionEnvironment;
  userId: string;
}): Promise<unknown> {
  const fields = [HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD, HOSTED_MAILBOX_REF_PAYLOAD_FIELD] as const;
  let lastError: unknown = null;
  for (const field of fields) {
    try {
      const scope = `hosted-mailbox-payload:${field}`;
      const aad = buildHostedSecureBoxAad({
        domain: "ingress",
        field,
        lane: "mailbox-payload",
        purpose: "hosted-mailbox-payload",
        scope,
        userId: input.userId,
      });
      const plaintext = await openHostedSecureBox({
        aad,
        envelope: parseSerializedHostedSecureBoxEnvelope(input.ciphertext),
        expectedDomain: "ingress",
        expectedLane: "mailbox-payload",
        expectedRootKeyId: input.environment.ingressRootKeyId,
        expectedScope: scope,
        rootKey: input.environment.ingressRootKey,
      });
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new TypeError("Hosted mailbox payload ciphertext is invalid.");
}
