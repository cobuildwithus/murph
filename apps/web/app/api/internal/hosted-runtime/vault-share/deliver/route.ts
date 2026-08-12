import {
  isHostedVaultShareCurrentStateProjectionKind,
  HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
  HOSTED_VAULT_SHARE_DELIVERY_FAILED_ERROR_CODE,
  HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
  HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
  parseHostedVaultShareDeliverRequest,
  parseHostedVaultShareEffectDeadlineAtEpochMs,
  type HostedVaultShareDeliverResponse,
  type HostedVaultShareDeliveryRecord,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "@/src/lib/hosted-execution/logging";
import {
  isHostedDomainRootEnvelopeUnavailableError,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
} from "@/src/lib/hosted-vault-share/delivery-limits";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  findActiveHostedVaultShares,
  buildHostedVaultShareGenerationToken,
  hasUnmaterializedHostedVaultShareProjectionGeneration,
  replaceHostedVaultShareProjectionSnapshot,
} from "@/src/lib/hosted-vault-share/projection-store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

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
 * signed Cloudflare callback. The grantor runtime first asks web for active projection
 * kinds, then this write seam revalidates the requested kind before fanout. Web remains
 * the sole authority: each replacement transaction validates both members' access and
 * conditionally updates the exact active HostedVaultShare generation. The response is a
 * function of share configuration alone. A missing current grant resolves to
 * `no-active-share`; a temporarily inactive or changed generation with unmaterialized
 * approved work returns a generic retryable error so the durable runtime obligation is
 * retained without revealing a destination or fan-out count.
 */
export const POST = withJsonError(async (request: Request) => {
  const grantorMemberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
  });
  const effectDeadlineAtEpochMs = Math.min(
    parseHostedVaultShareEffectDeadlineAtEpochMs(
      request.headers.get(HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER),
    ),
    Date.now() + HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
  );
  const effectTimeoutSignal = AbortSignal.timeout(
    Math.max(0, effectDeadlineAtEpochMs - Date.now()),
  );
  const effectSignal = AbortSignal.any([request.signal, effectTimeoutSignal]);
  const rawBody = await readOptionalJsonObject(request);
  if (rawBody.expectedGenerationToken === undefined) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SHARE_GENERATION_PROOF_REQUIRED",
      httpStatus: 503,
      message: "Hosted vault-share delivery requires current generation proof. Retry the request.",
      retryable: true,
    });
  }
  const body = parseHostedVaultShareDeliverRequest(rawBody);

  const shares = await findActiveHostedVaultShares({
    grantorMemberId,
    ...(body.projectionMode ? { projectionMode: body.projectionMode } : {}),
    projectionScope: body.projectionScope,
  });
  if (shares.length === 0) {
    if (await hasUnmaterializedHostedVaultShareProjectionGeneration({
      grantorMemberId,
      projectionScope: body.projectionScope,
    })) {
      throw createHostedVaultShareDeliveryDeferredError();
    }
    return jsonOk(NO_ACTIVE_SHARE_RESPONSE);
  }
  if (
    body.expectedGenerationToken
      !== buildHostedVaultShareGenerationToken(shares.map((share) => share.id))
  ) {
    if (await hasUnmaterializedHostedVaultShareProjectionGeneration({
      grantorMemberId,
      projectionScope: body.projectionScope,
    })) {
      throw createHostedVaultShareDeliveryDeferredError();
    }
    return jsonOk(NO_ACTIVE_SHARE_RESPONSE);
  }

  // An all-stale offer replaces the prior snapshot with an encrypted empty snapshot. The
  // response still reflects share configuration only, so staleness cannot probe finer-
  // grained share state or leave old records visible after an empty refresh.
  const records = filterDeliverableRecords(body.records, body.projectionKind);
  let delivered = false;
  let deliveryFailed = false;
  let scopeFailed = false;
  let deliveryDeferred = false;

  for (const share of shares) {
    if (effectSignal.aborted || Date.now() >= effectDeadlineAtEpochMs) {
      deliveryFailed = true;
      break;
    }
    try {
      const outcome = await replaceHostedVaultShareProjectionSnapshot({
        deadlineAtEpochMs: effectDeadlineAtEpochMs,
        ...(body.projectionMode ? { projectionMode: body.projectionMode } : {}),
        records,
        share,
        signal: effectSignal,
        sourceWorkspaceVersion: body.sourceWorkspaceVersion,
      });
      delivered ||= outcome === "replaced";
      deliveryDeferred ||= outcome === "no-active-share";
    } catch (error) {
      if (effectSignal.aborted || Date.now() >= effectDeadlineAtEpochMs) {
        deliveryFailed = true;
        break;
      }
      if (isHostedDomainRootEnvelopeUnavailableError(error)) {
        scopeFailed = true;
      } else {
        deliveryFailed = true;
      }
      // Best-effort per destination: one failing share must not block replacement for
      // the others when its member-specific root is absent. Unknown crypto, access,
      // database, and transaction failures stop fanout because they may be systemic.
      // Log only redacted error details — never payload fields, timestamps, or raw ids.
      console.error("Hosted vault-share delivery to a destination share failed.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_VAULT_SHARE_DESTINATION_DELIVERY_FAILED",
        }),
      });
      if (deliveryFailed) {
        break;
      }
    }
  }

  if (deliveryFailed) {
    throw createHostedVaultShareDeliveryError(
      HOSTED_VAULT_SHARE_DELIVERY_FAILED_ERROR_CODE,
    );
  }
  if (scopeFailed) {
    throw createHostedVaultShareDeliveryError(
      HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
    );
  }
  if (deliveryDeferred) {
    throw createHostedVaultShareDeliveryDeferredError();
  }

  return jsonOk(delivered ? DELIVERED_RESPONSE : NO_ACTIVE_SHARE_RESPONSE);
});

function createHostedVaultShareDeliveryError(
  code:
    | typeof HOSTED_VAULT_SHARE_DELIVERY_FAILED_ERROR_CODE
    | typeof HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
): Error {
  return hostedOnboardingError({
    code,
    httpStatus: 503,
    message: "Hosted vault-share delivery failed. Retry the request.",
    retryable: true,
  });
}

function createHostedVaultShareDeliveryDeferredError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_VAULT_SHARE_DELIVERY_DEFERRED",
    httpStatus: 503,
    message: "Hosted vault-share delivery has deferred approved work. Retry the request.",
    retryable: true,
  });
}

/**
 * Bounds each replacement snapshot to records inside a sane recency window. Out-of-window
 * records are silently dropped rather than rejected so one stale record never poisons
 * delivery of the fresh ones. Honest runtimes only ever offer the latest few records.
 *
 * The age bound applies only to time-series kinds whose recordKey space grows with time.
 * Current-state kinds have one parser-enforced fixed recordKey and a content-only delivery
 * revision (see isHostedVaultShareCurrentStateProjectionKind), so occurredAt neither mints
 * dedupe keys nor needs a recency bound — a name set long ago is still the current name at
 * a member's first group join.
 */
function filterDeliverableRecords(
  records: readonly HostedVaultShareDeliveryRecord[],
  projectionKind: HostedVaultShareProjectionScope["projectionKind"],
): HostedVaultShareDeliveryRecord[] {
  const nowMs = Date.now();
  const minOccurredAtMs = isHostedVaultShareCurrentStateProjectionKind(projectionKind)
    ? Number.NEGATIVE_INFINITY
    : nowMs - HOSTED_VAULT_SHARE_DELIVER_MAX_RECORD_AGE_DAYS * DAY_MS;

  return records.filter((record) => {
    const occurredAtMs = Date.parse(record.occurredAt);

    return !Number.isNaN(occurredAtMs)
      && occurredAtMs <= nowMs + HOSTED_VAULT_SHARE_DELIVER_MAX_RECORD_FUTURE_DAYS * DAY_MS
      && occurredAtMs >= minOccurredAtMs;
  });
}
