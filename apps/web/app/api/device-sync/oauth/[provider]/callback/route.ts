import { isDeviceSyncError } from "#device-syncd";

import { createHostedDeviceSyncControlPlane } from "../../../../../../src/lib/device-sync/control-plane";
import { callbackHtml, jsonError, providerCallbackRedirect, resolveRouteParams } from "../../../../../../src/lib/device-sync/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await resolveRouteParams(context.params);
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const result = await controlPlane.handleOAuthCallback(decodeURIComponent(provider));
    const redirect = providerCallbackRedirect({
      returnTo: result.returnTo,
      provider: result.account.provider,
      connectionId: result.account.id,
    });

    return (
      redirect ??
      callbackHtml(
        `${result.account.provider} connected`,
        `Connected ${result.account.provider} connection ${result.account.id} successfully.`,
      )
    );
  } catch (error) {
    if (isDeviceSyncError(error)) {
      return callbackHtml("Device connection failed", error.message, error.httpStatus);
    }

    return jsonError(error);
  }
}
