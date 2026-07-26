import { assertDeviceSyncDiagnosticRouteEnabled } from "@/src/lib/device-sync/backfill-diagnostic";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { runHostedOpsJunctionRecovery } from "@/src/lib/hosted-ops/device-sync-diagnostics";
import { readHostedOnboardingJsonObject } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_JUNCTION_RECOVERY_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  assertDeviceSyncDiagnosticRouteEnabled(request);

  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_JUNCTION_RECOVERY_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_JUNCTION_RECOVERY_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops Junction recovery request body is too large.",
  });

  return jsonOk(await runHostedOpsJunctionRecovery({
    action: body.action,
    connectionId: readOptionalStringField(body, "connectionId"),
    memberId: readOptionalStringField(body, "memberId"),
    request,
    sourceProvider: readOptionalStringField(body, "sourceProvider"),
  }));
});

function readOptionalStringField(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}
