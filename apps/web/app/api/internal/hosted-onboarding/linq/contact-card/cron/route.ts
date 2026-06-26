import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { reconcileHostedLinqContactCards } from "@/src/lib/hosted-onboarding/linq-contact-card";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const result = await reconcileHostedLinqContactCards({
    prisma: getPrisma(),
    signal: request.signal,
  });

  return jsonOk({
    linqContactCards: result,
  });
});
