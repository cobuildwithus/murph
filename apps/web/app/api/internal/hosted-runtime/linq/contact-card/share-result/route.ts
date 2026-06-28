import {
  parseHostedRuntimeLinqContactCardShareResultRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  recordHostedLinqContactCardShareResult,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "@/src/lib/hosted-onboarding/logging";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_LINQ_CONTACT_CARD_SHARE_RESULT_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_CONTACT_CARD_SHARE_RESULT_BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeLinqContactCardShareResultRequest(
    await readOptionalJsonObject(request),
  );

  try {
    return jsonOk(await recordHostedLinqContactCardShareResult({
      chatId: body.chatId,
      claimId: body.claimId,
      memberId: userId,
      prisma: getPrisma(),
      status: body.status,
    }));
  } catch (error) {
    console.warn(
      "Hosted Linq contact-card share result failed.",
      sanitizeHostedOnboardingStructuredLogDetails({
        chatIdSuffix: toHostedOnboardingLogIdSuffix(body.chatId),
        errorMessage: error instanceof Error ? error.message : null,
        errorName: error instanceof Error ? error.name : null,
        operation: "share_contact_card",
        phase: "record_result",
        provider: "linq",
      }),
    );
    return jsonOk({
      ok: true,
    });
  }
});
