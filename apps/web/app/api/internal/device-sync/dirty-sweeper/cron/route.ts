import {
  runHostedDeviceSyncRecoverySweep,
} from "@/src/lib/device-sync/recovery-sweeper";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  return jsonOk(await runHostedDeviceSyncRecoverySweep());
});
