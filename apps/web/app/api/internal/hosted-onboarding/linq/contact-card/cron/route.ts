import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { sendRecoverableHostedLinqAlertsBestEffort } from "@/src/lib/hosted-onboarding/linq-alert-email";
import { reconcileHostedLinqContactCards } from "@/src/lib/hosted-onboarding/linq-contact-card";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const prisma = getPrisma();
  const result = await reconcileHostedLinqContactCards({
    prisma,
    signal: request.signal,
  });
  await sendRecoverableHostedLinqAlertsBestEffort({
    prisma,
  });

  return jsonOk({
    linqContactCards: result,
  });
});
