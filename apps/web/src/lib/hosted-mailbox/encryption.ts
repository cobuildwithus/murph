import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";

export type HostedMailboxEncryptionPrismaClient = HostedSecureBoxPrismaClient;
export type HostedMailboxPayloadStorage = "inline" | "sidecar";

export interface HostedMailboxPayloadCryptoMetadata {
  dedupeKey: string;
  field: string;
  itemId: string;
  kind: string;
  lane: string;
  laneSeq: bigint | number | string;
  occurredAt: string;
  payloadSchema: string;
  payloadStorage: HostedMailboxPayloadStorage;
  userId: string;
}

export async function encryptHostedMailboxPayloadString(input: HostedMailboxPayloadCryptoMetadata & {
  prisma?: HostedMailboxEncryptionPrismaClient;
  value: string | null | undefined;
}): Promise<string | null> {
  return sealHostedUserSecureBoxString({
    aad: buildHostedMailboxPayloadAad(input),
    lane: "mailbox-payload",
    prisma: input.prisma,
    scope: `hosted-mailbox-payload:${input.field}`,
    userId: input.userId,
    value: input.value,
  });
}

export async function decryptHostedMailboxPayloadString(input: HostedMailboxPayloadCryptoMetadata & {
  prisma?: HostedMailboxEncryptionPrismaClient;
  value: string | null | undefined;
}): Promise<string | null> {
  return openHostedUserSecureBoxString({
    aad: buildHostedMailboxPayloadAad(input),
    lane: "mailbox-payload",
    prisma: input.prisma,
    scope: `hosted-mailbox-payload:${input.field}`,
    userId: input.userId,
    value: input.value,
  });
}

function buildHostedMailboxPayloadAad(input: HostedMailboxPayloadCryptoMetadata) {
  return {
    field: input.field,
    objectKey: buildHostedMailboxPayloadAadObjectKey(input),
    purpose: "hosted-mailbox-payload",
    rowId: input.itemId,
    sequence: input.laneSeq,
    table: "hosted_mailbox_item",
  };
}

export function buildHostedMailboxPayloadAadObjectKey(
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
