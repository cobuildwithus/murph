import { assertDeviceSyncDiagnosticRouteEnabled } from "@/src/lib/device-sync/backfill-diagnostic";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { runHostedOpsGarminDiagnostic } from "@/src/lib/hosted-ops/device-sync-diagnostics";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  readHostedOnboardingJsonObject,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_GARMIN_DIAGNOSTIC_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  assertDeviceSyncDiagnosticRouteEnabled(request);

  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_GARMIN_DIAGNOSTIC_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_GARMIN_DIAGNOSTIC_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops Garmin diagnostic request body is too large.",
  });

  return jsonOk(await runHostedOpsGarminDiagnostic({
    connectionId: readOptionalStringField(body, "connectionId"),
    lookbackDays: readOptionalNumberOrStringField(body, "lookbackDays"),
    memberId: readOptionalStringField(body, "memberId"),
    request,
    timeseriesDays: readOptionalNumberOrStringField(body, "timeseriesDays"),
    windowEnd: readOptionalStringField(body, "windowEnd"),
    windowStart: readOptionalStringField(body, "windowStart"),
  }));
});

function readOptionalStringField(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function readOptionalNumberOrStringField(
  body: Record<string, unknown>,
  key: string,
): number | string | null {
  const value = body[key];
  return typeof value === "string" || typeof value === "number" ? value : null;
}
