import { rm } from "node:fs/promises";

import { normalizeOpaquePathSegment } from "@murphai/core";
import type {
  HostedExecutionVaultShareDeliveryWake,
  HostedExecutionVaultShareRevokeWake,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeGroupShareAuthorityEntry,
} from "@murphai/hosted-execution/runtime-control";
import {
  compareSharedVaultShareRecords,
  createEmptySharedVaultShareProjectionStore,
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DELIVER_MAX_RECORDS,
  HOSTED_VAULT_SHARE_DELIVERY_PAYLOAD_SCHEMA,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
  type SharedVaultShareGrantorEntry,
  type SharedVaultShareProjectionsFile,
  type SharedVaultShareRecordEntry,
} from "@murphai/hosted-execution/vault-share";
import {
  hasSharedVaultShareAuthorityUnavailableMarker,
  readSharedVaultShareProjectionStoreFile,
  resolveSharedVaultShareAuthorityUnavailableMarkerPath,
  resolveSharedVaultShareProjectionStorePath,
} from "@murphai/hosted-execution/vault-share-store-node";
import { writeJsonFileAtomic } from "@murphai/runtime-state/node";

import type { HostedMailboxItemImportOutcome } from "./mailbox-import.ts";
import type { HostedRuntimeGroupToolPort } from "./platform.ts";

export type HostedVaultShareModelViewOutcome =
  | { status: "empty" | "ready" }
  | {
      status: "unavailable";
      reasonCode:
        | "vault_share.authority_unavailable"
        | "vault_share.read_failed"
        | "vault_share.write_failed";
    };

const SHARED_VAULT_SHARE_AUTHORITY_UNAVAILABLE_MARKER_CONTENT = {
  notice:
    "Shared group data is temporarily unavailable because current sharing "
    + "authority could not be verified. Do not treat this as members having "
    + "shared nothing.",
  schema: "murph.shared-vault-authority-unavailable.v1",
} as const;

/**
 * Revalidates every already-landed projection against Web's current grant-row
 * generation before a shared-data read. Share authority is visibility authority
 * only, never model-admission authority. When it cannot be verified the store
 * keeps its last successfully verified content — the sanctioned
 * last-known-good authorized state — and a fixed marker makes shared-data
 * readers report "unavailable" and scheduled turns withhold standings while
 * the accepted turn still runs. Landed records are never discarded on a
 * transient failure (Web's mailbox dedupe cannot redeliver an unchanged
 * record). Deliveries and revokes keep importing through the one ordered
 * system lane during the outage — Web's atomic append is their
 * authorization, and blocking either would strand the other behind it —
 * so the marker gates readers, never mailbox progress, until a successful
 * authority read clears it. Callers invoke this owner lazily from paths that
 * actually consume shared group data; unrelated foreground turns only set
 * the local unavailable marker and pay no control-plane request.
 */
export async function prepareSharedVaultShareModelView(input: {
  readAuthority: () => Promise<readonly HostedRuntimeGroupShareAuthorityEntry[]>;
  vaultRoot: string;
}): Promise<HostedVaultShareModelViewOutcome> {
  const read = await readRepairableSharedVaultShareProjectionStoreFile(
    resolveSharedVaultShareProjectionStorePath(input.vaultRoot),
  );
  if (read.status !== "loaded") {
    await markSharedVaultShareAuthorityUnavailable(input.vaultRoot);
    return { status: "unavailable", reasonCode: "vault_share.read_failed" };
  }
  const store = read.store;
  if (Object.keys(store.projections).length === 0) {
    // The marker outlives an emptied store; only a successful authority read
    // may end the unavailable state and unblock queued deliveries.
    if (!(await hasSharedVaultShareAuthorityUnavailableMarker(input.vaultRoot))) {
      return { status: "empty" };
    }
    try {
      await input.readAuthority();
    } catch {
      return {
        status: "unavailable",
        reasonCode: "vault_share.authority_unavailable",
      };
    }
    await clearSharedVaultShareAuthorityUnavailableMarker(input.vaultRoot);
    return { status: "empty" };
  }

  let authority: readonly HostedRuntimeGroupShareAuthorityEntry[];
  try {
    authority = await input.readAuthority();
  } catch {
    await markSharedVaultShareAuthorityUnavailable(input.vaultRoot);
    return {
      status: "unavailable",
      reasonCode: "vault_share.authority_unavailable",
    };
  }
  const authorizedTriples = new Set(authority.map((entry) =>
    buildVaultShareAuthorityKey(entry.memberId, entry.projectionScopeKey, entry.shareId)
  ));
  for (const [projectionScopeKey, projection] of Object.entries(store.projections)) {
    for (const [grantorMemberId, grantor] of Object.entries(projection.grantors)) {
      const authorized = authorizedTriples.has(buildVaultShareAuthorityKey(
        grantorMemberId,
        projectionScopeKey,
        grantor.shareId,
      ));
      if (!authorized) {
        delete projection.grantors[grantorMemberId];
        continue;
      }

      const records = grantor.records.filter((record) =>
        record.shareId === grantor.shareId
      );
      if (records.length === 0) {
        delete projection.grantors[grantorMemberId];
      } else {
        grantor.records = records;
      }
    }
    if (Object.keys(projection.grantors).length === 0) {
      delete store.projections[projectionScopeKey];
    }
  }

  try {
    if (Object.keys(store.projections).length === 0) {
      await rm(resolveSharedVaultShareProjectionStorePath(input.vaultRoot), {
        force: true,
      });
      await clearSharedVaultShareAuthorityUnavailableMarker(input.vaultRoot);
      return { status: "empty" };
    }
    await writeSharedVaultShareProjectionStore(input.vaultRoot, store);
    await clearSharedVaultShareAuthorityUnavailableMarker(input.vaultRoot);
    return { status: "ready" };
  } catch {
    await markSharedVaultShareAuthorityUnavailable(input.vaultRoot);
    return { status: "unavailable", reasonCode: "vault_share.write_failed" };
  }
}

export async function markSharedVaultShareAuthorityUnavailableForPass(
  vaultRoot: string,
): Promise<void> {
  const read = await readSharedVaultShareProjectionStoreFile(
    resolveSharedVaultShareProjectionStorePath(vaultRoot),
  );
  if (read.status === "empty") {
    return;
  }
  await markSharedVaultShareAuthorityUnavailable(vaultRoot);
}

async function markSharedVaultShareAuthorityUnavailable(
  vaultRoot: string,
): Promise<void> {
  await writeJsonFileAtomic(
    resolveSharedVaultShareAuthorityUnavailableMarkerPath(vaultRoot),
    SHARED_VAULT_SHARE_AUTHORITY_UNAVAILABLE_MARKER_CONTENT,
  );
}

async function clearSharedVaultShareAuthorityUnavailableMarker(
  vaultRoot: string,
): Promise<void> {
  await rm(resolveSharedVaultShareAuthorityUnavailableMarkerPath(vaultRoot), {
    force: true,
  });
}

function buildVaultShareAuthorityKey(
  memberId: string,
  projectionScopeKey: string,
  shareId: string,
): string {
  return JSON.stringify([memberId, projectionScopeKey, shareId]);
}

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
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(
    delivery.projectionScope,
  );

  if (delivery.projectionKind === "group-email.v0") {
    return { status: "imported" };
  }

  // Defense in depth: every path segment below is parser-constrained upstream, but this
  // handler is the one that touches the filesystem, so it re-asserts identifier safety.
  if (!hasSafeVaultShareIdentifiers({
    grantorMemberId: delivery.grantorMemberId,
    projectionKind: delivery.projectionKind,
    projectionScopeKey,
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
    // Web's atomic grant check at append time authorizes this delivery, and
    // deliveries share one ordered system lane with revoke cleanup, so the
    // import must progress even while the authority marker is present: a
    // blocked delivery would strand every later revoke behind it.
    const storePath = resolveSharedVaultShareProjectionStorePath(input.vaultRoot);
    const read = await readRepairableSharedVaultShareProjectionStoreFile(storePath);
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
      projectionScope: delivery.projectionScope,
      projectionScopeKey,
      receivedEventId: input.wake.eventId,
      record: delivery.record,
      shareId: delivery.shareId,
      updatedAt: input.wake.occurredAt,
    });
    await writeJsonFileAtomic(storePath, read.store);
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
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(
    revoke.projectionScope,
  );

  if (!hasSafeVaultShareIdentifiers({
    grantorMemberId: revoke.grantorMemberId,
    projectionKind: revoke.projectionKind,
    projectionScopeKey,
    shareId: revoke.shareId,
  })) {
    return {
      reasonCode: "vault_share.unsafe_path_segment",
      retryable: false,
      status: "blocked",
    };
  }

  try {
    const storePath = resolveSharedVaultShareProjectionStorePath(input.vaultRoot);
    const read = await readRepairableSharedVaultShareProjectionStoreFile(storePath);
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
    const projection = store.projections[projectionScopeKey];
    const grantor = projection?.grantors[revoke.grantorMemberId];
    if (!projection || !grantor) {
      return { status: "imported" };
    }

    if (grantor.shareId !== revoke.shareId) {
      return { status: "imported" };
    }

    delete projection.grantors[revoke.grantorMemberId];
    if (Object.keys(projection.grantors).length === 0) {
      delete store.projections[projectionScopeKey];
    }
    store.updatedAt = revoke.revokedAt;

    if (Object.keys(store.projections).length === 0) {
      await rm(storePath, { force: true });
    } else {
      await writeJsonFileAtomic(storePath, store);
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
    projectionScope: HostedVaultShareProjectionScope;
    projectionScopeKey: string;
    receivedEventId: string;
    record: HostedVaultShareDeliveryRecord;
    shareId: string;
    updatedAt: string;
  },
): void {
  const projection = store.projections[input.projectionScopeKey] ?? {
    grantors: {},
    projectionScope: input.projectionScope,
    projectionScopeKey: input.projectionScopeKey,
  };
  const existingGrantor = projection.grantors[input.grantorMemberId];
  const grantor: SharedVaultShareGrantorEntry = existingGrantor?.shareId === input.shareId
    ? existingGrantor
    : {
        grantorMemberId: input.grantorMemberId,
        projectionKind: input.projectionKind,
        projectionScope: input.projectionScope,
        projectionScopeKey: input.projectionScopeKey,
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
    projectionScope: input.projectionScope,
    projectionScopeKey: input.projectionScopeKey,
    records,
    shareId: input.shareId,
    updatedAt: input.updatedAt,
  };
  store.projections[input.projectionScopeKey] = {
    ...projection,
    projectionScope: input.projectionScope,
    projectionScopeKey: input.projectionScopeKey,
  };
  store.updatedAt = input.updatedAt;
}

async function readRepairableSharedVaultShareProjectionStoreFile(
  storePath: string,
): Promise<
  | { status: "loaded"; store: SharedVaultShareProjectionsFile }
  | { status: "read_failed" }
  | { status: "repair_failed" }
> {
  const read = await readSharedVaultShareProjectionStoreFile(storePath);
  if (read.status === "empty") {
    return {
      status: "loaded",
      store: createEmptySharedVaultShareProjectionStore(),
    };
  }
  if (read.status !== "corrupt") {
    return read;
  }

  try {
    await rm(storePath, { force: true });
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

function hasSafeVaultShareIdentifiers(input: {
  grantorMemberId: string;
  projectionKind: string;
  projectionScopeKey: string;
  recordKey?: string;
  shareId: string;
}): boolean {
  try {
    normalizeOpaquePathSegment(input.projectionKind, "Vault-share projection kind");
    normalizeOpaquePathSegment(input.projectionScopeKey, "Vault-share projection scope key");
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
