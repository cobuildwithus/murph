import { clinicalReturnQuery, CLINICAL_RETURN_QUERY_LIMIT, isClinicalReturnState } from "@/src/lib/clinical-records/return-query";
import { isDeviceSyncAppConnectReturn } from "@murphai/device-syncd/types";

// Where a provider sends the person after a sign-in the Murph app started.
// This bridge reads no session and no stored state and writes nothing: it only
// hands the provider's short return query to the app's own URL scheme, where
// the sign-in sheet the app opened is waiting. Finishing the connection takes
// the app's bearer credential and the proof its start returned; this URL alone
// finishes nothing.
const APP_CONNECT_RETURN_URLS = {
  ios: "ai.withmurph.app://connect-return",
  "ios-dev": "ai.withmurph.app.dev://connect-return",
} as const;
const APP_CONNECT_RETURN_QUERY_MAX_LENGTH = 2_048;

export async function GET(
  request: Request,
  context: { params: Promise<{ app: string }> },
): Promise<Response> {
  const { app } = await context.params;
  if (!isDeviceSyncAppConnectReturn(app)) {
    return new Response(null, { headers: { "Cache-Control": "no-store" }, status: 404 });
  }

  const url = new URL(request.url);
  let query = url.search.length <= APP_CONNECT_RETURN_QUERY_MAX_LENGTH ? url.search : "";
  if (isClinicalReturnState(url.searchParams.get("state") ?? "")) {
    const params = url.search.length <= CLINICAL_RETURN_QUERY_LIMIT && clinicalReturnQuery(url.searchParams);
    if (!params) return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
    query = `?${params}`;
  }
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: `${APP_CONNECT_RETURN_URLS[app]}${query}`,
      "Referrer-Policy": "no-referrer",
    },
    status: 302,
  });
}
