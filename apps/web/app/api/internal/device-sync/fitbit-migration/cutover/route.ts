import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  parseHostedExecutionDeviceSyncFitbitMigrationCutoverRequest,
} from "@murphai/device-syncd/hosted-runtime";

const HOSTED_DEVICE_SYNC_FITBIT_CUTOVER_BODY_LIMIT_BYTES = 4 * 1024;

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Hosted Fitbit migration cutover only allows signed POST requests.",
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
    maxBodyBytes: HOSTED_DEVICE_SYNC_FITBIT_CUTOVER_BODY_LIMIT_BYTES,
  });
  const parsed = parseHostedExecutionDeviceSyncFitbitMigrationCutoverRequest(
    await request.json(),
  );
  return jsonOk(
    await createHostedDeviceSyncPublicIngressService(request)
      .completeGoogleHealthFitbitMigration(userId, parsed.connectionId),
  );
});
