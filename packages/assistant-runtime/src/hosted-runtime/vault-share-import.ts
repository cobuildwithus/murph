import type { Dirent } from "node:fs";
import { readdir, readFile, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";

import { normalizeOpaquePathSegment } from "@murphai/core";
import type {
  HostedExecutionVaultShareDeliveryWake,
  HostedExecutionVaultShareRevokeWake,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  HOSTED_VAULT_SHARE_PROJECTION_KINDS,
  parseHostedVaultShareDeliveryRecord,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";
import { writeJsonFileAtomic } from "@murphai/runtime-state/node";

import type { HostedMailboxItemImportOutcome } from "./mailbox-import.ts";

const SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA =
  "murph.shared-vault-projections.v1";

interface SharedVaultShareRecordEntry {
  receivedEventId: string;
  record: HostedVaultShareDeliveryRecord;
  schema: typeof HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA;
  shareId: string;
}

interface SharedVaultShareGrantorEntry {
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  records: SharedVaultShareRecordEntry[];
  shareId: string;
  updatedAt: string;
}

interface SharedVaultShareProjectionEntry {
  grantors: Record<string, SharedVaultShareGrantorEntry>;
}

interface SharedVaultShareProjectionsFile {
  projections: Partial<Record<HostedVaultShareProjectionKind, SharedVaultShareProjectionEntry>>;
  schema: typeof SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA;
  updatedAt: string;
}

/**
 * Destination-side landing for consented vault-share deliveries: a deterministic,
 * idempotent upsert of the shared record into one compact derived destination
 * workspace file. The file is bounded by projection kind, grantor, and the delivery
 * record cap, so repeated deliveries cannot grow the vault file tree. Promotion into
 * richer canonical entities is a future consumer of this file, not a change to this
 * boundary.
 */
export async function importHostedVaultShareDeliveryWake(input: {
  vaultRoot: string;
  wake: HostedExecutionVaultShareDeliveryWake;
}): Promise<HostedMailboxItemImportOutcome> {
  const delivery = input.wake.delivery;

  // Defense in depth: every path segment below is parser-constrained upstream, but this
  // handler is the one that touches the filesystem, so it re-asserts identifier safety.
  if (!hasSafeVaultShareIdentifiers({
    grantorMemberId: delivery.grantorMemberId,
    projectionKind: delivery.projectionKind,
    recordKey: delivery.record.recordKey,
    shareId: delivery.shareId,
  })) {
    return {
      reasonCode: "vault_share.unsafe_path_segment",
      retryable: false,
      status: "blocked",
    };
  }

  try {
    const store = await readSharedVaultShareProjectionStore(input.vaultRoot);
    if (!store) {
      return {
        reasonCode: "vault_share.read_failed",
        retryable: true,
        status: "blocked",
      };
    }

    upsertSharedVaultShareRecord(store, {
      grantorMemberId: delivery.grantorMemberId,
      projectionKind: delivery.projectionKind,
      receivedEventId: input.wake.eventId,
      record: delivery.record,
      shareId: delivery.shareId,
      updatedAt: input.wake.occurredAt,
    });
    await writeSharedVaultShareProjectionStore(input.vaultRoot, store);
  } catch {
    // Retry instead of consuming the mailbox item: the web mailbox dedupe key already
    // owns exact replay idempotency, so the destination must not checkpoint past the
    // item until the projection write is durable.
    return {
      reasonCode: "vault_share.write_failed",
      retryable: true,
      status: "blocked",
    };
  }

  return { status: "imported" };
}

export async function applyHostedVaultShareRevokeWake(input: {
  vaultRoot: string;
  wake: HostedExecutionVaultShareRevokeWake;
}): Promise<HostedMailboxItemImportOutcome> {
  const revoke = input.wake.revoke;

  if (!hasSafeVaultShareIdentifiers({
    grantorMemberId: revoke.grantorMemberId,
    projectionKind: revoke.projectionKind,
    shareId: revoke.shareId,
  })) {
    return {
      reasonCode: "vault_share.unsafe_path_segment",
      retryable: false,
      status: "blocked",
    };
  }

  try {
    const store = await readSharedVaultShareProjectionStore(input.vaultRoot);
    if (!store) {
      return {
        reasonCode: "vault_share.read_failed",
        retryable: true,
        status: "blocked",
      };
    }

    await removeLegacySharedVaultShareProjectionRecords({
      grantorMemberId: revoke.grantorMemberId,
      projectionKind: revoke.projectionKind,
      shareId: revoke.shareId,
      vaultRoot: input.vaultRoot,
    });

    const projection = store.projections[revoke.projectionKind];
    const grantor = projection?.grantors[revoke.grantorMemberId];
    if (!projection || !grantor) {
      return { status: "imported" };
    }

    if (grantor.shareId !== revoke.shareId) {
      return { status: "imported" };
    }

    delete projection.grantors[revoke.grantorMemberId];
    if (Object.keys(projection.grantors).length === 0) {
      delete store.projections[revoke.projectionKind];
    }
    store.updatedAt = revoke.revokedAt;

    if (Object.keys(store.projections).length === 0) {
      await rm(resolveSharedVaultShareProjectionStorePath(input.vaultRoot), {
        force: true,
      });
    } else {
      await writeSharedVaultShareProjectionStore(input.vaultRoot, store);
    }
  } catch {
    return {
      reasonCode: "vault_share.write_failed",
      retryable: true,
      status: "blocked",
    };
  }

  return { status: "imported" };
}

function upsertSharedVaultShareRecord(
  store: SharedVaultShareProjectionsFile,
  input: {
    grantorMemberId: string;
    projectionKind: HostedVaultShareProjectionKind;
    receivedEventId: string;
    record: HostedVaultShareDeliveryRecord;
    shareId: string;
    updatedAt: string;
  },
): void {
  const projection = store.projections[input.projectionKind] ?? { grantors: {} };
  const existingGrantor = projection.grantors[input.grantorMemberId];
  const grantor = existingGrantor?.shareId === input.shareId ? existingGrantor : {
    grantorMemberId: input.grantorMemberId,
    projectionKind: input.projectionKind,
    records: [],
    shareId: input.shareId,
    updatedAt: input.updatedAt,
  };

  const nextRecord: SharedVaultShareRecordEntry = {
    receivedEventId: input.receivedEventId,
    record: input.record,
    schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
    shareId: input.shareId,
  };
  const records = [
    nextRecord,
    ...grantor.records.filter(
      (record) => record.record.recordKey !== input.record.recordKey,
    ),
  ]
    .sort(compareSharedVaultShareRecords)
    .slice(0, HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS);

  projection.grantors[input.grantorMemberId] = {
    grantorMemberId: input.grantorMemberId,
    projectionKind: input.projectionKind,
    records,
    shareId: input.shareId,
    updatedAt: input.updatedAt,
  };
  store.projections[input.projectionKind] = projection;
  store.updatedAt = input.updatedAt;
}

function compareSharedVaultShareRecords(
  left: SharedVaultShareRecordEntry,
  right: SharedVaultShareRecordEntry,
): number {
  return (
    right.record.occurredAt.localeCompare(left.record.occurredAt)
    || right.record.recordKey.localeCompare(left.record.recordKey)
    || right.receivedEventId.localeCompare(left.receivedEventId)
  );
}

async function readSharedVaultShareProjectionStore(
  vaultRoot: string,
): Promise<SharedVaultShareProjectionsFile | null> {
  const path = resolveSharedVaultShareProjectionStorePath(vaultRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      return {
        projections: {},
        schema: SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA,
        updatedAt: "1970-01-01T00:00:00.000Z",
      };
    }
    return null;
  }

  try {
    return parseSharedVaultShareProjectionStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeSharedVaultShareProjectionStore(
  vaultRoot: string,
  store: SharedVaultShareProjectionsFile,
): Promise<void> {
  await writeJsonFileAtomic(
    resolveSharedVaultShareProjectionStorePath(vaultRoot),
    store,
  );
}

function resolveSharedVaultShareProjectionStorePath(vaultRoot: string): string {
  return join(vaultRoot, "derived", "vault-share", "projections.json");
}

async function removeLegacySharedVaultShareProjectionRecords(input: {
  vaultRoot: string;
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
  shareId: string;
}): Promise<void> {
  const directory = resolveLegacySharedVaultShareProjectionDirectory(input);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }

  let removedAny = false;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const path = join(directory, entry.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch {
      continue;
    }
    if (!legacySharedVaultShareRecordMatchesShareId(parsed, input.shareId)) {
      continue;
    }
    await rm(path, { force: true });
    removedAny = true;
  }

  if (!removedAny) {
    return;
  }
  try {
    await rmdir(directory);
  } catch (error) {
    if (!hasNodeErrorCode(error, "ENOENT") && !hasNodeErrorCode(error, "ENOTEMPTY")) {
      throw error;
    }
  }
}

function resolveLegacySharedVaultShareProjectionDirectory(input: {
  vaultRoot: string;
  grantorMemberId: string;
  projectionKind: HostedVaultShareProjectionKind;
}): string {
  return join(
    input.vaultRoot,
    "raw",
    "shared",
    input.projectionKind,
    input.grantorMemberId,
  );
}

function legacySharedVaultShareRecordMatchesShareId(
  value: unknown,
  shareId: string,
): boolean {
  return isPlainRecord(value) && value.shareId === shareId;
}

function parseSharedVaultShareProjectionStore(
  value: unknown,
): SharedVaultShareProjectionsFile | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  if (value.schema !== SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA) {
    return null;
  }
  if (typeof value.updatedAt !== "string") {
    return null;
  }
  if (!isPlainRecord(value.projections)) {
    return null;
  }

  const projections: Partial<Record<HostedVaultShareProjectionKind, SharedVaultShareProjectionEntry>> = {};
  for (const projectionKind of HOSTED_VAULT_SHARE_PROJECTION_KINDS) {
    const projectionValue = value.projections[projectionKind];
    if (projectionValue === undefined) {
      continue;
    }
    const projection = parseSharedVaultShareProjection(
      projectionValue,
      projectionKind,
    );
    if (!projection) {
      return null;
    }
    projections[projectionKind] = projection;
  }

  return {
    projections,
    schema: SHARED_VAULT_SHARE_PROJECTIONS_SCHEMA,
    updatedAt: value.updatedAt,
  };
}

function parseSharedVaultShareProjection(
  value: unknown,
  projectionKind: HostedVaultShareProjectionKind,
): SharedVaultShareProjectionEntry | null {
  if (!isPlainRecord(value) || !isPlainRecord(value.grantors)) {
    return null;
  }

  const grantors: Record<string, SharedVaultShareGrantorEntry> = {};
  for (const [grantorMemberId, grantorValue] of Object.entries(value.grantors)) {
    const grantor = parseSharedVaultShareGrantor(
      grantorValue,
      projectionKind,
    );
    if (!grantor || grantor.grantorMemberId !== grantorMemberId) {
      return null;
    }
    grantors[grantorMemberId] = grantor;
  }

  return { grantors };
}

function parseSharedVaultShareGrantor(
  value: unknown,
  projectionKind: HostedVaultShareProjectionKind,
): SharedVaultShareGrantorEntry | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  if (
    typeof value.grantorMemberId !== "string"
    || value.projectionKind !== projectionKind
    || typeof value.shareId !== "string"
    || typeof value.updatedAt !== "string"
    || !Array.isArray(value.records)
  ) {
    return null;
  }

  const records: SharedVaultShareRecordEntry[] = [];
  for (const record of value.records) {
    const parsed = parseSharedVaultShareRecordEntry(record, projectionKind);
    if (!parsed) {
      return null;
    }
    records.push(parsed);
  }

  return {
    grantorMemberId: value.grantorMemberId,
    projectionKind,
    records: records
      .sort(compareSharedVaultShareRecords)
      .slice(0, HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS),
    shareId: value.shareId,
    updatedAt: value.updatedAt,
  };
}

function parseSharedVaultShareRecordEntry(
  value: unknown,
  projectionKind: HostedVaultShareProjectionKind,
): SharedVaultShareRecordEntry | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  if (
    typeof value.receivedEventId !== "string"
    || value.schema !== HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA
    || typeof value.shareId !== "string"
  ) {
    return null;
  }

  try {
    return {
      receivedEventId: value.receivedEventId,
      record: parseHostedVaultShareDeliveryRecord(value.record, projectionKind),
      schema: HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
      shareId: value.shareId,
    };
  } catch {
    return null;
  }
}

function hasSafeVaultShareIdentifiers(input: {
  grantorMemberId: string;
  projectionKind: string;
  recordKey?: string;
  shareId: string;
}): boolean {
  try {
    normalizeOpaquePathSegment(input.projectionKind, "Vault-share projection kind");
    normalizeOpaquePathSegment(input.grantorMemberId, "Vault-share grantor member id");
    normalizeOpaquePathSegment(input.shareId, "Vault-share share id");
    if (input.recordKey !== undefined) {
      normalizeOpaquePathSegment(input.recordKey, "Vault-share record key");
    }
    return true;
  } catch {
    return false;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNodeErrorCode(
  error: unknown,
  code: string,
): error is { code: unknown } {
  return isPlainRecord(error) && error.code === code;
}
