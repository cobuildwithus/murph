import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";
import { buildDeviceSyncCallbackReturnLocation } from "@murphai/device-syncd/callback-redirect";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";

import {
  InvalidRouteParamEncodingError,
  callbackHtml,
  errorToCallbackRedirect,
  providerCallbackRedirect,
  redirectTo,
  resolveDecodedRouteParam,
} from "@/src/lib/device-sync/http";
import {
  buildHostedDeviceSyncCallbackProofClearCookie,
  readHostedDeviceSyncCallbackState,
  verifyHostedDeviceSyncCallbackProof,
} from "@/src/lib/device-sync/browser-callback-proof";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const HOSTED_DEVICE_SYNC_CALLBACK_FAILURE_MESSAGE =
  "Something went wrong while finishing the device connection. Please retry from Murph.";

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  let providerName: string | null = null;

  try {
    providerName = await resolveDecodedRouteParam(context.params, "provider");
    assertHostedOnboardingMutationOrigin(request);
    const publicIngress = createHostedDeviceSyncPublicIngressService(request);
    const session = await requireActiveHostedAppSessionFromRequest(request);
    const state = readHostedDeviceSyncCallbackState(new URL(request.url));
    if (
      !state
      || !verifyHostedDeviceSyncCallbackProof({
        memberId: session.member.id,
        provider: providerName,
        request,
        sessionId: session.sessionId,
        state,
      })
    ) {
      await publicIngress.discardConnectionCallback(providerName);
      return withCallbackProofCleared(
        callbackHtml(
          "Device connection failed",
          HOSTED_DEVICE_SYNC_CALLBACK_FAILURE_MESSAGE,
          403,
        ),
        providerName,
      );
    }

    const result = await publicIngress.handleConnectionCallback(providerName, {
      expectedOwnerId: session.member.id,
    });
    const redirect = providerCallbackRedirect({
      returnTo: result.returnTo,
      provider: result.account.provider,
      connectSourceId: result.connectSourceId ?? null,
      connectTarget: result.connectTarget ?? null,
    });

    return withCallbackProofCleared(
      redirect
      ?? callbackHtml(
        `${result.account.provider} connected`,
        `Connected ${result.account.provider} successfully.`,
      ),
      providerName,
    );
  } catch (error) {
    const response = handleHostedDeviceSyncCallbackError(error, request, providerName);
    return providerName ? withCallbackProofCleared(response, providerName) : response;
  }
}

function handleHostedDeviceSyncCallbackError(
  error: unknown,
  request: Request,
  providerName: string | null,
): Response {
  if (isDeviceSyncError(error)) {
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
    const returnTo = typeof error.details?.returnTo === "string" ? error.details.returnTo : null;
    const fallbackReturnTo = new URL("/connect", request.url).toString();

    if (error.code === "OAUTH_STATE_REPLAYED") {
      return redirectTo(buildDeviceSyncCallbackReturnLocation(returnTo) ?? fallbackReturnTo);
    }

    const redirect = errorToCallbackRedirect({
      returnTo: returnTo ?? fallbackReturnTo,
      provider: typeof error.details?.provider === "string"
        ? error.details.provider
        : (providerName ?? "unknown"),
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

  if (isHostedOnboardingError(error)) {
    return callbackHtml(
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

function withCallbackProofCleared(response: Response, provider: string): Response {
  const clearCookie = buildHostedDeviceSyncCallbackProofClearCookie(provider);
  if (clearCookie) {
    response.headers.append("Set-Cookie", clearCookie);
  }
  return response;
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
