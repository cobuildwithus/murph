import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  runCallCircleScheduler,
} from "@/src/lib/call-circle/scheduler";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const result = await runCallCircleScheduler();
  return jsonOk({ result }, 200);
});
