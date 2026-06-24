import {
  buildConnectedAppCompletionHomeRedirectHref,
} from "@/src/lib/connected-apps/connect-completion";
import {
  completeHostedConnectedAppConnection,
} from "@/src/lib/connected-apps/service";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

// Composio callback target. On any outcome we redirect to /home with a
// completion marker so the existing home dialog (shared with device-sync)
// shows "<Account> is connected" or the matching failure state.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const claim = url.searchParams.get("claim") ?? "";
  const status = url.searchParams.get("status");
  const connectedAccountId = url.searchParams.get("connected_account_id") ?? "";

  if (status !== "success" || !claim || !connectedAccountId) {
    return redirectToHome({ status: "error" });
  }

  try {
    const completed = await completeHostedConnectedAppConnection({
      claim,
      connectedAccountId,
    });
    return redirectToHome({
      alias: completed.intent.alias ?? null,
      status: "success",
      toolkit: completed.intent.toolkit,
    });
  } catch (error) {
    if (!isHostedOnboardingError(error)) {
      console.error("Connected-app callback failed unexpectedly.", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
    return redirectToHome({ status: "error" });
  }
}

function redirectToHome(input: {
  alias?: string | null;
  status: "success" | "error";
  toolkit?: string | null;
}): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: buildConnectedAppCompletionHomeRedirectHref(input),
      "Referrer-Policy": "no-referrer",
    },
    status: 303,
  });
}
