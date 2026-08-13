import "server-only";

import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  parseHostedVaultShareDeliveryRecord,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import {
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxString,
  type HostedSecureBoxPrismaClient,
} from "../hosted-crypto/secure-box";

const HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_SCHEMA =
  "murph.hosted-vault-share.projection-snapshot.v1" as const;
const HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_SCOPE =
  "hosted-vault-share-projection-snapshot:v1";
export const HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_MAX_BYTES = 32 * 1024;

export interface HostedVaultShareProjectionSnapshotAuthority {
  destinationMemberId: string;
  grantorMemberId: string;
  id: string;
  projectionKind: string;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

export interface HostedVaultShareProjectionSnapshotEntry
  extends HostedVaultShareProjectionSnapshotAuthority {
  ciphertext: string | null | undefined;
}

export function serializeHostedVaultShareProjectionSnapshot(input: {
  records: readonly HostedVaultShareDeliveryRecord[];
  share: HostedVaultShareProjectionSnapshotAuthority;
}): string {
  const records = parseHostedVaultShareProjectionSnapshotRecords(
    input.records,
    input.share,
  );
  const serialized = JSON.stringify({
    records,
    schema: HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_SCHEMA,
  });
  assertHostedVaultShareProjectionSnapshotSize(serialized);
  return serialized;
}

export function parseHostedVaultShareProjectionSnapshot(input: {
  plaintext: string;
  share: HostedVaultShareProjectionSnapshotAuthority;
}): HostedVaultShareDeliveryRecord[] {
  assertHostedVaultShareProjectionSnapshotSize(input.plaintext);

  let value: unknown;
  try {
    value = JSON.parse(input.plaintext);
  } catch {
    throw new TypeError("Hosted vault-share projection snapshot must be valid JSON.");
  }
  const snapshot = requirePlainObject(
    value,
    "Hosted vault-share projection snapshot",
  );
  assertExactKeys(
    snapshot,
    ["records", "schema"],
    "Hosted vault-share projection snapshot",
  );
  if (snapshot.schema !== HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_SCHEMA) {
    throw new TypeError("Hosted vault-share projection snapshot schema is invalid.");
  }
  if (!Array.isArray(snapshot.records)) {
    throw new TypeError("Hosted vault-share projection snapshot records must be an array.");
  }
  return parseHostedVaultShareProjectionSnapshotRecords(
    snapshot.records,
    input.share,
  );
}

export async function encryptHostedVaultShareProjectionSnapshot(input: {
  prisma?: HostedSecureBoxPrismaClient;
  records: readonly HostedVaultShareDeliveryRecord[];
  share: HostedVaultShareProjectionSnapshotAuthority;
  signal?: AbortSignal;
}): Promise<string> {
  const value = serializeHostedVaultShareProjectionSnapshot(input);
  const ciphertext = await sealHostedUserSecureBoxString({
    aad: buildHostedVaultShareProjectionSnapshotAad(input.share),
    lane: "mailbox-payload",
    prisma: input.prisma,
    scope: HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_SCOPE,
    signal: input.signal,
    userId: input.share.destinationMemberId,
    value,
  });
  if (!ciphertext) {
    throw new Error("Hosted vault-share projection snapshot encryption returned no value.");
  }
  return ciphertext;
}

export async function decryptHostedVaultShareProjectionSnapshots(input: {
  entries: readonly HostedVaultShareProjectionSnapshotEntry[];
  prisma?: HostedSecureBoxPrismaClient;
}): Promise<Array<HostedVaultShareDeliveryRecord[] | null>> {
  if (input.entries.some((entry) =>
    entry.ciphertext !== null
    && entry.ciphertext !== undefined
    && entry.ciphertext.trim().length === 0
  )) {
    throw new TypeError(
      "Hosted vault-share projection snapshot ciphertext must not be blank.",
    );
  }
  const plaintexts = await openHostedUserSecureBoxStrings({
    entries: input.entries.map((entry) => ({
      aad: buildHostedVaultShareProjectionSnapshotAad(entry),
      scope: HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_SCOPE,
      userId: entry.destinationMemberId,
      value: entry.ciphertext,
    })),
    lane: "mailbox-payload",
    prisma: input.prisma,
  });

  return plaintexts.map((plaintext, index) => {
    if (plaintext === null) {
      return null;
    }
    const entry = input.entries[index];
    if (!entry) {
      throw new Error("Hosted vault-share projection snapshot entry is missing.");
    }
    return parseHostedVaultShareProjectionSnapshot({ plaintext, share: entry });
  });
}

export function buildHostedVaultShareProjectionSnapshotAad(
  share: HostedVaultShareProjectionSnapshotAuthority,
): {
  field: string;
  objectKey: string;
  purpose: string;
  rowId: string;
  table: string;
} {
  assertHostedVaultShareProjectionSnapshotAuthority(share);
  return {
    field: "projection_snapshot_ciphertext",
    objectKey: JSON.stringify([
      share.destinationMemberId,
      share.projectionScopeKey,
      share.grantorMemberId,
    ]),
    purpose: "hosted-vault-share-projection-snapshot",
    rowId: share.id,
    table: "hosted_vault_share",
  };
}

function parseHostedVaultShareProjectionSnapshotRecords(
  value: readonly unknown[],
  share: HostedVaultShareProjectionSnapshotAuthority,
): HostedVaultShareDeliveryRecord[] {
  assertHostedVaultShareProjectionSnapshotAuthority(share);
  if (value.length > HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS) {
    throw new TypeError(
      `Hosted vault-share projection snapshot records must contain at most ${HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS} entries.`,
    );
  }

  const seenRecordKeys = new Set<string>();
  return value.map((record) => {
    const parsed = parseHostedVaultShareDeliveryRecord(
      record,
      share.projectionScope,
    );
    if (seenRecordKeys.has(parsed.recordKey)) {
      throw new TypeError(
        "Hosted vault-share projection snapshot record keys must be unique.",
      );
    }
    seenRecordKeys.add(parsed.recordKey);
    return parsed;
  });
}

function assertHostedVaultShareProjectionSnapshotAuthority(
  share: HostedVaultShareProjectionSnapshotAuthority,
): void {
  const projectionScope = parseHostedVaultShareProjectionScope(
    share.projectionScope,
    "Hosted vault-share projection snapshot scope",
  );
  if (
    projectionScope.projectionKind !== share.projectionKind
    || buildHostedVaultShareProjectionScopeKey(projectionScope)
      !== share.projectionScopeKey
  ) {
    throw new TypeError("Hosted vault-share projection snapshot authority is invalid.");
  }
  for (const [label, value] of [
    ["id", share.id],
    ["grantorMemberId", share.grantorMemberId],
    ["destinationMemberId", share.destinationMemberId],
  ] as const) {
    if (!value.trim()) {
      throw new TypeError(`Hosted vault-share projection snapshot ${label} is required.`);
    }
  }
}

function assertHostedVaultShareProjectionSnapshotSize(value: string): void {
  if (new TextEncoder().encode(value).byteLength > HOSTED_VAULT_SHARE_PROJECTION_SNAPSHOT_MAX_BYTES) {
    throw new TypeError("Hosted vault-share projection snapshot is too large.");
  }
}

function requirePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(`${label} has unexpected fields.`);
  }
}
