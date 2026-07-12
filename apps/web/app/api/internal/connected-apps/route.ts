import {
  hostedConnectedAppsRequestSchema,
  hostedConnectedAppsResponseSchema,
  type HostedConnectedAppsRequest,
} from "@murphai/hosted-execution/connected-apps";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  isHostedThreadContainerMember,
  readActiveHostedMemberAccess,
} from "@/src/lib/hosted-onboarding/member-access";
import { isHostedConnectedAppsServiceTool } from "@/src/lib/connected-apps/config";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
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
  if (
    await isHostedThreadContainerMember({ memberId, prisma: getPrisma() })
    && !isGroupSafeConnectedAppsRequest(parsed.data)
  ) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED",
      httpStatus: 403,
      message: "Personal connected apps are unavailable in a group chat.",
    });
  }

  const result = await executeHostedConnectedAppsRequest({
    memberId,
    request: parsed.data,
  });
  return jsonOk(hostedConnectedAppsResponseSchema.parse({ result }));
});

function isGroupSafeConnectedAppsRequest(
  request: HostedConnectedAppsRequest,
): boolean {
  if (request.operation === "search") {
    return true;
  }
  return request.operation === "execute"
    && request.input.account === undefined
    && request.input.agentApproved === undefined
    && isHostedConnectedAppsServiceTool(request.input.toolSlug);
}

async function requireConnectedAppsActiveMember(memberId: string): Promise<void> {
  if (await readActiveHostedMemberAccess({ memberId, prisma: getPrisma() })) {
    return;
  }
  throw hostedOnboardingError({
    code: "CONNECTED_APPS_MEMBER_INACTIVE",
    httpStatus: 403,
    message: "Connected apps are unavailable for this Murph account.",
  });
}
