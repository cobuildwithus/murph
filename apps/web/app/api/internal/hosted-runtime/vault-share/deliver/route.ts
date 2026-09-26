import {
  HOSTED_RUNTIME_VAULT_SHARE_DELIVER_CONTINUATION_FIELD,
} from "@murphai/hosted-execution/routes";
import {
  filterHostedVaultShareHistoryRecords,
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
  findActiveHostedVaultSharePage,
  hasUnmaterializedHostedVaultShareProjectionGeneration,
  replaceHostedVaultShareProjectionSnapshot,
} from "@/src/lib/hosted-vault-share/projection-store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_VAULT_SHARE_DELIVER_MAX_RECORD_FUTURE_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

type HostedVaultShareDeliverPageResponse = HostedVaultShareDeliverResponse & {
  [HOSTED_RUNTIME_VAULT_SHARE_DELIVER_CONTINUATION_FIELD]?: string;
};

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
  const rawBody = await readOptionalJsonObject(request, {
    limitBytes: HOSTED_VAULT_SHARE_DELIVER_BODY_LIMIT_BYTES,
  });
  if (rawBody.expectedGenerationToken === undefined) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SHARE_GENERATION_PROOF_REQUIRED",
      httpStatus: 503,
      message: "Hosted vault-share delivery requires current generation proof. Retry the request.",
      retryable: true,
    });
  }
  const body = parseHostedVaultShareDeliverRequest(rawBody);

  const continuation = rawBody[
    HOSTED_RUNTIME_VAULT_SHARE_DELIVER_CONTINUATION_FIELD
  ];
  const page = await findActiveHostedVaultSharePage({
    ...(continuation === undefined ? {} : { continuation }),
    grantorMemberId,
    ...(body.projectionMode ? { projectionMode: body.projectionMode } : {}),
    projectionScope: body.projectionScope,
    sourceWorkspaceVersion: body.sourceWorkspaceVersion,
  });
  if (body.expectedGenerationToken !== page.generationToken) {
    // A continuation proves that an earlier page only partially drained the
    // expected cohort. If that cohort changes between pages, never acknowledge
    // completion: the durable caller must restart against the new generation.
    if (continuation !== undefined) {
      throw createHostedVaultShareDeliveryDeferredError("pagination_generation_changed");
    }
    if (await hasUnmaterializedHostedVaultShareProjectionGeneration({
      grantorMemberId,
      projectionScope: body.projectionScope,
    })) {
      throw createHostedVaultShareDeliveryDeferredError("stale_generation_unmaterialized");
    }
    return jsonOk(NO_ACTIVE_SHARE_RESPONSE);
  }
  if (page.shares.length === 0) {
    if (page.continuation !== null) {
      return jsonOk(buildHostedVaultShareDeliverPageResponse(
        NO_ACTIVE_SHARE_RESPONSE,
        page.continuation,
      ));
    }
    if (page.hasActiveShares) {
      return jsonOk(DELIVERED_RESPONSE);
    }
    if (await hasUnmaterializedHostedVaultShareProjectionGeneration({
      grantorMemberId,
      projectionScope: body.projectionScope,
    })) {
      throw createHostedVaultShareDeliveryDeferredError("inactive_generation_unmaterialized");
    }
    return jsonOk(NO_ACTIVE_SHARE_RESPONSE);
  }

  // An all-stale offer replaces the prior snapshot with an encrypted empty snapshot. The
  // response still reflects share configuration only, so staleness cannot probe finer-
  // grained share state or leave old records visible after an empty refresh.
  const records = filterDeliverableRecords(body.records, body.projectionScope, body.memberTimeZone);
  let delivered = false;
  let deliveryFailed = false;
  let scopeFailed = false;
  let deliveryDeferred = false;

  for (const share of page.shares) {
    if (effectSignal.aborted || Date.now() >= effectDeadlineAtEpochMs) {
      console.error("Hosted vault-share delivery stopped before destination admission.", {
        errorCode: HOSTED_VAULT_SHARE_DELIVERY_FAILED_ERROR_CODE,
        deadlineElapsed: Date.now() >= effectDeadlineAtEpochMs,
        requestAborted: request.signal.aborted,
      });
      deliveryFailed = true;
      break;
    }
    try {
      const outcome = await replaceHostedVaultShareProjectionSnapshot({
        deadlineAtEpochMs: effectDeadlineAtEpochMs,
        memberTimeZone: body.memberTimeZone,
        ...(body.projectionMode ? { projectionMode: body.projectionMode } : {}),
        records,
        share,
        signal: effectSignal,
        sourceWorkspaceVersion: body.sourceWorkspaceVersion,
      });
      delivered ||= outcome === "replaced";
      deliveryDeferred ||= outcome === "no-active-share";
    } catch (error) {
      // Preserve the original failure even when the effect deadline has elapsed.
      // Never include payload fields, timestamps, or raw destination identifiers.
      console.error("Hosted vault-share delivery to a destination share failed.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_VAULT_SHARE_DESTINATION_DELIVERY_FAILED",
        }),
        deadlineElapsed: Date.now() >= effectDeadlineAtEpochMs,
        requestAborted: request.signal.aborted,
      });
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
    throw createHostedVaultShareDeliveryDeferredError("replacement_no_active_share");
  }

  return jsonOk(buildHostedVaultShareDeliverPageResponse(
    delivered ? DELIVERED_RESPONSE : NO_ACTIVE_SHARE_RESPONSE,
    page.continuation,
  ));
});

function buildHostedVaultShareDeliverPageResponse(
  response: HostedVaultShareDeliverResponse,
  continuation: string | null,
): HostedVaultShareDeliverPageResponse {
  return continuation === null
    ? response
    : {
        ...response,
        [HOSTED_RUNTIME_VAULT_SHARE_DELIVER_CONTINUATION_FIELD]: continuation,
      };
}

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

function createHostedVaultShareDeliveryDeferredError(
  reason:
    | "pagination_generation_changed"
    | "stale_generation_unmaterialized"
    | "inactive_generation_unmaterialized"
    | "replacement_no_active_share",
): Error {
  try {
    console.warn("Hosted vault-share delivery deferred.", {
      schema: "murph.hosted-vault-share-delivery-deferred.v1",
      reason,
    });
  } catch {
    // Best-effort telemetry must not change the deferred response.
  }
  return hostedOnboardingError({
    code: "HOSTED_VAULT_SHARE_DELIVERY_DEFERRED",
    httpStatus: 503,
    message: "Hosted vault-share delivery has deferred approved work. Retry the request.",
    retryable: true,
  });
}

/** The signed runtime supplies canonical date context, never consent authority. */
function filterDeliverableRecords(
  records: readonly HostedVaultShareDeliveryRecord[],
  projectionScope: HostedVaultShareProjectionScope,
  memberTimeZone?: string,
): HostedVaultShareDeliveryRecord[] {
  if (memberTimeZone) {
    return filterHostedVaultShareHistoryRecords({ records, scope: projectionScope, timeZone: memberTimeZone });
  }
  // Preserve the deployed legacy guard during consumer-first rollout.
  const nowMs = Date.now();
  const earliest = isHostedVaultShareCurrentStateProjectionKind(projectionScope.projectionKind)
    ? Number.NEGATIVE_INFINITY : nowMs - 60 * DAY_MS;
  const latest = nowMs + HOSTED_VAULT_SHARE_DELIVER_MAX_RECORD_FUTURE_DAYS * DAY_MS;
  return records.filter((record) => {
    const occurredAt = Date.parse(record.occurredAt);
    return occurredAt >= earliest && occurredAt <= latest;
  });
}
