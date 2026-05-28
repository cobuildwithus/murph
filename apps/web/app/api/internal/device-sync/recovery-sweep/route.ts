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

  return jsonOk(withLegacyRecoverySweepAliases(
    await runHostedDeviceSyncRecoverySweep(),
  ));
});

type HostedDeviceSyncRecoverySweepResult =
  Awaited<ReturnType<typeof runHostedDeviceSyncRecoverySweep>>;

function withLegacyRecoverySweepAliases(result: HostedDeviceSyncRecoverySweepResult) {
  // Keep old count aliases while hosted web and Temporal deploy independently.
  return {
    dueReconcileSweeper: {
      ...result.dueReconcileSweeper,
      wakeAppended: result.dueReconcileSweeper.recoveryRequested,
      wakeAttempted: result.dueReconcileSweeper.recoveryAttempted,
      wakeDuplicate: 0,
      wakeFailed: result.dueReconcileSweeper.recoveryFailed,
      wakeLimit: result.dueReconcileSweeper.recoveryLimit,
      wakeNotAppended: result.dueReconcileSweeper.recoveryNotRequested,
    },
    sweeper: {
      ...result.sweeper,
      skippedDirtyConnections: result.sweeper.skippedDirtyUsers,
      wakeAppended: result.sweeper.recoveryRequested,
      wakeAttempted: result.sweeper.recoveryAttempted,
      wakeDuplicate: 0,
      wakeFailed: result.sweeper.recoveryFailed,
      wakeLimit: result.sweeper.recoveryLimit,
      wakeNotAppended: result.sweeper.recoveryNotRequested,
    },
  };
}
