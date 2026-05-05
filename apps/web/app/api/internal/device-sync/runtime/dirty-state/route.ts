import { readHostedDeviceSyncDirtyState } from "@/src/lib/device-sync/hosted-runtime-authority";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted internal device-sync dirty-state routes only allow POST because the callback request is signed over the JSON body.",
    },
  }, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
    },
  });
}

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  return jsonOk(await readHostedDeviceSyncDirtyState({
    request,
    trustedUserId: userId,
  }));
});
