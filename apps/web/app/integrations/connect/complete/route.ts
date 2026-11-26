import { isDeviceSyncAppConnectReturn } from "@murphai/device-syncd/types";
import { APP_CONNECT_RETURN_URLS } from "@/src/lib/companion/connect-return";
import {
  buildConnectedAppCompletionSettingsRedirectHref,
} from "@/src/lib/connected-apps/connect-completion";
import {
  completeHostedConnectedAppConnection,
} from "@/src/lib/connected-apps/service";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const appReturn = url.searchParams.get("appReturn");
  const claim = url.searchParams.get("claim") ?? "";
  const status = url.searchParams.get("status");
  const connectedAccountId = url.searchParams.get("connected_account_id") ?? "";

  if (status !== "success" || !claim || !connectedAccountId) {
    return redirectAfterCompletion(appReturn, { status: "error" });
  }

  try {
    const completed = await completeHostedConnectedAppConnection({
      claim,
      connectedAccountId,
    });
    return redirectAfterCompletion(appReturn, {
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
    return redirectAfterCompletion(appReturn, { status: "error" });
  }
}

function redirectAfterCompletion(appReturn: string | null, input: {
  alias?: string | null;
  status: "success" | "error";
  toolkit?: string | null;
}): Response {
  const native = isDeviceSyncAppConnectReturn(appReturn);
  let location: string;
  if (native) {
    const url = new URL(APP_CONNECT_RETURN_URLS[appReturn]);
    if (input.toolkit) url.searchParams.set("app", input.toolkit);
    url.searchParams.set("status", input.status);
    location = url.toString();
  } else {
    location = buildConnectedAppCompletionSettingsRedirectHref(input);
  }
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: location,
      "Referrer-Policy": "no-referrer",
    },
    status: native ? 302 : 303,
  });
}
