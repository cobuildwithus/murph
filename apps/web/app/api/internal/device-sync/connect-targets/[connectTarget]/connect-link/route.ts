import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  configuredDeviceSyncProviderKeys,
  isDeviceConnectSourceAvailableForConnection,
  listConfiguredDeviceSyncConnectTargets,
  readConfiguredDeviceSyncConnectTargetConfigs,
  resolveConfiguredDeviceSyncConnectTarget,
  type DeviceSyncConnectTarget,
} from "@murphai/device-syncd/connect-config";

import {
  createHostedDeviceConnectIntent,
} from "@/src/lib/device-sync/connect-intents";
import {
  createMemberOwnedProviderSetupService,
  readMemberOwnedProviderSetupRegistration,
  readMemberOwnedProviderSetupRegistrationByConnectTarget,
} from "@/src/lib/device-sync/provider-setup";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject, resolveDecodedRouteParam } from "@/src/lib/http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { isHostedThreadContainerMember } from "@/src/lib/hosted-onboarding/member-access";

type HostedAssistantDeviceConnectMessagingReturnTarget =
  "imessage" | "telegram";

type HostedDeviceConnectLinkTarget = DeviceSyncConnectTarget & {
  memberOwnedSetup: boolean;
};

const HOSTED_ASSISTANT_DEVICE_CONNECT_UNAVAILABLE_ERROR = {
  code: "HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE",
  httpStatus: 503,
  message:
    "Hosted device connection links are temporarily unavailable. Please try again shortly.",
  retryable: true,
} as const;
const HOSTED_DEVICE_CONNECT_DIAGNOSTIC_PROVIDER_IDS = new Set<string>(
  configuredDeviceSyncProviderKeys,
);
const HOSTED_DEVICE_CONNECT_DIAGNOSTIC_ERROR_CODE_MAX_LENGTH = 96;
const HOSTED_DEVICE_CONNECT_CALLBACK_BODY_LIMIT_BYTES = 4 * 1024;

type HostedDeviceConnectLinkSetupPhase =
  | "callback_verification_setup"
  | "connect_target_setup"
  | "control_plane_setup";

class HostedDeviceConnectLinkBackendSetupError extends Error {
  readonly errorObservabilityClass = "hosted_device_connect_link_backend_setup";
  readonly errorPhase: HostedDeviceConnectLinkSetupPhase;

  constructor(phase: HostedDeviceConnectLinkSetupPhase, cause: unknown) {
    super("Hosted device connect-link backend setup failed.", { cause });
    this.name = "HostedDeviceConnectLinkBackendSetupError";
    this.errorPhase = phase;
  }
}

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted internal device-sync connect-link routes only allow POST because starting a connection mutates server state.",
    },
  }, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
    },
  });
}

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectTarget: string }> },
) => {
  let stage: HostedDeviceConnectLinkRouteStage = "callback_verification";
  let connectTarget: string | null = null;
  let messagingReturnTarget: HostedAssistantDeviceConnectMessagingReturnTarget | null = null;

  try {
    const userId = await requireHostedDeviceConnectCallbackRequest(request);
    stage = "member_scope";
    if (await isHostedThreadContainerMember({ memberId: userId })) {
      throw deviceSyncError({
        code: "HOSTED_DEVICE_CONNECT_PERSONAL_MEMBER_REQUIRED",
        httpStatus: 403,
        message: "Wearable connections are available only in a private Murph account.",
        retryable: false,
      });
    }
    stage = "connect_target_param";
    connectTarget = await resolveDecodedRouteParam(context.params, "connectTarget");
    stage = "request_body";
    const body = await readHostedDeviceConnectRequestBody(request);
    stage = "messaging_return_target";
    messagingReturnTarget = readHostedDeviceConnectMessagingReturnTarget(body);
    stage = "connect_target_resolution";
    const target = resolveHostedDeviceConnectTarget(connectTarget);
    stage = "control_plane";
    const result = await createHostedDeviceConnectLinkIntent({
      request,
      userId,
      target,
    });
    logHostedDeviceConnectRouteDiagnostic({
      expiresAtPresent: Boolean(result.expiresAt),
      messagingReturnTarget,
      provider: target.connectTarget,
      stage: "control_plane",
      status: "issued",
    });

    return jsonOk({
      authorizationUrl: result.connectUrl,
      connectUrl: result.connectUrl,
      expiresAt: result.expiresAt,
      provider: target.connectTarget,
      providerLabel: target.label,
    });
  } catch (error) {
    logHostedDeviceConnectRouteDiagnostic({
      error,
      messagingReturnTarget,
      provider: connectTarget,
      stage,
      status: "failed",
    });
    throw error;
  }
});

type HostedDeviceConnectLinkRouteStage =
  | "callback_verification"
  | "connect_target_param"
  | "connect_target_resolution"
  | "control_plane"
  | "messaging_return_target"
  | "member_scope"
  | "request_body";

async function requireHostedDeviceConnectCallbackRequest(request: Request): Promise<string> {
  try {
    return await requireHostedCloudflareCallbackRequest(request, {
      maxBodyBytes: HOSTED_DEVICE_CONNECT_CALLBACK_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    remapHostedDeviceConnectBackendSetupError(error, "callback_verification_setup");
  }
}

async function createHostedDeviceConnectLinkIntent(input: {
  request: Request;
  target: HostedDeviceConnectLinkTarget;
  userId: string;
}) {
  try {
    const setupRegistration = input.target.memberOwnedSetup
      ? readMemberOwnedProviderSetupRegistration(input.target.provider)
      : null;
    const setup = setupRegistration
      ? await createMemberOwnedProviderSetupService(
          setupRegistration.coordinates.provider,
        ).ensure(input.userId)
      : null;
    return await createHostedDeviceConnectIntent({
      connectSourceId: input.target.connectSourceId,
      connectTarget: input.target.connectTarget,
      ...(setup
        ? {
            providerSetupId: setup.id,
          }
        : {}),
      memberId: input.userId,
      provider: input.target.provider,
      request: input.request,
      sourceProviderSlug: input.target.sourceProviderSlug ?? null,
    });
  } catch (error) {
    remapHostedDeviceConnectBackendSetupError(error, "control_plane_setup");
  }
}

function resolveHostedDeviceConnectTarget(
  connectTarget: string,
): HostedDeviceConnectLinkTarget {
  const memberOwnedRegistration =
    readMemberOwnedProviderSetupRegistrationByConnectTarget(connectTarget);
  if (memberOwnedRegistration) {
    return {
      ...memberOwnedRegistration.coordinates,
      label: memberOwnedRegistration.presentation.providerName,
      memberOwnedSetup: true,
    };
  }

  let target: ReturnType<typeof resolveConfiguredDeviceSyncConnectTarget> = null;
  try {
    target = resolveConfiguredDeviceSyncConnectTarget(
      readConfiguredDeviceSyncConnectTargetConfigs(process.env),
      connectTarget,
    );
  } catch (error) {
    remapHostedDeviceConnectBackendSetupError(error, "connect_target_setup");
  }

  if (
    !target
    || !isDeviceConnectSourceAvailableForConnection(target.connectSourceId)
  ) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED",
      httpStatus: 404,
      message: "Hosted device connect target is not configured.",
      retryable: false,
    });
  }

  return { ...target, memberOwnedSetup: false };
}

async function readHostedDeviceConnectRequestBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    return await readOptionalJsonObject(request);
  } catch (error) {
    throw deviceSyncError({
      cause: error,
      code: "INVALID_REQUEST",
      httpStatus: 400,
      message: "Invalid request.",
      retryable: false,
    });
  }
}

function readHostedDeviceConnectMessagingReturnTarget(
  body: Record<string, unknown>,
): HostedAssistantDeviceConnectMessagingReturnTarget | null {
  const value = body.messagingReturnTarget;

  if (value === undefined || value === null) {
    return null;
  }

  if (value === "imessage" || value === "telegram") {
    return value;
  }

  throw deviceSyncError({
    code: "HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET",
    httpStatus: 400,
    message: "Hosted device connect-link messaging return target is invalid.",
    retryable: false,
  });
}

function remapHostedDeviceConnectBackendSetupError(
  error: unknown,
  phase: HostedDeviceConnectLinkSetupPhase,
): never {
  if (error instanceof TypeError || error instanceof RangeError) {
    throw deviceSyncError({
      ...HOSTED_ASSISTANT_DEVICE_CONNECT_UNAVAILABLE_ERROR,
      cause: new HostedDeviceConnectLinkBackendSetupError(phase, error),
    });
  }

  throw error;
}

function logHostedDeviceConnectRouteDiagnostic(input: {
  error?: unknown;
  expiresAtPresent?: boolean;
  messagingReturnTarget: HostedAssistantDeviceConnectMessagingReturnTarget | null;
  provider: string | null;
  stage: HostedDeviceConnectLinkRouteStage;
  status: "failed" | "issued";
}): void {
  const errorCode = input.error === undefined
    ? null
    : readHostedDeviceConnectRouteErrorString(input.error, "code");
  const errorHttpStatus = input.error === undefined
    ? null
    : readHostedDeviceConnectRouteErrorNumber(input.error, "httpStatus")
      ?? readHostedDeviceConnectRouteErrorNumber(input.error, "status")
      ?? readHostedDeviceConnectRouteErrorNumber(input.error, "statusCode");
  const errorRetryable = input.error === undefined
    ? null
    : readHostedDeviceConnectRouteErrorBoolean(input.error, "retryable");
  const details = {
    ...(errorCode ? { errorCode } : {}),
    ...(errorHttpStatus ? { errorHttpStatus } : {}),
    ...(errorRetryable === null ? {} : { errorRetryable }),
    ...(input.expiresAtPresent === undefined
      ? {}
      : { expiresAtPresent: input.expiresAtPresent }),
    messagingReturnTarget: input.messagingReturnTarget,
    provider: readHostedDeviceConnectRouteProvider(input.provider),
    stage: input.stage,
    status: input.status,
  };

  if (input.status === "failed") {
    console.warn("Hosted internal device-sync connect-link diagnostic.", details);
    return;
  }

  console.info("Hosted internal device-sync connect-link diagnostic.", details);
}

function readHostedDeviceConnectRouteErrorString(
  error: unknown,
  property: "code",
): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const value = Reflect.get(error, property);
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > HOSTED_DEVICE_CONNECT_DIAGNOSTIC_ERROR_CODE_MAX_LENGTH
  ) {
    return null;
  }

  return /^[A-Z][A-Z0-9_:-]*$/u.test(normalized) ? normalized : null;
}

function readHostedDeviceConnectRouteErrorNumber(
  error: unknown,
  property: "httpStatus" | "status" | "statusCode",
): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const value = Reflect.get(error, property);
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 100
    && value <= 599
    ? value
    : null;
}

function readHostedDeviceConnectRouteErrorBoolean(
  error: unknown,
  property: "retryable",
): boolean | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const value = Reflect.get(error, property);
  return typeof value === "boolean" ? value : null;
}

function readHostedDeviceConnectRouteProvider(provider: string | null): string | null {
  if (!provider) {
    return null;
  }

  const normalized = provider.trim().toLowerCase();
  return readHostedDeviceConnectDiagnosticProviderIds().has(normalized) ? normalized : null;
}

function readHostedDeviceConnectDiagnosticProviderIds(): Set<string> {
  const providerIds = new Set(HOSTED_DEVICE_CONNECT_DIAGNOSTIC_PROVIDER_IDS);

  try {
    for (const target of listConfiguredDeviceSyncConnectTargets(
      readConfiguredDeviceSyncConnectTargetConfigs(process.env),
    )) {
      providerIds.add(target.connectTarget);
    }
  } catch {
    return providerIds;
  }

  return providerIds;
}
