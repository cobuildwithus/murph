import {
  readHostedRuntimeMaintenanceOverview,
  readHostedRuntimeStalledRecheckOverview,
  signalHostedRuntimeMaintenanceBatch,
  signalHostedRuntimeRecheckBatch,
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
const STALLED_RECHECK_DISCOVERY_OPERATION = "recheck-stalled-device-sync";
const RUNTIME_RECHECK_OPERATION = "recheck-runtimes";

export const GET = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request);
  const url = new URL(request.url);
  const operation = url.searchParams.get("operation");

  if (operation === STALLED_RECHECK_DISCOVERY_OPERATION) {
    return jsonOk(await readHostedRuntimeStalledRecheckOverview({
      limit: url.searchParams.get("limit"),
    }));
  }
  assertKnownRuntimeMaintenanceOperation(operation);

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
  const operation = readRuntimeMaintenanceOperation(body);

  if (operation === RUNTIME_RECHECK_OPERATION) {
    return jsonOk(await signalHostedRuntimeRecheckBatch({
      abortSignal: request.signal,
      userIds: readRequiredStringArrayField(body, "userIds"),
    }));
  }
  assertKnownRuntimeMaintenanceOperation(operation);

  return jsonOk(await signalHostedRuntimeMaintenanceBatch({
    cursor: readOptionalStringField(body, "cursor"),
    limit: readOptionalLimitField(body),
    userId: readOptionalStringField(body, "userId"),
  }));
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

function readRequiredStringArrayField(
  body: Record<string, unknown>,
  key: string,
): string[] {
  const value = body[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw invalidRuntimeMaintenanceOperation(
      `Hosted runtime maintenance ${key} must be an array of strings.`,
    );
  }
  return value;
}

function readRuntimeMaintenanceOperation(
  body: Record<string, unknown>,
): string | null {
  if (!Object.hasOwn(body, "operation")) {
    return null;
  }
  const operation = body.operation;
  if (typeof operation !== "string") {
    throw invalidRuntimeMaintenanceOperation(
      "Hosted runtime maintenance operation must be a string.",
    );
  }
  return operation;
}

function assertKnownRuntimeMaintenanceOperation(
  operation: string | null,
): asserts operation is null {
  if (operation !== null) {
    throw invalidRuntimeMaintenanceOperation(
      "Hosted runtime maintenance operation is not supported.",
    );
  }
}

function invalidRuntimeMaintenanceOperation(message: string): Error {
  return hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAINTENANCE_OPERATION_INVALID",
    httpStatus: 400,
    message,
  });
}
