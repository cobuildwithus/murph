import { isDeviceSyncError } from "@murphai/device-syncd";

import { createHostedDeviceSyncControlPlane } from "../../../../../../src/lib/device-sync/control-plane";
import {
  callbackHtml,
  errorToCallbackRedirect,
  jsonError,
  providerCallbackRedirect,
  resolveDecodedRouteParam,
} from "../../../../../../src/lib/device-sync/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const providerName = await resolveDecodedRouteParam(context.params, "provider");

  try {
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
        provider: typeof error.details?.provider === "string" ? error.details.provider : providerName,
        error,
      });

      return redirect ?? callbackHtml("Device connection failed", error.message, error.httpStatus);
    }

    return jsonError(error);
  }
}
