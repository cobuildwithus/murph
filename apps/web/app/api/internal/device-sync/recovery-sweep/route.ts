import { runClinicalDailySyncSweep } from "@/src/lib/clinical-records/daily-sync";
import {
  HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/routes";

import {
  runHostedDeviceSyncRecoverySweep,
} from "@/src/lib/device-sync/recovery-sweeper";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_MAX_BODY_BYTES = 4 * 1024;

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted internal device-sync recovery sweep routes only allow POST because the callback request is signed over the JSON body.",
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
  const callbackUserId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_MAX_BODY_BYTES,
  });

  if (callbackUserId !== HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_CALLBACK_USER_ID) {
    throw hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      message: "Hosted Cloudflare callback is not authorized.",
      httpStatus: 401,
    });
  }

  const [devices, clinical] = await Promise.allSettled([
    runHostedDeviceSyncRecoverySweep(), runClinicalDailySyncSweep(),
  ]);
  if (devices.status === "rejected") throw devices.reason;
  if (clinical.status === "rejected" || clinical.value.failed > 0) {
    throw hostedOnboardingError({ code: "CLINICAL_RECORD_DAILY_ADMISSION_FAILED", httpStatus: 503,
      message: "Some daily medical-record checks could not be scheduled." });
  }
  return jsonOk(devices.value);
});
