import { requireGameMember } from "@/src/lib/game/http/auth";
import { readGameInviteForMember } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  const token = await readGameInviteForMember(await requireGameMember(request));
  return jsonOk({ ok: true, token }, 200, { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
});
