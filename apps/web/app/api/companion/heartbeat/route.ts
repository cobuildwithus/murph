import { companionHeartbeatSchema } from "@murphai/hosted-execution/companion-presence";
import { readRawBodyBuffer } from "@/src/lib/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { getPrisma } from "@/src/lib/prisma";
import { recordCompanionHeartbeat } from "@/src/lib/companion/presence";

export const POST = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, getPrisma());
  const body = await readRawBodyBuffer(request, { limitBytes: 128 });
  const parsed = companionHeartbeatSchema.safeParse(JSON.parse(body.toString("utf8")));
  if (!parsed.success) throw new TypeError("Invalid companion heartbeat.");
  await recordCompanionHeartbeat(auth.member.id, parsed.data.state);
  return jsonOk({ recorded: true });
});
