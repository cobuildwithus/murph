import { throwGameAuthError } from "@/src/lib/game/http/auth";
import { readGameInviteForMember } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireHostedMemberAuthFromBearerToken(request, getPrisma()).catch(throwGameAuthError);
  const token = await readGameInviteForMember(auth.member.id);
  return jsonOk({ ok: true, token }, 200, { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
});
