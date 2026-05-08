import { isDeviceSyncError } from "@murphai/device-syncd/public-ingress";
import {
  readConfiguredDeviceSyncProviderConfigs,
  resolveConfiguredDeviceSyncConnectTarget,
} from "@murphai/device-syncd/config";

import { buildHostedDeviceConnectCompletionReturnTo } from "@/src/lib/device-sync/connect-completion-return";
import {
  claimHostedDeviceConnectIntentForStart,
  readHostedDeviceConnectIntent,
  releaseHostedDeviceConnectIntentStart,
  type HostedDeviceConnectIntentRecord,
} from "@/src/lib/device-sync/connect-intents";
import { startHostedDeviceSyncConnection } from "@/src/lib/device-sync/hosted-connect-start";
import {
  getHostedAppSessionFromRequest,
  requireActiveHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  InvalidRouteParamEncodingError,
  resolveDecodedRouteParam,
} from "@/src/lib/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ claim: string }> },
): Promise<Response> {
  try {
    const claim = await resolveDecodedRouteParam(context.params, "claim");
    const result = await readHostedDeviceConnectIntent(claim);

    if (result.status !== "available") {
      return deviceConnectIntentHtml(
        "Connection link unavailable",
        describeUnavailableIntentStatus(result.status),
        410,
      );
    }

    const session = await getHostedAppSessionFromRequest(request);
    if (!session) {
      return deviceConnectIntentHtml(
        "Sign in to continue",
        "Open Murph in this browser, sign in, then reopen this connection link.",
        401,
      );
    }

    if (session.member.id !== result.intent.memberId) {
      return deviceConnectIntentHtml(
        "Wrong Murph account",
        "This connection link belongs to a different Murph account.",
        403,
      );
    }

    const target = resolveHostedDeviceConnectIntentTarget(result.intent);
    if (!target) {
      return deviceConnectIntentHtml(
        "Connection unavailable",
        "This device source is not currently available.",
        404,
      );
    }

    return deviceConnectIntentConfirmHtml(target.label);
  } catch (error) {
    return handleHostedDeviceConnectIntentError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ claim: string }> },
): Promise<Response> {
  try {
    assertHostedOnboardingMutationOrigin(request);
    const claim = await resolveDecodedRouteParam(context.params, "claim");
    const session = await requireActiveHostedAppSessionFromRequest(request);
    const claimed = await claimHostedDeviceConnectIntentForStart({
      claim,
      memberId: session.member.id,
    });

    if (claimed.status !== "claimed") {
      return deviceConnectIntentHtml(
        "Connection link unavailable",
        describeUnavailableIntentStatus(claimed.status),
        claimed.status === "owner_mismatch" ? 403 : 410,
      );
    }

    const target = resolveHostedDeviceConnectIntentTarget(claimed.intent);
    if (!target) {
      await releaseHostedDeviceConnectIntentStart({
        claim,
        memberId: session.member.id,
      });
      return deviceConnectIntentHtml(
        "Connection unavailable",
        "This device source is not currently available.",
        404,
      );
    }

    let started: Awaited<ReturnType<typeof startHostedDeviceSyncConnection>>;
    try {
      started = await startHostedDeviceSyncConnection({
        defaultReturnTo: buildHostedDeviceConnectCompletionReturnTo({
          connectSourceId: target.connectSourceId,
          connectTarget: target.connectTarget,
          source: "assistant",
        }),
        request,
        target,
      });
    } catch (error) {
      await releaseHostedDeviceConnectIntentStart({
        claim,
        memberId: session.member.id,
      });
      throw error;
    }

    return redirectNoReferrer(started.authorizationUrl);
  } catch (error) {
    return handleHostedDeviceConnectIntentError(error);
  }
}

function resolveHostedDeviceConnectIntentTarget(intent: HostedDeviceConnectIntentRecord) {
  const target = resolveConfiguredDeviceSyncConnectTarget(
    readConfiguredDeviceSyncProviderConfigs(process.env),
    intent.connectTarget,
  );

  if (
    !target
    || target.provider !== intent.provider
    || target.connectSourceId !== intent.connectSourceId
    || (target.sourceProviderSlug ?? null) !== intent.sourceProviderSlug
  ) {
    return null;
  }

  return target;
}

function describeUnavailableIntentStatus(status: string): string {
  if (status === "expired") {
    return "This connection link has expired. Ask Murph for a new one.";
  }

  if (status === "owner_mismatch") {
    return "This connection link belongs to a different Murph account.";
  }

  if (status === "used") {
    return "This connection link was already used. Ask Murph for a new one.";
  }

  return "This connection link could not be found. Ask Murph for a new one.";
}

function handleHostedDeviceConnectIntentError(error: unknown): Response {
  if (error instanceof InvalidRouteParamEncodingError) {
    return deviceConnectIntentHtml(
      "Connection link unavailable",
      "This connection link is invalid. Ask Murph for a new one.",
      400,
    );
  }

  if (isDeviceSyncError(error)) {
    return deviceConnectIntentHtml("Connection failed", error.message, error.httpStatus);
  }

  if (isHostedOnboardingError(error)) {
    return deviceConnectIntentHtml("Connection failed", error.message, error.httpStatus);
  }

  console.error("Hosted device connect intent failed unexpectedly.", {
    errorType: describeHostedDeviceConnectIntentErrorType(error),
  });

  return deviceConnectIntentHtml(
    "Connection failed",
    "Something went wrong while starting the device connection. Please retry from Murph.",
    500,
  );
}

function deviceConnectIntentConfirmHtml(providerLabel: string): Response {
  return htmlResponse(
    "Connect device",
    `<form method="post">
      <h1>Connect ${escapeHtml(providerLabel)}</h1>
      <p>Continue to ${escapeHtml(providerLabel)} to authorize Murph.</p>
      <button type="submit">Continue</button>
    </form>`,
  );
}

function deviceConnectIntentHtml(title: string, message: string, status = 200): Response {
  return htmlResponse(
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`,
    status,
  );
}

function htmlResponse(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: Canvas; color: CanvasText; }
    main { width: min(100%, 420px); }
    h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.15; }
    p { margin: 0 0 20px; color: color-mix(in srgb, CanvasText 76%, transparent); line-height: 1.5; }
    button { width: 100%; border: 0; border-radius: 8px; padding: 13px 16px; font: inherit; font-weight: 650; color: white; background: #0f766e; cursor: pointer; }
    button:focus-visible { outline: 3px solid color-mix(in srgb, #0f766e 45%, transparent); outline-offset: 3px; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function redirectNoReferrer(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: location,
      "Referrer-Policy": "no-referrer",
    },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function describeHostedDeviceConnectIntentErrorType(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor?.name || error.name || "Error";
  }

  return error === null ? "null" : typeof error;
}
