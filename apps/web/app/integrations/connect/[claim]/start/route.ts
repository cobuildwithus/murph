import { startHostedConnectedAppConnection } from "@/src/lib/connected-apps/service";
import {
  requireActiveHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  InvalidRouteParamEncodingError,
  resolveDecodedRouteParam,
} from "@/src/lib/http";

// The client fetches this endpoint and navigates the browser itself via
// `window.location.href`. A server-issued 303 to the OAuth provider would be
// blocked by the page's `form-action 'self'` CSP (which applies through
// redirects), so the contract here is JSON only: success returns the provider
// URL, failure returns a non-2xx so the client can re-render the page.
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
    return jsonResponse({ redirectUrl: started.redirectUrl }, 200);
  } catch (error) {
    if (
      !(error instanceof InvalidRouteParamEncodingError)
      && !isHostedOnboardingError(error)
    ) {
      console.error("Connected-app start failed unexpectedly.", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
    const status = isHostedOnboardingError(error) ? error.httpStatus : 500;
    return jsonResponse({ error: "connection_unavailable" }, status);
  }
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
    },
    status,
  });
}
