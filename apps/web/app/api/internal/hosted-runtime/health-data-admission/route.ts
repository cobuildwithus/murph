import {
  parseHostedRuntimeHealthDataAdmissionResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  resolveHostedHealthDataConsentState,
} from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_BODY_LIMIT_BYTES,
  });
  const member = await getPrisma().hostedMember.findUnique({
    select: {
      consentGrants: {
        select: {
          scope: true,
          status: true,
        },
        where: {
          scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
        },
      },
      suspendedAt: true,
    },
    where: {
      id: userId,
    },
  });
  const consentState = resolveHostedHealthDataConsentState(
    member?.consentGrants,
  );

  return jsonOk(parseHostedRuntimeHealthDataAdmissionResponse({
    consentState,
    processingAllowed:
      member?.suspendedAt === null && consentState !== "revoked",
    userId,
  }));
});
