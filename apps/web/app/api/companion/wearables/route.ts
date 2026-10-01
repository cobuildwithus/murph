import { wearableCompanionRequestSchema } from "@murphai/hosted-execution/wearable-haptics";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readRawBodyBuffer } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";
import { exchangeWearableCommands } from "@/src/lib/wearable-haptics/service";

export const POST = withJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, getPrisma());
  const body = await readRawBodyBuffer(request, { limitBytes: 2_048 });
  const parsed = wearableCompanionRequestSchema.safeParse(JSON.parse(body.toString("utf8")));
  if (!parsed.success) throw new TypeError("Invalid wearable command exchange.");
  return jsonOk(await exchangeWearableCommands(auth.member.id, parsed.data));
});
