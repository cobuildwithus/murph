import { formatHostedConnectedAppToolkitLabel } from "@/src/lib/connected-apps/config";
import {
  readHostedConnectedAppIntent,
  startHostedConnectedAppConnection,
} from "@/src/lib/connected-apps/service";
import {
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
    const session = await requireActiveHostedAppSessionFromRequest(request);
    const claim = await resolveDecodedRouteParam(context.params, "claim");
    const intent = await readHostedConnectedAppIntent({ claim });
    if (intent.memberId !== session.member.id) {
      return connectPage(
        "Connection link unavailable",
        "This link is expired, already used, or belongs to another Murph account.",
        null,
        403,
      );
    }
    if (intent.completedAt || intent.startedAt || intent.expiresAt <= new Date()) {
      return connectPage(
        "Connection link unavailable",
        "This link is expired or already used. Ask Murph for a new one.",
        null,
        410,
      );
    }
    const label = formatHostedConnectedAppToolkitLabel(intent.toolkit);
    const accountLabel = intent.alias ? `${intent.alias} ${label}` : label;
    return connectPage(
      `Connect ${accountLabel}`,
      `Continue to securely connect ${accountLabel} to Murph.`,
      "Continue",
    );
  } catch (error) {
    return handleConnectError(error);
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
    const started = await startHostedConnectedAppConnection({
      claim,
      memberId: session.member.id,
    });
    return new Response(null, {
      headers: {
        "Cache-Control": "no-store",
        Location: started.redirectUrl,
        "Referrer-Policy": "no-referrer",
      },
      status: 303,
    });
  } catch (error) {
    return handleConnectError(error);
  }
}

function handleConnectError(error: unknown): Response {
  if (error instanceof InvalidRouteParamEncodingError) {
    return connectPage(
      "Connection link unavailable",
      "This connection link is invalid. Ask Murph for a new one.",
      null,
      400,
    );
  }
  if (isHostedOnboardingError(error)) {
    return connectPage(
      error.httpStatus === 401 ? "Sign in to continue" : "Connection unavailable",
      error.message,
      error.httpStatus === 401 ? "Go home" : null,
      error.httpStatus,
      error.httpStatus === 401 ? "/home" : undefined,
    );
  }
  console.error("Connected-app start failed unexpectedly.", {
    errorType: error instanceof Error ? error.name : typeof error,
  });
  return connectPage(
    "Connection unavailable",
    "Something went wrong. Ask Murph for a new connection link.",
    null,
    500,
  );
}

function connectPage(
  title: string,
  message: string,
  actionLabel: string | null,
  status = 200,
  actionHref?: string,
): Response {
  const action = actionLabel
    ? actionHref
      ? `<a href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>`
      : `<form method="post"><button type="submit">${escapeHtml(actionLabel)}</button></form>`
    : "";
  return htmlResponse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${pageStyle()}
</head>
<body>
  <main>
    <p class="eyebrow">Connected apps</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${action}
  </main>
</body>
</html>`, status);
}

function htmlResponse(html: string, status: number): Response {
  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'unsafe-inline'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

function pageStyle(): string {
  return `<style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f0e8; color: #2d3436; font-family: "DM Sans", system-ui, sans-serif; }
    main { width: min(34rem, calc(100vw - 48px)); padding: 32px 0; }
    .eyebrow { margin: 0 0 12px; color: #736a58; font: 500 10px "DM Mono", ui-monospace, monospace; text-transform: uppercase; }
    h1 { margin: 0; font-family: Fraunces, Georgia, serif; font-size: 2rem; line-height: 1.15; overflow-wrap: anywhere; }
    p { margin: 16px 0 24px; color: #736a58; font-size: 15px; line-height: 1.55; overflow-wrap: anywhere; }
    button, a { min-height: 44px; border: 0; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; background: #5a6e32; color: #fff; font-family: inherit; font-size: 15px; font-weight: 500; padding: 0 20px; text-decoration: none; cursor: pointer; }
  </style>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
