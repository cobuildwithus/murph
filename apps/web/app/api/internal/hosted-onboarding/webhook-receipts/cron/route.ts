import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { pruneHostedWebhookReceiptHistory } from "@/src/lib/hosted-onboarding/webhook-receipt-store";
import { drainHostedOnboardingWebhookReceipts } from "@/src/lib/hosted-onboarding/webhook-service";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);
  const prisma = getPrisma();
  const receipts = await drainHostedOnboardingWebhookReceipts({
    prisma,
  });
  const pruned = await pruneHostedWebhookReceiptHistory({
    prisma,
  });

  return jsonOk({
    continued: receipts.filter((receipt) => receipt.status === "continued").length,
    failed: receipts.filter((receipt) => receipt.status === "failed").length,
    pruned,
    skipped: receipts.filter((receipt) => receipt.status === "skipped").length,
  });
});
