import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";

import { createHostedDeviceSyncControlPlane } from "../../../../../../src/lib/device-sync/control-plane";
import {
  callbackHtml,
  errorToCallbackRedirect,
  providerCallbackRedirect,
  resolveDecodedRouteParam,
} from "../../../../../../src/lib/device-sync/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  let providerName: string | null = null;

  try {
    providerName = await resolveDecodedRouteParam(context.params, "provider");
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const result = await controlPlane.handleOAuthCallback(providerName);
    const browserConnection = controlPlane.toBrowserConnection(result.account);
    const redirect = providerCallbackRedirect({
      returnTo: result.returnTo,
      provider: result.account.provider,
      connectionId: browserConnection.id,
    });

    return (
      redirect ??
      callbackHtml(
        `${result.account.provider} connected`,
        `Connected ${result.account.provider} successfully.`,
      )
    );
  } catch (error) {
    if (isDeviceSyncError(error)) {
      const redirect = errorToCallbackRedirect({
        returnTo: typeof error.details?.returnTo === "string" ? error.details.returnTo : null,
        provider: typeof error.details?.provider === "string" ? error.details.provider : (providerName ?? "unknown"),
        error,
      });

      return redirect ?? callbackHtml("Device connection failed", error.message, error.httpStatus);
    }

    console.error("Hosted device-sync OAuth callback failed unexpectedly.", {
      error,
      provider: providerName,
    });
    return callbackHtml(
      "Device connection failed",
      "Something went wrong while finishing the device connection. Please retry from Murph.",
      500,
    );
  }
}
