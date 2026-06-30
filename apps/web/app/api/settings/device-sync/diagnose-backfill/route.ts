import {
  assertDeviceSyncDiagnosticRouteEnabled,
  createHostedDeviceSyncDiagnosticControlPlane,
  normalizeQueryString,
  readRestProbe,
  readTimeseriesProbeDays,
  runHostedDeviceSyncBackfillDiagnostic,
} from "@/src/lib/device-sync/backfill-diagnostic";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";

export const GET = withJsonError(async (request: Request) => {
  return handleDeviceSyncBackfillDiagnostic(request, { allowProviderRefresh: false });
});

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  return handleDeviceSyncBackfillDiagnostic(request, { allowProviderRefresh: true });
});

async function handleDeviceSyncBackfillDiagnostic(
  request: Request,
  options: { allowProviderRefresh: boolean },
) {
  assertDeviceSyncDiagnosticRouteEnabled(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const controlPlane = createHostedDeviceSyncDiagnosticControlPlane(request);
  const url = new URL(request.url);
  const restProbe = readRestProbe(url.searchParams);
  if (restProbe?.endpoint === "refresh" && !options.allowProviderRefresh) {
    throw deviceSyncError({
      code: "DEVICE_SYNC_REST_DIAGNOSTIC_REFRESH_REQUIRES_POST",
      message: "Junction refresh diagnostics require a POST request.",
      httpStatus: 405,
      retryable: false,
    });
  }

  return jsonOk(await runHostedDeviceSyncBackfillDiagnostic({
    connectionId: normalizeQueryString(url.searchParams.get("connectionId")),
    controlPlane,
    memberId: auth.member.id,
    providerName: normalizeQueryString(url.searchParams.get("provider")) ?? "junction",
    restProbe,
    timeseriesProbeDays: readTimeseriesProbeDays(url.searchParams.get("timeseriesDays")),
    windowEnd: normalizeQueryString(url.searchParams.get("windowEnd")),
    windowStart: normalizeQueryString(url.searchParams.get("windowStart")),
  }));
}
