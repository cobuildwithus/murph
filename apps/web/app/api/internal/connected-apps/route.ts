import {
  hostedConnectedAppsRequestSchema,
  hostedConnectedAppsResponseSchema,
} from "@murphai/hosted-execution/connected-apps";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hasHostedMemberEffectiveActiveAccessForMember,
} from "@/src/lib/hosted-onboarding/family-plan";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { executeHostedConnectedAppsRequest } from "@/src/lib/connected-apps/service";
import { getPrisma } from "@/src/lib/prisma";

const CONNECTED_APPS_CALLBACK_BODY_LIMIT_BYTES = 256 * 1024;

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Connected-app runtime operations only allow POST.",
    },
  }, {
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
    },
    status: 405,
  });
}

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: CONNECTED_APPS_CALLBACK_BODY_LIMIT_BYTES,
  });
  await requireConnectedAppsActiveMember(memberId);
  const parsed = hostedConnectedAppsRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_REQUEST_INVALID",
      httpStatus: 400,
      message: "The connected-app request is invalid.",
    });
  }

  const result = await executeHostedConnectedAppsRequest({
    memberId,
    request: parsed.data,
  });
  return jsonOk(hostedConnectedAppsResponseSchema.parse({ result }));
});

async function requireConnectedAppsActiveMember(memberId: string): Promise<void> {
  const prisma = getPrisma();
  const member = await readHostedMemberCoreState({
    memberId,
    prisma,
  });
  if (
    member &&
    await hasHostedMemberEffectiveActiveAccessForMember({
      member,
      prisma,
    })
  ) {
    return;
  }
  throw hostedOnboardingError({
    code: "CONNECTED_APPS_MEMBER_INACTIVE",
    httpStatus: 403,
    message: "Connected apps are unavailable for this Murph account.",
  });
}
