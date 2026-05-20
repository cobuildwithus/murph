import { deviceSyncError } from "@murphai/device-syncd/public-ingress";

import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  jsonOk,
  postOnlyJson,
  readOptionalJsonObject,
  resolveDecodedRouteParam,
  withJsonError,
} from "@/src/lib/device-sync/http";

export function GET() {
  return postOnlyJson("Hosted device-sync token bundle refresh routes only allow POST.");
}

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => {
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const session = await controlPlane.requireAgentSession();
  const body = await readOptionalJsonObject(request);
  const expectedTokenVersion = readExpectedTokenVersion(body);
  const force = body.force === true;
  const connectionId = await resolveDecodedRouteParam(context.params, "connectionId");
  const refresh = await controlPlane.refreshTokenBundle(session, connectionId, {
    expectedTokenVersion,
    force,
  });
  return jsonOk({
    connection: refresh.connection,
    tokenBundle: refresh.tokenBundle,
    refreshed: refresh.refreshed,
    tokenVersionChanged: refresh.tokenVersionChanged,
  });
});

function readExpectedTokenVersion(body: Record<string, unknown>): number | null {
  if (!Object.hasOwn(body, "expectedTokenVersion") || body.expectedTokenVersion === null) {
    return null;
  }

  const { expectedTokenVersion } = body;

  if (
    typeof expectedTokenVersion !== "number"
    || !Number.isSafeInteger(expectedTokenVersion)
    || expectedTokenVersion <= 0
  ) {
    throw deviceSyncError({
      code: "INVALID_EXPECTED_TOKEN_VERSION",
      message: "expectedTokenVersion must be a positive safe integer when provided.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return expectedTokenVersion;
}
