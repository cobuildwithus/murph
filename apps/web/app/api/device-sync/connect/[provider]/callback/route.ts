import {
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
} from "@murphai/device-syncd/hosted-runtime";
import {
  buildDeviceSyncCallbackErrorRedirectLocation,
  buildDeviceSyncCallbackReturnLocation,
} from "@murphai/device-syncd/callback-redirect";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";

import {
  InvalidRouteParamEncodingError,
  errorToCallbackRedirect,
  providerCallbackRedirect,
  redirectTo,
  resolveDecodedRouteParam,
} from "@/src/lib/device-sync/http";
import {
  readHostedDeviceSyncCallbackState,
  verifyHostedDeviceSyncCallbackProof,
} from "@/src/lib/device-sync/browser-callback-proof";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import {
  createMemberOwnedProviderSetupService,
  readMemberOwnedProviderSetupRegistration,
} from "@/src/lib/device-sync/provider-setup";
import { reportHostedDeviceConnectFailure } from "@/src/lib/device-sync/connect-failure-alert";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getPrisma } from "@/src/lib/prisma";

// The provider proof cookie is one slot per provider that a newer start may
// overwrite while an older callback response is still in flight, so no
// callback response may delete it: the 15-minute expiry and the next start's
// overwrite own the whole cookie lifecycle.

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  let providerName: string | null = null;
  let sessionMemberId: string | null = null;

  try {
    providerName = await resolveDecodedRouteParam(context.params, "provider");
    const publicIngress = createHostedDeviceSyncPublicIngressService(request);
    const session = await requireActiveHostedAppSessionFromRequest(request);
    sessionMemberId = session.member.id;
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
      // Discard only this active member's still-unconsumed admission. A
      // foreign-owner URL stays non-mutating, while a consumed claim remains
      // owned by the callback that may already have completed provider work.
      await publicIngress.discardConnectionCallback(providerName, {
        expectedOwnerId: session.member.id,
      });
      // A discarded callback writes no connection error, so without this the
      // member is stuck at a wall that leaves no trace anywhere.
      await reportHostedDeviceConnectFailure({
        errorCode: "CALLBACK_PROOF_INVALID",
        memberId: sessionMemberId,
        provider: providerName,
      });
      return hostedDeviceSyncCallbackFailureRedirect(
        request,
        providerName,
        "CALLBACK_PROOF_INVALID",
      );
    }

    const result = await publicIngress.handleConnectionCallback(providerName, {
      expectedOwnerId: session.member.id,
    });
    const memberOwnedRegistration = readMemberOwnedProviderSetupRegistration(
      providerName,
    );
    if (memberOwnedRegistration) {
      // The created connection is authoritative. Projection repair must never
      // turn a successful provider callback into a false callback failure.
      try {
        const provider = memberOwnedRegistration.coordinates.provider;
        const connection = await getPrisma().deviceConnection.findFirst({
          select: {
            providerApplicationId: true,
            providerApplicationRevision: true,
          },
          where: {
            id: result.account.id,
            provider,
            userId: session.member.id,
          },
        });
        if (
          connection?.providerApplicationId
          && connection.providerApplicationRevision !== null
        ) {
          await createMemberOwnedProviderSetupService(provider).markConnected({
            applicationId: connection.providerApplicationId,
            memberId: session.member.id,
            revision: connection.providerApplicationRevision,
          });
        }
      } catch (projectionError) {
        console.warn("Member-owned provider setup callback projection failed.", {
          errorType: describeHostedDeviceSyncCallbackErrorType(projectionError),
          provider: memberOwnedRegistration.coordinates.provider,
        });
      }
    }
    const fallbackReturnTo = new URL("/connect", request.url).toString();

    return providerCallbackRedirect({
      returnTo: result.returnTo ?? fallbackReturnTo,
      provider: result.account.provider,
      connectSourceId: result.connectSourceId ?? null,
      connectTarget: result.connectTarget ?? null,
    }) ?? redirectTo(fallbackReturnTo);
  } catch (error) {
    return await handleHostedDeviceSyncCallbackError(
      error,
      request,
      providerName,
      sessionMemberId,
    );
  }
}

async function handleHostedDeviceSyncCallbackError(
  error: unknown,
  request: Request,
  providerName: string | null,
  sessionMemberId: string | null,
): Promise<Response> {
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
    await reportHostedDeviceConnectFailure({
      connectSourceId,
      errorCode: error.code,
      httpStatus: error.httpStatus ?? null,
      memberId: sessionMemberId,
      provider: providerName,
    });
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

    return redirect ?? hostedDeviceSyncCallbackFailureRedirect(
      request,
      providerName,
      error.code,
    );
  }

  if (isHostedOnboardingError(error)) {
    // Landing on Connect routes a signed-out member into the ordinary Connect
    // recovery surface instead of dead-ending on a bare HTML page.
    return hostedDeviceSyncCallbackFailureRedirect(
      request,
      providerName,
      "CALLBACK_SESSION_REQUIRED",
    );
  }

  if (error instanceof InvalidRouteParamEncodingError) {
    return hostedDeviceSyncCallbackFailureRedirect(request, null, "CALLBACK_FAILED");
  }

  console.error("Hosted device-sync connection callback failed unexpectedly.", {
    errorType: describeHostedDeviceSyncCallbackErrorType(error),
    provider: providerName,
  });
  await reportHostedDeviceConnectFailure({
    errorCode: "UNEXPECTED_CALLBACK_ERROR",
    memberId: sessionMemberId,
    provider: providerName,
  });
  return hostedDeviceSyncCallbackFailureRedirect(request, providerName, "CALLBACK_FAILED");
}

function hostedDeviceSyncCallbackFailureRedirect(
  request: Request,
  providerName: string | null,
  errorCode: string,
): Response {
  const location = buildDeviceSyncCallbackErrorRedirectLocation({
    returnTo: new URL("/connect", request.url).toString(),
    provider: providerName ?? "unknown",
    connectSourceId: null,
    connectTarget: null,
    errorCode,
  });
  return redirectTo(location ?? new URL("/connect", request.url).toString());
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
