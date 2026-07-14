import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  readHostedMemberRoutingState,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readActiveHostedMemberAccess } from "@/src/lib/hosted-onboarding/member-access";

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

  const prisma = getPrisma();
  const [access, routing] = await Promise.all([
    readActiveHostedMemberAccess({ memberId, prisma }),
    readHostedMemberRoutingState({ memberId, prisma }),
  ]);
  return jsonOk({
    authorized: Boolean(
      access
      && routing?.telegramThreadId === serializeTelegramThreadTarget(target),
    ),
  });
});
