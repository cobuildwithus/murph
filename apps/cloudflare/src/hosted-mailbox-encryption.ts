import {
  buildHostedSecureBoxAad,
  openHostedSecureBox,
  parseSerializedHostedSecureBoxEnvelope,
} from "@murphai/runtime-state";

const HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD = "hosted-mailbox-inline-payload";
const HOSTED_MAILBOX_REF_PAYLOAD_FIELD = "hosted-mailbox-ref-payload";

export type HostedMailboxPayloadStorage = "inline" | "sidecar";

export interface HostedMailboxPayloadCryptoMetadata {
  dedupeKey: string;
  kind: string;
  lane: string;
  laneSeq: string;
  occurredAt: string;
  payloadSchema: string;
  payloadStorage: HostedMailboxPayloadStorage;
  userId: string;
  itemId: string;
}

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
  metadata: HostedMailboxPayloadCryptoMetadata;
}): Promise<unknown> {
  const field = input.metadata.payloadStorage === "inline"
    ? HOSTED_MAILBOX_INLINE_PAYLOAD_FIELD
    : HOSTED_MAILBOX_REF_PAYLOAD_FIELD;
  const scope = `hosted-mailbox-payload:${field}`;
  const aad = buildHostedSecureBoxAad({
    domain: "ingress",
    field,
    lane: "mailbox-payload",
    objectKey: buildHostedMailboxPayloadAadObjectKey(input.metadata),
    purpose: "hosted-mailbox-payload",
    rowId: input.metadata.itemId,
    scope,
    sequence: input.metadata.laneSeq,
    table: "hosted_mailbox_item",
    userId: input.metadata.userId,
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
}

function buildHostedMailboxPayloadAadObjectKey(
  input: Pick<
    HostedMailboxPayloadCryptoMetadata,
    | "dedupeKey"
    | "kind"
    | "lane"
    | "occurredAt"
    | "payloadSchema"
    | "payloadStorage"
  >,
): string {
  return JSON.stringify({
    dedupeKey: requireHostedMailboxAadString(input.dedupeKey, "dedupeKey"),
    kind: requireHostedMailboxAadString(input.kind, "kind"),
    lane: requireHostedMailboxAadString(input.lane, "lane"),
    occurredAt: requireHostedMailboxAadString(input.occurredAt, "occurredAt"),
    payloadSchema: requireHostedMailboxAadString(input.payloadSchema, "payloadSchema"),
    payloadStorage: input.payloadStorage,
  });
}

function requireHostedMailboxAadString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`Hosted mailbox payload AAD ${label} must be a non-empty string.`);
  }
  return normalized;
}
