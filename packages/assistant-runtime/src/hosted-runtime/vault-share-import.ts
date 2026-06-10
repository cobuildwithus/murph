import { join } from "node:path";

import { normalizeOpaquePathSegment } from "@murphai/core";
import type {
  HostedExecutionVaultShareDeliveryWake,
} from "@murphai/hosted-execution/contracts";
import { writeJsonFileAtomic } from "@murphai/runtime-state/node";

import type { HostedMailboxItemImportOutcome } from "./mailbox-import.ts";

/**
 * Destination-side landing for consented vault-share deliveries: a deterministic,
 * idempotent write of the shared record into the destination workspace vault under
 * `raw/shared/<projectionKind>/<grantorMemberId>/<recordKey>.json`. The record becomes ordinary
 * durable vault content (checkpointed with the workspace, searchable by the assistant);
 * promotion into richer canonical entities is a future consumer of these files, not a
 * change to this seam.
 */
export async function importHostedVaultShareDeliveryWake(input: {
  vaultRoot: string;
  wake: HostedExecutionVaultShareDeliveryWake;
}): Promise<HostedMailboxItemImportOutcome> {
  const delivery = input.wake.delivery;

  // Defense in depth: every path segment below is parser-constrained upstream, but this
  // handler is the one that touches the filesystem, so it re-asserts segment safety.
  let projectionKindSegment: string;
  let grantorMemberIdSegment: string;
  let recordKeySegment: string;
  try {
    projectionKindSegment = normalizeOpaquePathSegment(
      delivery.projectionKind,
      "Vault-share projection kind",
    );
    grantorMemberIdSegment = normalizeOpaquePathSegment(
      delivery.grantorMemberId,
      "Vault-share grantor member id",
    );
    recordKeySegment = normalizeOpaquePathSegment(
      delivery.record.recordKey,
      "Vault-share record key",
    );
  } catch {
    return {
      reasonCode: "vault_share.unsafe_path_segment",
      retryable: false,
      status: "blocked",
    };
  }

  const targetPath = join(
    input.vaultRoot,
    "raw",
    "shared",
    projectionKindSegment,
    grantorMemberIdSegment,
    `${recordKeySegment}.json`,
  );

  try {
    await writeJsonFileAtomic(targetPath, {
      grantorMemberId: delivery.grantorMemberId,
      projectionKind: delivery.projectionKind,
      receivedEventId: input.wake.eventId,
      record: delivery.record,
      schema: delivery.schema,
      shareId: delivery.shareId,
    });
  } catch {
    // Quarantine instead of retrying: a persistent fs failure must not head-of-line
    // block the destination's system lane forever, and records are re-offered on
    // later wakes anyway.
    return {
      reasonCode: "vault_share.write_failed",
      retryable: false,
      status: "blocked",
    };
  }

  return { status: "imported" };
}
