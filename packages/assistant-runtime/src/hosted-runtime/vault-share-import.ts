import { lstat, rm } from "node:fs/promises";
import path from "node:path";

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
  readSharedVaultShareProjectionStoreFile,
  resolveSharedVaultShareAuthorityUnavailableMarkerPath,
  resolveSharedVaultShareProjectionStorePath,
} from "@murphai/hosted-execution/vault-share-store-node";
import { writeJsonFileAtomic } from "@murphai/runtime-state/node";
import { resolveAssistantStatePaths } from "@murphai/runtime-state/node/assistant-state-fs";

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
 * generation and materializes the model-visible view accordingly. Share
 * authority is visibility authority only, never model-admission authority:
 * when it cannot be verified the landed records are withheld from the vault
 * view (durably retained under the runtime-private assistant state root) and
 * the accepted turn proceeds without shared data. A later successful snapshot
 * restores the retained, still-authorized records without redelivery. The
 * authority callback runs only after a non-empty local store is known to
 * exist, so ordinary personal runtimes pay no control-plane request.
 */
export async function prepareSharedVaultShareModelView(input: {
  readAuthority: () => Promise<readonly HostedRuntimeGroupShareAuthorityEntry[]>;
  vaultRoot: string;
}): Promise<HostedVaultShareModelViewOutcome> {
  const combined = await readCombinedSharedVaultShareStores(input.vaultRoot);
  if (combined.status === "blocked") {
    await withholdSharedVaultShareModelView(input.vaultRoot, null);
    return { status: "unavailable", reasonCode: combined.reasonCode };
  }
  if (combined.status === "empty") {
    await clearSharedVaultShareWithheldState(input.vaultRoot);
    return { status: "empty" };
  }

  const store = combined.store;
  let authority: readonly HostedRuntimeGroupShareAuthorityEntry[];
  try {
    authority = await input.readAuthority();
  } catch {
    await withholdSharedVaultShareModelView(input.vaultRoot, store);
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
      await clearSharedVaultShareWithheldState(input.vaultRoot);
      return { status: "empty" };
    }
    await writeSharedVaultShareProjectionStore(input.vaultRoot, store);
    await clearSharedVaultShareWithheldState(input.vaultRoot);
    return { status: "ready" };
  } catch {
    await withholdSharedVaultShareModelView(input.vaultRoot, store);
    return { status: "unavailable", reasonCode: "vault_share.write_failed" };
  }
}

/**
 * Hides the landed store from the model view without deleting landed data.
 * The durable copy moves under the runtime-private assistant state root and a
 * fixed marker replaces it so shared-data readers report "unavailable". The
 * final vault-path removal is the one operation that must succeed: if the
 * runtime can neither verify nor hide the landed records it fails the pass
 * closed rather than exposing unverified shared data.
 */
async function withholdSharedVaultShareModelView(
  vaultRoot: string,
  store: SharedVaultShareProjectionsFile | null,
): Promise<void> {
  if (store && Object.keys(store.projections).length > 0) {
    await writeJsonFileAtomic(
      resolveWithheldSharedVaultShareProjectionStorePath(vaultRoot),
      store,
    );
  }
  await writeJsonFileAtomic(
    resolveSharedVaultShareAuthorityUnavailableMarkerPath(vaultRoot),
    SHARED_VAULT_SHARE_AUTHORITY_UNAVAILABLE_MARKER_CONTENT,
  );
  await rm(resolveSharedVaultShareProjectionStorePath(vaultRoot), {
    force: true,
  });
}

async function clearSharedVaultShareWithheldState(vaultRoot: string): Promise<void> {
  await rm(resolveWithheldSharedVaultShareProjectionStorePath(vaultRoot), {
    force: true,
  });
  await rm(resolveSharedVaultShareAuthorityUnavailableMarkerPath(vaultRoot), {
    force: true,
  });
}

export function resolveWithheldSharedVaultShareProjectionStorePath(
  vaultRoot: string,
): string {
  return path.join(
    resolveAssistantStatePaths(vaultRoot).stateDirectory,
    "vault-share-withheld.json",
  );
}

type CombinedSharedVaultShareStoresReadResult =
  | { status: "loaded"; store: SharedVaultShareProjectionsFile }
  | { status: "empty" }
  | { status: "blocked"; reasonCode: "vault_share.read_failed" };

/**
 * Reads the model-visible store and any withheld durable copy as one logical
 * store. At most one of the two normally exists; a crash between the withhold
 * and restore transitions can briefly leave both, so grantor entries merge
 * with the vault copy winning collisions.
 */
async function readCombinedSharedVaultShareStores(
  vaultRoot: string,
): Promise<CombinedSharedVaultShareStoresReadResult> {
  const vaultRead = await readRepairableSharedVaultShareProjectionStoreFile(
    resolveSharedVaultShareProjectionStorePath(vaultRoot),
  );
  const withheldRead = await readRepairableSharedVaultShareProjectionStoreFile(
    resolveWithheldSharedVaultShareProjectionStorePath(vaultRoot),
  );
  if (vaultRead.status !== "loaded" || withheldRead.status !== "loaded") {
    return { status: "blocked", reasonCode: "vault_share.read_failed" };
  }

  const merged = withheldRead.store;
  for (const [projectionScopeKey, projection] of Object.entries(vaultRead.store.projections)) {
    const target = merged.projections[projectionScopeKey] ?? {
      grantors: {},
      projectionScope: projection.projectionScope,
      projectionScopeKey,
    };
    for (const [grantorMemberId, grantor] of Object.entries(projection.grantors)) {
      target.grantors[grantorMemberId] = grantor;
    }
    merged.projections[projectionScopeKey] = target;
  }
  if (vaultRead.store.updatedAt > merged.updatedAt) {
    merged.updatedAt = vaultRead.store.updatedAt;
  }
  return Object.keys(merged.projections).length === 0
    ? { status: "empty" }
    : { status: "loaded", store: merged };
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
    const storePath = await resolveActiveSharedVaultShareStorePath(input.vaultRoot);
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
    const storePath = await resolveActiveSharedVaultShareStorePath(input.vaultRoot);
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

/**
 * Imports and revokes land in whichever durable copy currently owns the
 * records: the model-visible vault store normally, or the withheld
 * runtime-private copy while share authority is unverified so records landed
 * during an outage stay invisible until the next successful snapshot.
 */
async function resolveActiveSharedVaultShareStorePath(
  vaultRoot: string,
): Promise<string> {
  const withheldPath = resolveWithheldSharedVaultShareProjectionStorePath(vaultRoot);
  if (
    await hostedVaultSharePathExists(withheldPath)
    || await hostedVaultSharePathExists(
      resolveSharedVaultShareAuthorityUnavailableMarkerPath(vaultRoot),
    )
  ) {
    return withheldPath;
  }
  return resolveSharedVaultShareProjectionStorePath(vaultRoot);
}

async function hostedVaultSharePathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
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
