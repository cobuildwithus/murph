import { requireVercelCronRequest } from "@/src/lib/hosted-execution/vercel-cron";
import {
  syncHostedLinqChatHealthInventory,
} from "@/src/lib/hosted-onboarding/linq-chat-health-inventory";
import {
  HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT,
  syncHostedLinqPhoneNumberInventory,
} from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  requireVercelCronRequest(request);

  const prisma = getPrisma();
  const observedAt = new Date();
  const lineInventory = await syncHostedLinqPhoneNumberInventory({
    maxLines: HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT,
    observedAt,
    prisma,
    signal: request.signal,
  });
  const chatInventory = await syncHostedLinqChatHealthInventory({
    observedAt,
    prisma,
    signal: request.signal,
  });

  return jsonOk({
    chatHealthSkippedCount: chatInventory.skippedCount,
    chatHealthSyncedCount: chatInventory.syncedCount,
    lineHealthSyncedCount: lineInventory.syncedCount,
  });
});
