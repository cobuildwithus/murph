import {
  parseHostedVaultShareDeliverRequest,
  type HostedVaultShareDeliverResponse,
  type HostedVaultShareDeliveryRecord,
} from "@murphai/hosted-execution/vault-share";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hasHostedMemberActiveAccess,
} from "@/src/lib/hosted-onboarding/entitlement";
import {
  readHostedMemberCoreState,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  deliverHostedVaultShareRecords,
  findActiveHostedVaultShares,
} from "@/src/lib/hosted-mailbox/vault-share-store";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES = 16 * 1024;
const HOSTED_VAULT_SHARE_DELIVER_MAX_RECORD_AGE_DAYS = 60;
const HOSTED_VAULT_SHARE_DELIVER_MAX_RECORD_FUTURE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const NO_ACTIVE_SHARE_RESPONSE: HostedVaultShareDeliverResponse = {
  appendedCount: 0,
  duplicateCount: 0,
  status: "no-active-share",
};

/**
 * The single cross-member write seam. The grantor identity comes exclusively from the
 * signed Cloudflare callback; the grantor's runtime offers projected records without
 * knowing whether shares exist. Web is the sole authority: it fans the offer out to every
 * active HostedVaultShare for (grantor, projectionKind), skipping inactive destinations.
 * No grants — or only inactive destinations — resolves to `no-active-share` with nothing
 * appended, so the grantor runtime learns nothing about share configuration.
 */
export const POST = withJsonError(async (request: Request) => {
  const grantorMemberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
  });
  const body = parseHostedVaultShareDeliverRequest(await readOptionalJsonObject(request));
  const records = filterDeliverableRecords(body.records);

  const shares = await findActiveHostedVaultShares({
    grantorMemberId,
    projectionKind: body.projectionKind,
  });

  if (shares.length === 0) {
    return jsonOk(NO_ACTIVE_SHARE_RESPONSE);
  }

  let appendedCount = 0;
  let duplicateCount = 0;

  // An all-stale offer skips delivery entirely but still resolves as delivered with zero
  // counts: stale records must never produce a permanent error loop for the grantor runtime.
  if (records.length > 0) {
    let delivered = false;

    for (const share of shares) {
      const destination = await readHostedMemberCoreState({
        memberId: share.destinationMemberId,
        prisma: getPrisma(),
      });

      if (!destination || !hasHostedMemberActiveAccess(destination)) {
        continue;
      }

      const delivery = await deliverHostedVaultShareRecords({
        records,
        share,
      });

      delivered = true;
      appendedCount += delivery.appendedRecordKeys.length;
      duplicateCount += delivery.duplicateRecordKeys.length;

      if (delivery.lastAppendedMailboxItemId !== null) {
        try {
          await signalHostedMailboxAppendRuntime({
            expectedUserId: share.destinationMemberId,
            mailboxItemId: delivery.lastAppendedMailboxItemId,
          });
        } catch {
          // Durable append succeeded; the destination imports on its next wake. Matches the
          // repo invariant that Temporal signal failures after durable append are not retried.
        }
      }
    }

    if (!delivered) {
      return jsonOk(NO_ACTIVE_SHARE_RESPONSE);
    }
  }

  return jsonOk({
    appendedCount,
    duplicateCount,
    status: "delivered",
  } satisfies HostedVaultShareDeliverResponse);
});

/**
 * Bounds the mailbox dedupe-key space a grantor runtime can mint: only records inside a
 * sane recency window are delivered. Out-of-window records are silently dropped rather than
 * rejected so one stale record never poisons delivery of the fresh ones. Honest runtimes
 * only ever offer the latest few records.
 */
function filterDeliverableRecords(
  records: readonly HostedVaultShareDeliveryRecord[],
): HostedVaultShareDeliveryRecord[] {
  const nowMs = Date.now();

  return records.filter((record) => {
    const occurredAtMs = Date.parse(record.occurredAt);

    return !Number.isNaN(occurredAtMs)
      && occurredAtMs <= nowMs + HOSTED_VAULT_SHARE_DELIVER_MAX_RECORD_FUTURE_DAYS * DAY_MS
      && occurredAtMs >= nowMs - HOSTED_VAULT_SHARE_DELIVER_MAX_RECORD_AGE_DAYS * DAY_MS;
  });
}
