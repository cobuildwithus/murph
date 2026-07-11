import { runHostedDeviceSyncAccountAction } from "@/src/lib/device-sync/hosted-runtime-account-action";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";

const HOSTED_DEVICE_SYNC_ACCOUNT_ACTION_BODY_LIMIT_BYTES = 8 * 1024;

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted internal device-sync account actions only allow signed POST requests.",
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
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_DEVICE_SYNC_ACCOUNT_ACTION_BODY_LIMIT_BYTES,
  });
  return jsonOk(await runHostedDeviceSyncAccountAction({
    request,
    trustedUserId: userId,
  }));
});
