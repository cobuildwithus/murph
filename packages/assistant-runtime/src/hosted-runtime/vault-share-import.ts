import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { normalizeOpaquePathSegment } from "@murphai/core";
import type {
  HostedExecutionVaultShareDeliveryWake,
  HostedExecutionVaultShareRevokeWake,
} from "@murphai/hosted-execution/contracts";
import {
  compareSharedVaultShareRecords,
  createEmptySharedVaultShareProjectionStore,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  parseSharedVaultShareProjectionStore,
  SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
  type SharedVaultShareGrantorEntry,
  type SharedVaultShareProjectionsFile,
  type SharedVaultShareRecordEntry,
} from "@murphai/hosted-execution/vault-share";
import { writeJsonFileAtomic } from "@murphai/runtime-state/node";

import type { HostedMailboxItemImportOutcome } from "./mailbox-import.ts";

type SharedVaultShareProjectionStoreReadResult =
  | {
      status: "loaded";
      store: SharedVaultShareProjectionsFile;
    }
  | {
      status: "corrupt";
    }
  | {
      status: "read_failed";
    };

/**
 * Destination-side landing for consented vault-share deliveries: a deterministic,
 * idempotent upsert of the shared record into one compact derived destination
 * workspace file. The file is bounded by projection kind, grantor, and the delivery
 * record cap, so repeated deliveries cannot grow the vault file tree. The store shape
 * and its parser are owned by `@murphai/hosted-execution/vault-share` so this writer and
 * the `vault-cli group shared` reader can never drift; promotion into richer canonical
 * entities remains a future consumer of this file, not a change to this boundary.
 */
export async function importHostedVaultShareDeliveryWake(input: {
  vaultRoot: string;
  wake: HostedExecutionVaultShareDeliveryWake;
}): Promise<HostedMailboxItemImportOutcome> {
  const delivery = input.wake.delivery;

  if (delivery.projectionKind === "group-email.v0") {
    return { status: "imported" };
  }

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
    const read = await readRepairableSharedVaultShareProjectionStore(input.vaultRoot);
    if (read.status === "read_failed") {
      return {
        reasonCode: "vault_share.read_failed",
        retryable: true,
        status: "blocked",
      };
    }
    if (read.status === "repair_failed") {
      return {
        reasonCode: "vault_share.write_failed",
        retryable: true,
        status: "blocked",
      };
    }

    upsertSharedVaultShareRecord(read.store, {
      grantorMemberId: delivery.grantorMemberId,
      projectionKind: delivery.projectionKind,
      receivedEventId: input.wake.eventId,
      record: delivery.record,
      shareId: delivery.shareId,
      updatedAt: input.wake.occurredAt,
    });
    await writeSharedVaultShareProjectionStore(input.vaultRoot, read.store);
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
    const read = await readRepairableSharedVaultShareProjectionStore(input.vaultRoot);
    if (read.status === "read_failed") {
      return {
        reasonCode: "vault_share.read_failed",
        retryable: true,
        status: "blocked",
      };
    }
    if (read.status === "repair_failed") {
      return {
        reasonCode: "vault_share.write_failed",
        retryable: true,
        status: "blocked",
      };
    }

    const store = read.store;
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
  const grantor: SharedVaultShareGrantorEntry = existingGrantor?.shareId === input.shareId
    ? existingGrantor
    : {
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

async function readSharedVaultShareProjectionStore(
  vaultRoot: string,
): Promise<SharedVaultShareProjectionStoreReadResult> {
  const path = resolveSharedVaultShareProjectionStorePath(vaultRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      return {
        status: "loaded",
        store: createEmptySharedVaultShareProjectionStore(),
      };
    }
    return { status: "read_failed" };
  }

  try {
    const store = parseSharedVaultShareProjectionStore(JSON.parse(raw));
    return store ? { status: "loaded", store } : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}

async function readRepairableSharedVaultShareProjectionStore(
  vaultRoot: string,
): Promise<
  | { status: "loaded"; store: SharedVaultShareProjectionsFile }
  | { status: "read_failed" }
  | { status: "repair_failed" }
> {
  const read = await readSharedVaultShareProjectionStore(vaultRoot);
  if (read.status !== "corrupt") {
    return read;
  }

  try {
    await rm(resolveSharedVaultShareProjectionStorePath(vaultRoot), {
      force: true,
    });
  } catch {
    return { status: "repair_failed" };
  }

  return {
    status: "loaded",
    store: createEmptySharedVaultShareProjectionStore(),
  };
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
  return join(vaultRoot, SHARED_VAULT_SHARE_PROJECTIONS_RELATIVE_PATH);
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

function hasNodeErrorCode(
  error: unknown,
  code: string,
): error is { code: unknown } {
  return (
    typeof error === "object"
    && error !== null
    && (error as { code?: unknown }).code === code
  );
}
