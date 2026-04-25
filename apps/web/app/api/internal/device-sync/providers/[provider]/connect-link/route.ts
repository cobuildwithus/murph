import { deviceSyncError } from "@murphai/device-syncd/public-ingress";

import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject, resolveDecodedRouteParam } from "@/src/lib/http";
import { formatHostedDeviceSyncProviderLabel } from "@/src/lib/device-sync/provider-label";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";

const HOSTED_ASSISTANT_DEVICE_CONNECT_RETURN_TO = "/settings?tab=wearables";
const HOSTED_ASSISTANT_DEVICE_CONNECT_MESSAGING_RETURN_TO = {
  imessage: "/api/device-sync/messaging-return?target=imessage",
  telegram: "/api/device-sync/messaging-return?target=telegram",
} as const;

type HostedAssistantDeviceConnectMessagingReturnTarget =
  keyof typeof HOSTED_ASSISTANT_DEVICE_CONNECT_MESSAGING_RETURN_TO;

const HOSTED_ASSISTANT_DEVICE_CONNECT_UNAVAILABLE_ERROR = {
  code: "HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE",
  httpStatus: 503,
  message:
    "Hosted device connection links are temporarily unavailable. Please try again shortly.",
  retryable: true,
} as const;

type HostedDeviceConnectLinkSetupPhase =
  | "callback_verification_setup"
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
  context: { params: Promise<{ provider: string }> },
) => {
  const userId = await requireHostedDeviceConnectCallbackRequest(request);
  const provider = await resolveDecodedRouteParam(context.params, "provider");
  const body = await readHostedDeviceConnectRequestBody(request);
  const messagingReturnTarget = readHostedDeviceConnectMessagingReturnTarget(body);
  const result = await startHostedDeviceConnection(
    request,
    userId,
    provider,
    messagingReturnTarget,
  );

  return jsonOk({
    authorizationUrl: result.authorizationUrl,
    expiresAt: result.expiresAt,
    provider: result.provider,
    providerLabel: formatHostedDeviceSyncProviderLabel(result.provider),
  });
});

async function requireHostedDeviceConnectCallbackRequest(request: Request): Promise<string> {
  try {
    return await requireHostedCloudflareCallbackRequest(request);
  } catch (error) {
    remapHostedDeviceConnectBackendSetupError(error, "callback_verification_setup");
  }
}

async function startHostedDeviceConnection(
  request: Request,
  userId: string,
  provider: string,
  messagingReturnTarget: HostedAssistantDeviceConnectMessagingReturnTarget | null,
) {
  try {
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    return await controlPlane.startConnection(
      userId,
      provider,
      resolveHostedDeviceConnectReturnTo(messagingReturnTarget),
    );
  } catch (error) {
    remapHostedDeviceConnectBackendSetupError(error, "control_plane_setup");
  }
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

function resolveHostedDeviceConnectReturnTo(
  messagingReturnTarget: HostedAssistantDeviceConnectMessagingReturnTarget | null,
): string {
  return messagingReturnTarget
    ? HOSTED_ASSISTANT_DEVICE_CONNECT_MESSAGING_RETURN_TO[messagingReturnTarget]
    : HOSTED_ASSISTANT_DEVICE_CONNECT_RETURN_TO;
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
