import { after } from "next/server";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
} from "@murphai/device-syncd/hosted-runtime";

import { applyHostedDeviceSyncRuntimeResult } from "@/src/lib/device-sync/hosted-runtime-authority";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted internal device-sync runtime apply routes only allow POST because the callback request is signed over the JSON body.",
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
    maxBodyBytes: HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_BODY_LIMIT_BYTES,
  });
  return jsonOk(await applyHostedDeviceSyncRuntimeResult({
    request,
    scheduleFailureDiagnostics: after,
    trustedUserId: userId,
  }));
});
