import {
  readHostedRuntimeMaintenanceOverview,
  repairHostedRuntimeManagedAutomationsBatch,
  signalHostedRuntimeMaintenanceBatch,
} from "@/src/lib/hosted-ops/runtime-maintenance";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_RUNTIME_MAINTENANCE_BODY_LIMIT_BYTES = 4 * 1024;

export const GET = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request);
  const url = new URL(request.url);

  return jsonOk(await readHostedRuntimeMaintenanceOverview({
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit"),
  }));
});

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_RUNTIME_MAINTENANCE_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_RUNTIME_MAINTENANCE_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted runtime maintenance request body is too large.",
  });

  const action = readOptionalStringField(body, "action") ?? "wake-maintenance";
  const maintenanceRequest = {
    cursor: readOptionalStringField(body, "cursor"),
    limit: readOptionalLimitField(body),
    userId: readOptionalStringField(body, "userId"),
  };

  switch (action) {
    case "wake-maintenance":
      return jsonOk(await signalHostedRuntimeMaintenanceBatch(maintenanceRequest));
    case "seed-managed-automations":
      return jsonOk(await repairHostedRuntimeManagedAutomationsBatch(maintenanceRequest));
    default:
      throw hostedOnboardingError({
        code: "HOSTED_RUNTIME_MAINTENANCE_ACTION_UNSUPPORTED",
        httpStatus: 400,
        message: "Unsupported hosted runtime maintenance action.",
      });
  }
});

function readOptionalStringField(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function readOptionalLimitField(body: Record<string, unknown>): number | string | null {
  const value = body.limit;
  return typeof value === "string" || typeof value === "number" ? value : null;
}
