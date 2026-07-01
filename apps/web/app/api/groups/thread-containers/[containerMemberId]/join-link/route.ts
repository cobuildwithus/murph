import {
  isHostedVaultShareProjectionKind,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";

import { buildHostedGroupJoinUrl } from "@/src/lib/hosted-groups/group-links";
import {
  createHostedGroupJoinLinkForOwnedThreadContainerTx,
} from "@/src/lib/hosted-groups/group-store";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 4_096;
const HOSTED_GROUP_KINDS = new Set([
  "couple",
  "custom",
  "family",
  "friends",
  "household",
  "team",
]);

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ containerMemberId: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const publicBaseUrl = resolveHostedPublicBaseUrl();
  if (!publicBaseUrl) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_PUBLIC_BASE_URL_UNAVAILABLE",
      httpStatus: 503,
      message: "Group links are not available right now.",
      retryable: true,
    });
  }

  const containerMemberId = await resolveDecodedRouteParam(
    context.params,
    "containerMemberId",
  );
  const body = await readOptionalJsonObject(request, { limitBytes: BODY_LIMIT_BYTES });
  const displayName = parseOptionalDisplayName(body.displayName);
  const kind = parseOptionalHostedGroupKind(body.kind);
  const requestedVaultShareProjectionKinds =
    parseRequestedVaultShareProjectionKinds(body.requestedVaultShareProjectionKinds);

  const prisma = getPrisma();
  const now = new Date();
  const result = await prisma.$transaction(async (tx) =>
    createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: auth.member.id,
      containerMemberId,
      displayName,
      kind,
      now,
      requestedVaultShareProjectionKinds,
      tx,
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  const joinUrl = buildHostedGroupJoinUrl({
    joinCode: result.joinCode,
    publicBaseUrl,
  });
  if (!joinUrl) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_PUBLIC_BASE_URL_UNAVAILABLE",
      httpStatus: 503,
      message: "Group links are not available right now.",
      retryable: true,
    });
  }

  return jsonOk({
    group: result.group,
    joinUrl,
    ok: true,
  });
});

function parseOptionalDisplayName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_DISPLAY_NAME_INVALID",
      httpStatus: 400,
      message: "Group display name must be text.",
      retryable: false,
    });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 120) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_DISPLAY_NAME_TOO_LONG",
      httpStatus: 400,
      message: "Group display name is too long.",
      retryable: false,
    });
  }
  return trimmed;
}

function parseOptionalHostedGroupKind(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !HOSTED_GROUP_KINDS.has(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_KIND_INVALID",
      httpStatus: 400,
      message: "Group kind is not supported.",
      retryable: false,
    });
  }
  return value;
}

function parseRequestedVaultShareProjectionKinds(
  value: unknown,
): HostedVaultShareProjectionKind[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_REQUESTED_PERMISSIONS_INVALID",
      httpStatus: 400,
      message: "Requested group permissions must be a list.",
      retryable: false,
    });
  }
  const requested = new Set<HostedVaultShareProjectionKind>();
  for (const entry of value) {
    if (!isHostedVaultShareProjectionKind(entry)) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_REQUESTED_PERMISSION_UNSUPPORTED",
        httpStatus: 400,
        message: "One of the requested group permissions is not supported.",
        retryable: false,
      });
    }
    requested.add(entry);
    if (requested.size > 8) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_REQUESTED_PERMISSIONS_TOO_MANY",
        httpStatus: 400,
        message: "Too many group permissions were requested.",
        retryable: false,
      });
    }
  }
  return [...requested];
}
