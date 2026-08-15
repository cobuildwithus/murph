import {
  buildHostedSecureBoxAad,
  openHostedSecureBox,
  parseSerializedHostedSecureBoxEnvelope,
} from "@murphai/runtime-state";
import {
  buildHostedMailboxPayloadScope,
  buildHostedMailboxPayloadSecureBoxAad,
  HOSTED_MAILBOX_PREPARED_PAYLOAD_AAD_SEQUENCE,
  HOSTED_MAILBOX_PREPARED_PAYLOAD_CIPHERTEXT_PREFIX,
  type HostedMailboxPayloadCryptoMetadata,
} from "@murphai/hosted-execution/runtime-control";

export type { HostedMailboxPayloadCryptoMetadata };

export interface HostedMailboxIngressRoot {
  rootKey: Uint8Array;
  rootKeyId: string;
}

export interface HostedMailboxEncryptionEnvironment {
  readIngressRoot(rootKeyId: string): Promise<HostedMailboxIngressRoot>;
}

export function createHostedMailboxEncryptionEnvironmentFromIngressRoot(input: {
  rootKey: Uint8Array;
  rootKeyId: string;
}): HostedMailboxEncryptionEnvironment {
  const root = requireHostedMailboxIngressRoot(input);
  return createHostedMailboxEncryptionEnvironmentFromIngressRootResolver({
    async readIngressRoot(rootKeyId) {
      if (rootKeyId !== root.rootKeyId) {
        throw new Error(`Hosted mailbox ingress root ${rootKeyId} is not available in this environment.`);
      }
      return root;
    },
  });
}

export function createHostedMailboxEncryptionEnvironmentFromIngressRootResolver(input: {
  readIngressRoot(rootKeyId: string): Promise<HostedMailboxIngressRoot>;
}): HostedMailboxEncryptionEnvironment {
  return {
    async readIngressRoot(rootKeyId) {
      return requireHostedMailboxIngressRoot(await input.readIngressRoot(rootKeyId));
    },
  };
}

function requireHostedMailboxIngressRoot(input: {
  rootKey: Uint8Array;
  rootKeyId: string;
}): HostedMailboxIngressRoot {
  if (input.rootKey.byteLength !== 32) {
    throw new TypeError("Hosted mailbox ingress root key must be 32 bytes.");
  }
  if (!input.rootKeyId) {
    throw new TypeError("Hosted mailbox ingress root key id is required.");
  }
  return { rootKey: input.rootKey, rootKeyId: input.rootKeyId };
}

export async function decryptHostedMailboxPayloadCiphertext(input: {
  ciphertext: string;
  environment: HostedMailboxEncryptionEnvironment;
  metadata: HostedMailboxPayloadCryptoMetadata;
}): Promise<unknown> {
  const prepared = input.ciphertext.startsWith(
    HOSTED_MAILBOX_PREPARED_PAYLOAD_CIPHERTEXT_PREFIX,
  );
  const ciphertext = prepared
    ? input.ciphertext.slice(
      HOSTED_MAILBOX_PREPARED_PAYLOAD_CIPHERTEXT_PREFIX.length,
    )
    : input.ciphertext;
  const metadata = prepared
    ? {
      ...input.metadata,
      laneSeq: HOSTED_MAILBOX_PREPARED_PAYLOAD_AAD_SEQUENCE,
    }
    : input.metadata;
  const envelope = parseSerializedHostedSecureBoxEnvelope(ciphertext);
  const ingressRoot = await input.environment.readIngressRoot(envelope.rootKeyId);
  const scope = buildHostedMailboxPayloadScope(metadata.payloadStorage);
  const aad = buildHostedSecureBoxAad({
    ...buildHostedMailboxPayloadSecureBoxAad(metadata),
    domain: "ingress",
    lane: "mailbox-payload",
    scope,
    userId: metadata.userId,
  });
  const plaintext = await openHostedSecureBox({
    aad,
    envelope,
    expectedDomain: "ingress",
    expectedLane: "mailbox-payload",
    expectedRootKeyId: envelope.rootKeyId,
    expectedScope: scope,
    rootKey: ingressRoot.rootKey,
  });
  return JSON.parse(new TextDecoder().decode(plaintext));
}
