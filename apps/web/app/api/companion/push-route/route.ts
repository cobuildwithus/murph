import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readRawBodyBuffer } from "@/src/lib/http";
import {
  companionPushRouteDeletionSchema, companionPushRouteRegistrationSchema,
  deleteCompanionPushRoute, registerCompanionPushRoute,
} from "@/src/lib/companion/push-route";
import { requireActiveHostedMemberAuthFromBearerToken, requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, getPrisma());
  const body = await readRawBodyBuffer(request, { limitBytes: 1_024 });
  const parsed = companionPushRouteRegistrationSchema.safeParse(JSON.parse(body.toString("utf8")));
  if (!parsed.success) throw new TypeError("Invalid companion push route.");
  await registerCompanionPushRoute(auth.member.id, parsed.data);
  return jsonOk({ registered: true });
});

// Authority-reducing: available without an active entitlement or consent.
export const DELETE = withJsonError(async (request: Request) => {
  const auth = await requireHostedMemberAuthFromBearerToken(request, getPrisma());
  const body = await readRawBodyBuffer(request, { limitBytes: 256 });
  const parsed = companionPushRouteDeletionSchema.safeParse(JSON.parse(body.toString("utf8")));
  if (!parsed.success) throw new TypeError("Invalid companion push route deletion.");
  await deleteCompanionPushRoute(auth.member.id, parsed.data.installationId);
  return jsonOk({ deleted: true });
});
