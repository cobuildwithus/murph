import { runHostedDeviceSyncDirtySweeper } from "@/src/lib/device-sync/dirty-sweeper";
import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const sweeper = await runHostedDeviceSyncDirtySweeper();

  return jsonOk({
    sweeper,
  });
});
