import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import {
  isHostedTelegramDeliveryTargetAuthorizedTx,
} from "@/src/lib/hosted-onboarding/telegram-egress-authorization";

const HOSTED_TELEGRAM_DELIVERY_AUTHORIZATION_BODY_LIMIT_BYTES = 2 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_TELEGRAM_DELIVERY_AUTHORIZATION_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const serializedTarget = typeof body.deliveryTarget === "string"
    ? body.deliveryTarget.trim()
    : "";
  const target = parseTelegramThreadTarget(serializedTarget);
  if (!target) {
    return jsonOk({ authorized: false });
  }
  const replyToMessageId = typeof body.replyToMessageId === "string"
    ? body.replyToMessageId.trim()
    : "";

  const prisma = getPrisma();
  const deliveryTarget = serializeTelegramThreadTarget(target);
  const authorized = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, memberId);
    return await isHostedTelegramDeliveryTargetAuthorizedTx({
      deliveryTarget,
      memberId,
      prisma: tx,
      replyToMessageId: replyToMessageId || null,
    });
  });
  return jsonOk({
    authorized,
  });
});
