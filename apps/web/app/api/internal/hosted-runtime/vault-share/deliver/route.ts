import {
  parseHostedVaultShareDeliverRequest,
  type HostedVaultShareDeliverResponse,
  type HostedVaultShareDeliveryRecord,
} from "@murphai/hosted-execution/vault-share";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "@/src/lib/hosted-execution/logging";
import {
  hasHostedMemberEffectiveActiveAccessForMember,
} from "@/src/lib/hosted-onboarding/family-plan";
import {
  isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedMemberCoreState,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  deliverHostedVaultShareRecords,
  findActiveHostedVaultShares,
  type ActiveHostedVaultShare,
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
  status: "no-active-share",
};

const DELIVERED_RESPONSE: HostedVaultShareDeliverResponse = {
  status: "delivered",
};

/**
 * The single cross-member write seam. The grantor identity comes exclusively from the
 * signed Cloudflare callback; the grantor's runtime offers projected records without
 * knowing whether shares exist. Web is the sole authority: it fans the offer out to every
 * active HostedVaultShare for (grantor, projectionKind), skipping inactive destinations.
 * The response is a function of share configuration alone — no grants, or only inactive
 * destinations, resolves to `no-active-share`; everything else resolves to a bare
 * `delivered`, so the grantor runtime learns nothing beyond "an active share exists".
 */
export const POST = withJsonError(async (request: Request) => {
  const grantorMemberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
  });
  const body = parseHostedVaultShareDeliverRequest(await readOptionalJsonObject(request));
  const prisma = getPrisma();

  if (!await hasDeliverableHostedRuntimeActiveAccess(grantorMemberId, prisma)) {
    return jsonOk(NO_ACTIVE_SHARE_RESPONSE);
  }

  const shares = await findActiveHostedVaultShares({
    grantorMemberId,
    projectionKind: body.projectionKind,
  });
  const activeShares: ActiveHostedVaultShare[] = [];
  let deliveryFailed = false;

  for (const share of shares) {
    try {
      const destination = await readHostedMemberCoreState({
        memberId: share.destinationMemberId,
        prisma,
      });

      if (
        destination
        && await hasHostedMemberEffectiveActiveAccessForMember({
          member: destination,
          prisma,
        })
        && await hasDeliverableHostedRuntimeActiveAccess(share.destinationMemberId, prisma)
      ) {
        activeShares.push(share);
      }
    } catch (error) {
      deliveryFailed = true;
      console.error("Hosted vault-share destination share eligibility check failed.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_VAULT_SHARE_DESTINATION_ELIGIBILITY_FAILED",
        }),
      });
    }
  }

  if (activeShares.length === 0) {
    if (deliveryFailed) {
      throw createHostedVaultShareDeliveryFailedError();
    }
    return jsonOk(NO_ACTIVE_SHARE_RESPONSE);
  }

  // An all-stale offer appends nothing but still resolves `delivered`: the status reflects
  // share configuration only, so record staleness can never probe finer-grained share
  // state, and stale records never put the grantor runtime in a permanent error loop.
  const records = filterDeliverableRecords(body.records);

  if (records.length === 0) {
    return jsonOk(DELIVERED_RESPONSE);
  }

  for (const share of activeShares) {
    try {
      const delivery = await deliverHostedVaultShareRecords({
        records,
        share,
      });

      if (delivery.lastAppendedMailboxItemId !== null) {
        try {
          await signalHostedMailboxAppendRuntime({
            expectedUserId: share.destinationMemberId,
            mailboxItemId: delivery.lastAppendedMailboxItemId,
          });
        } catch {
          // The append is already durable; the destination imports on its next wake.
          // Matches the repo invariant that signal failures after a durable append are
          // not retried — and must not be logged as a delivery failure.
        }
      }
    } catch (error) {
      deliveryFailed = true;
      // Best-effort per destination: one failing share must not block delivery to the
      // others, and the retry re-offers (already-appended records dedupe). Log only
      // redacted error details — never payload fields, timestamps, or raw share ids.
      console.error("Hosted vault-share delivery to a destination share failed.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_VAULT_SHARE_DESTINATION_DELIVERY_FAILED",
        }),
      });
    }
  }

  if (deliveryFailed) {
    throw createHostedVaultShareDeliveryFailedError();
  }

  return jsonOk(DELIVERED_RESPONSE);
});

async function hasDeliverableHostedRuntimeActiveAccess(
  memberId: string,
  prisma: ReturnType<typeof getPrisma>,
): Promise<boolean> {
  try {
    await requireHostedRuntimeActiveAccess(memberId, {
      prisma,
    });
    return true;
  } catch (error) {
    if (isHostedRuntimeInactiveAccessError(error)) {
      return false;
    }
    throw error;
  }
}

function createHostedVaultShareDeliveryFailedError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_VAULT_SHARE_DELIVERY_FAILED",
    httpStatus: 503,
    message: "Hosted vault-share delivery failed. Retry the request.",
    retryable: true,
  });
}

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
