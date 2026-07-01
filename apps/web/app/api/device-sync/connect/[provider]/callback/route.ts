import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";

import {
  InvalidRouteParamEncodingError,
  callbackHtml,
  errorToCallbackRedirect,
  providerCallbackRedirect,
  resolveDecodedRouteParam,
} from "@/src/lib/device-sync/http";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";

const HOSTED_DEVICE_SYNC_CALLBACK_FAILURE_MESSAGE =
  "Something went wrong while finishing the device connection. Please retry from Murph.";

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  let providerName: string | null = null;

  try {
    providerName = await resolveDecodedRouteParam(context.params, "provider");
    const publicIngress = createHostedDeviceSyncPublicIngressService(request);
    const result = await publicIngress.handleConnectionCallback(providerName);
    const redirect = providerCallbackRedirect({
      returnTo: result.returnTo,
      provider: result.account.provider,
      connectSourceId: result.connectSourceId ?? null,
      connectTarget: result.connectTarget ?? null,
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
      // The only hosted log line for failed callbacks. The route param and
      // some provider messages can carry request-controlled text, so both go
      // through the shared redaction helpers before emission.
      console.warn("Hosted device-sync connection callback failed.", {
        provider: sanitizeHostedRuntimeErrorCode(providerName),
        errorCode: error.code,
        httpStatus: error.httpStatus,
        message: sanitizeHostedRuntimeErrorText(error.message),
      });
      const connectSourceId = typeof error.details?.connectSourceId === "string"
        ? error.details.connectSourceId
        : null;
      const connectTarget = typeof error.details?.connectTarget === "string"
        ? error.details.connectTarget
        : null;
      const redirect = errorToCallbackRedirect({
        returnTo: typeof error.details?.returnTo === "string" ? error.details.returnTo : null,
        provider: typeof error.details?.provider === "string" ? error.details.provider : (providerName ?? "unknown"),
        connectSourceId,
        connectTarget,
        error,
      });

      return redirect ?? callbackHtml(
        "Device connection failed",
        HOSTED_DEVICE_SYNC_CALLBACK_FAILURE_MESSAGE,
        error.httpStatus,
      );
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
      HOSTED_DEVICE_SYNC_CALLBACK_FAILURE_MESSAGE,
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
