import {
  isHostedVaultShareProjectionKind,
  type HostedVaultShareProjectionKind,
} from "@murphai/hosted-execution/vault-share";

import { acceptHostedGroupJoinCodeTx } from "@/src/lib/hosted-groups/group-store";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "@/src/lib/hosted-onboarding/shared";
import { signalHostedRuntimeMaintenanceRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 4_096;

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ joinCode: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const joinCode = await resolveDecodedRouteParam(context.params, "joinCode");
  const body = await readOptionalJsonObject(request, { limitBytes: BODY_LIMIT_BYTES });
  const selectedVaultShareProjectionKinds = parseSelectedVaultShareProjectionKinds(
    body.selectedVaultShareProjectionKinds,
  );

  const prisma = getPrisma();
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => acceptHostedGroupJoinCodeTx({
    joinCode,
    memberId: auth.member.id,
    now,
    selectedVaultShareProjectionKinds,
    tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (result.grantedVaultShareProjectionKinds.length > 0) {
    try {
      await signalHostedRuntimeMaintenanceRuntime({ userId: auth.member.id });
    } catch {
      // Durable join/grants already committed; the runtime will offer projections later.
    }
  }

  return jsonOk({ ok: true, ...result });
});

function parseSelectedVaultShareProjectionKinds(value: unknown): HostedVaultShareProjectionKind[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_SELECTED_PERMISSIONS_INVALID",
      httpStatus: 400,
      message: "Selected group permissions must be a list.",
    });
  }
  const selected = new Set<HostedVaultShareProjectionKind>();
  for (const entry of value) {
    if (!isHostedVaultShareProjectionKind(entry)) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_SELECTED_PERMISSION_UNSUPPORTED",
        httpStatus: 400,
        message: "One of the selected group permissions is not supported.",
      });
    }
    selected.add(entry);
    if (selected.size > 8) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_SELECTED_PERMISSIONS_TOO_MANY",
        httpStatus: 400,
        message: "Too many group permissions were selected.",
      });
    }
  }
  return [...selected];
}
