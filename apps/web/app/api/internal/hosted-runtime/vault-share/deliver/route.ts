import {
  parseHostedVaultShareDeliverRequest,
  type HostedVaultShareDeliverResponse,
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
  deliverHostedVaultShareNights,
  findActiveHostedVaultShares,
} from "@/src/lib/hosted-mailbox/vault-share-store";
import {
  signalHostedMailboxAppendRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES = 16 * 1024;
const HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHT_AGE_DAYS = 60;
const HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHT_FUTURE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const NO_ACTIVE_SHARE_RESPONSE: HostedVaultShareDeliverResponse = {
  appendedCount: 0,
  duplicateCount: 0,
  status: "no-active-share",
};

/**
 * The single cross-member write seam. The grantor identity comes exclusively from the
 * signed Cloudflare callback; the grantor's runtime offers projected nights without
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
  requireDeliverableNightDates(body.nights.map((night) => night.date));

  const shares = await findActiveHostedVaultShares({
    grantorMemberId,
    projectionKind: body.projectionKind,
  });

  let appendedCount = 0;
  let duplicateCount = 0;
  let delivered = false;

  for (const share of shares) {
    const destination = await readHostedMemberCoreState({
      memberId: share.destinationMemberId,
      prisma: getPrisma(),
    });

    if (!destination || !hasHostedMemberActiveAccess(destination)) {
      continue;
    }

    const delivery = await deliverHostedVaultShareNights({
      nights: body.nights,
      share,
    });

    delivered = true;
    appendedCount += delivery.appendedDates.length;
    duplicateCount += delivery.duplicateDates.length;

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

  return jsonOk({
    appendedCount,
    duplicateCount,
    status: "delivered",
  } satisfies HostedVaultShareDeliverResponse);
});

/**
 * Bounds the mailbox dedupe-key space a grantor runtime can mint: offered nights must sit
 * inside a sane recency window. Honest runtimes only ever offer the latest few nights.
 */
function requireDeliverableNightDates(dates: readonly string[]): void {
  const nowMs = Date.now();

  for (const date of dates) {
    const dateMs = Date.parse(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(dateMs)
      || dateMs > nowMs + HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHT_FUTURE_DAYS * DAY_MS
      || dateMs < nowMs - HOSTED_VAULT_SHARE_DELIVER_MAX_NIGHT_AGE_DAYS * DAY_MS
    ) {
      throw new TypeError(
        "Vault share deliver request night dates must fall within the recent delivery window.",
      );
    }
  }
}
