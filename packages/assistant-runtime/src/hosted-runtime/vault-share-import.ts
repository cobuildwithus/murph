import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  HostedExecutionVaultShareDeliveryWake,
} from "@murphai/hosted-execution/contracts";

import type { HostedMailboxItemImportOutcome } from "./mailbox-import.ts";

/**
 * Destination-side landing for consented vault-share deliveries: a deterministic,
 * idempotent write of the shared record into the destination workspace vault under
 * `raw/shared/<projectionKind>/<grantorMemberId>/<date>.json`. The record becomes ordinary
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
  if (
    !isSafeVaultPathSegment(delivery.grantorMemberId)
    || !isSafeVaultPathSegment(delivery.projectionKind)
    || !isSafeVaultPathSegment(delivery.night.date)
  ) {
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
    delivery.projectionKind,
    delivery.grantorMemberId,
    `${delivery.night.date}.json`,
  );

  try {
    await mkdir(dirname(targetPath), { recursive: true });
    const serialized = `${JSON.stringify(
      {
        grantorMemberId: delivery.grantorMemberId,
        night: delivery.night,
        projectionKind: delivery.projectionKind,
        receivedEventId: input.wake.eventId,
        schema: delivery.schema,
        shareId: delivery.shareId,
      },
      null,
      2,
    )}\n`;
    const stagingPath = `${targetPath}.tmp-${input.wake.eventId.replaceAll("/", "_")}`;
    await writeFile(stagingPath, serialized, "utf8");
    await rename(stagingPath, targetPath);
  } catch {
    return {
      reasonCode: "vault_share.write_failed",
      retryable: true,
      status: "blocked",
    };
  }

  return { status: "imported" };
}

function isSafeVaultPathSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(value) && !value.includes("..");
}
