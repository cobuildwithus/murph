import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  isHostedGroupMembershipEpochActive,
} from "@/src/lib/hosted-groups/group-store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";

const BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const membershipId = readRequiredString(body.membershipId, "membershipId");
  const joinedAtValue = readRequiredString(body.joinedAt, "joinedAt");
  const joinedAt = new Date(joinedAtValue);
  if (!Number.isFinite(joinedAt.valueOf()) || joinedAt.toISOString() !== joinedAtValue) {
    throw new TypeError("Hosted group membership epoch joinedAt is invalid.");
  }

  return jsonOk({
    active: await isHostedGroupMembershipEpochActive({
      joinedAt,
      memberId,
      membershipId,
    }),
    ok: true,
  });
});

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Hosted group membership epoch ${label} is invalid.`);
  }
  return value;
}
