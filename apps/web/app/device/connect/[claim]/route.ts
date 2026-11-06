import { isDeviceSyncError } from "@murphai/device-syncd/errors";
import {
  isDeviceConnectSourceAvailableForConnection,
  listConfiguredDeviceSyncConnectTargets,
  readConfiguredDeviceSyncConnectTargetConfigs,
} from "@murphai/device-syncd/connect-config";

import { buildHostedDeviceConnectCompletionReturnTo } from "@/src/lib/device-sync/connect-completion-return";
import {
  claimHostedDeviceConnectIntentForStart,
  readHostedDeviceConnectIntent,
  releaseHostedDeviceConnectIntentStart,
  type HostedDeviceConnectIntentRecord,
} from "@/src/lib/device-sync/connect-intents";
import { startHostedDeviceSyncConnection } from "@/src/lib/device-sync/hosted-connect-start";
import { jsonError, jsonOk } from "@/src/lib/device-sync/settings-http";
import {
  requireActiveHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  InvalidRouteParamEncodingError,
  resolveDecodedRouteParam,
} from "@/src/lib/http";

const DEAD_LINK_TITLE = "This link isn’t working.";
const FAILED_LINK_TITLE = "Something went wrong.";

export async function GET(
  request: Request,
  context: { params: Promise<{ claim: string }> },
): Promise<Response> {
  try {
    const claim = await resolveDecodedRouteParam(context.params, "claim");
    const result = await readHostedDeviceConnectIntent(claim);

    if (result.status !== "available") {
      return deviceConnectIntentMessageResponse(request, {
        code: `HOSTED_DEVICE_CONNECT_INTENT_${result.status.toUpperCase()}`,
        message: describeUnavailableIntentStatus(result.status),
        status: 410,
        ...describeDeadLink(result.status),
      });
    }

    const target = resolveHostedDeviceConnectIntentTarget(result.intent);
    if (!target) {
      return deviceConnectIntentMessageResponse(request, {
        code: "HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED",
        detail: "This device connection is not available right now.",
        message: "This device connection is not available right now.",
        status: 404,
        title: DEAD_LINK_TITLE,
      });
    }

    return redirectNoReferrer(buildHostedDeviceConnectPageUrl({
      claim,
      connectSourceId: result.intent.connectSourceId,
      request,
    }));
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
      return deviceConnectIntentMessageResponse(request, {
        code: `HOSTED_DEVICE_CONNECT_INTENT_${claimed.status.toUpperCase()}`,
        message: describeUnavailableIntentStatus(claimed.status),
        status: claimed.status === "owner_mismatch" ? 403 : 410,
        ...describeDeadLink(claimed.status),
      });
    }

    const target = resolveHostedDeviceConnectIntentTarget(claimed.intent);
    if (!target) {
      await releaseHostedDeviceConnectIntentStart({
        claim,
        memberId: session.member.id,
      });
      return deviceConnectIntentMessageResponse(request, {
        code: "HOSTED_DEVICE_CONNECT_SOURCE_NOT_CONFIGURED",
        detail: "This device connection is not available right now.",
        message: "This device connection is not available right now.",
        status: 404,
        title: DEAD_LINK_TITLE,
      });
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

    return deviceConnectIntentStartResponse(
      request,
      started.authorizationUrl,
      started.callbackProofCookie,
    );
  } catch (error) {
    return handleHostedDeviceConnectIntentError(error, request);
  }
}

function resolveHostedDeviceConnectIntentTarget(intent: HostedDeviceConnectIntentRecord) {
  return listConfiguredDeviceSyncConnectTargets(
    readConfiguredDeviceSyncConnectTargetConfigs(process.env),
  ).find((target) =>
    isDeviceConnectSourceAvailableForConnection(target.connectSourceId)
    && target.provider === intent.provider
    && target.connectSourceId === intent.connectSourceId
    && target.connectTarget === intent.connectTarget
    && (target.sourceProviderSlug ?? null) === intent.sourceProviderSlug
  ) ?? null;
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

// The page a person sees; the JSON above keeps its own sentences for the app.
function describeDeadLink(status: string): { detail: string; title: string } {
  if (status === "expired") {
    return {
      detail: "Nothing changed. Ask Murph for a new one.",
      title: "This link expired.",
    };
  }

  if (status === "owner_mismatch") {
    return {
      detail: "It belongs to a different Murph account.",
      title: DEAD_LINK_TITLE,
    };
  }

  return {
    detail: status === "used"
      ? "It was already used. Ask Murph for a new one."
      : "Ask Murph for a new one.",
    title: DEAD_LINK_TITLE,
  };
}

function buildHostedDeviceConnectPageUrl(input: {
  claim: string;
  connectSourceId: string;
  request: Request;
}): string {
  const url = new URL("/connect", new URL(input.request.url).origin);
  const fragment = new URLSearchParams();
  fragment.set("deviceConnectIntent", input.claim);
  fragment.set("connectSource", input.connectSourceId);
  url.hash = fragment.toString();
  return `${url.pathname}${url.hash}`;
}

function handleHostedDeviceConnectIntentError(error: unknown, request?: Request): Response {
  if (request && wantsJsonDeviceConnectIntentResponse(request)) {
    return jsonError(error);
  }

  if (error instanceof InvalidRouteParamEncodingError) {
    return deviceConnectIntentHtml(DEAD_LINK_TITLE, "Ask Murph for a new one.", 400);
  }

  if (isDeviceSyncError(error)) {
    return deviceConnectIntentHtml(FAILED_LINK_TITLE, error.message, error.httpStatus);
  }

  if (isHostedOnboardingError(error)) {
    return deviceConnectIntentHtml(FAILED_LINK_TITLE, error.message, error.httpStatus);
  }

  console.error("Hosted device connect intent failed unexpectedly.", {
    errorType: describeHostedDeviceConnectIntentErrorType(error),
  });

  return deviceConnectIntentHtml(
    FAILED_LINK_TITLE,
    "Nothing changed. Try again in a moment.",
    500,
  );
}

function deviceConnectIntentStartResponse(
  request: Request,
  authorizationUrl: string,
  callbackProofCookie: string,
): Response {
  if (wantsJsonDeviceConnectIntentResponse(request)) {
    const response = jsonOk({
      authorizationUrl,
    });
    response.headers.append("Set-Cookie", callbackProofCookie);
    return response;
  }

  const response = redirectNoReferrer(authorizationUrl);
  response.headers.append("Set-Cookie", callbackProofCookie);
  return response;
}

function deviceConnectIntentMessageResponse(
  request: Request,
  input: {
    code: string;
    detail: string;
    message: string;
    status: number;
    title: string;
  },
): Response {
  if (wantsJsonDeviceConnectIntentResponse(request)) {
    return Response.json({
      error: {
        code: input.code,
        message: input.message,
        retryable: false,
      },
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
      status: input.status,
    });
  }

  return deviceConnectIntentHtml(input.title, input.detail, input.status);
}

function deviceConnectIntentHtml(title: string, message: string, status = 200): Response {
  return htmlResponse(
    title,
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`,
    status,
  );
}

// This route answers before any page exists, so it draws the shared dead link
// (`LinkPageScreen`) itself. Next's fonts have no stable URL, hence the fallbacks.
function htmlResponse(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#1C1915">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: "DM Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    html, body { background: #1C1915; }
    body { margin: 0; min-height: 100dvh; color: #FFFCF6; }
    main { box-sizing: border-box; width: min(100%, 26rem); margin: 0 auto; padding: 12px 24px 24px; }
    img { display: block; height: 25px; width: auto; margin: 9.5px 0; }
    h1 { margin: 0; padding-top: 20px; font-family: Fraunces, Georgia, "Times New Roman", serif; font-size: 40px; font-weight: 600; line-height: 44px; letter-spacing: -0.02em; overflow-wrap: anywhere; text-wrap: balance; }
    p { margin: 10px 0 0; font-size: 16px; font-weight: 500; line-height: 22px; color: rgb(255 252 246 / 0.6); }
  </style>
</head>
<body>
  <main><img alt="Murph" src="/logo-dark.svg">${body}</main>
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

function wantsJsonDeviceConnectIntentResponse(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept
    .split(",")
    .some((entry) => entry.trim().toLowerCase().startsWith("application/json"));
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
