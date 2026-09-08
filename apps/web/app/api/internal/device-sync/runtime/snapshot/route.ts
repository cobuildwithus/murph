import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";
import { HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_BYTES_HEADER } from "@murphai/device-syncd/hosted-runtime";

import { readHostedDeviceSyncRuntimeState } from "@/src/lib/device-sync/hosted-runtime-authority";
import { withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";

const HOSTED_DEVICE_SYNC_SNAPSHOT_CALLBACK_BODY_LIMIT_BYTES = 256 * 1024;

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted internal device-sync runtime snapshot routes only allow POST because the callback request is signed over the JSON body.",
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
    maxBodyBytes: HOSTED_DEVICE_SYNC_SNAPSHOT_CALLBACK_BODY_LIMIT_BYTES,
  });
  // Serialize once, retaining jsonOk's status, JSON MIME type and no-store policy.
  const body = JSON.stringify(await readHostedDeviceSyncRuntimeState({
    request,
    trustedUserId: userId,
  }));
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      [HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_BYTES_HEADER]:
        String(Buffer.byteLength(body, "utf8")),
    },
  });
});
