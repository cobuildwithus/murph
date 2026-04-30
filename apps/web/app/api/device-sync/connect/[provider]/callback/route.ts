import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";

import {
  InvalidRouteParamEncodingError,
  callbackHtml,
  errorToCallbackRedirect,
  providerCallbackRedirect,
  resolveDecodedRouteParam,
} from "@/src/lib/device-sync/http";
import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  let providerName: string | null = null;

  try {
    providerName = await resolveDecodedRouteParam(context.params, "provider");
    const controlPlane = createHostedDeviceSyncControlPlane(request);
    const result = await controlPlane.handleConnectionCallback(providerName);
    const redirect = providerCallbackRedirect({
      returnTo: result.returnTo,
      provider: result.account.provider,
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

    if (error instanceof InvalidRouteParamEncodingError) {
      return callbackHtml(
        "Device connection failed",
        "The device connection callback URL was invalid.",
        400,
      );
    }

    console.error("Hosted device-sync connection callback failed unexpectedly.", {
      errorType: describeHostedDeviceSyncCallbackErrorType(error),
      provider: providerName,
    });
    return callbackHtml(
      "Device connection failed",
      "Something went wrong while finishing the device connection. Please retry from Murph.",
      500,
    );
  }
}

function describeHostedDeviceSyncCallbackErrorType(error: unknown): string {
  if (error instanceof Error) {
    const constructorName = error.constructor?.name;

    return typeof constructorName === "string" && constructorName.length > 0
      ? constructorName
      : (error.name || "Error");
  }

  if (Array.isArray(error)) {
    return "array";
  }

  return error === null ? "null" : typeof error;
}
