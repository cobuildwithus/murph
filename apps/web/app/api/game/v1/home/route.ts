import { requireGameMember } from "@/src/lib/game/http/auth";
import { readHome } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  const memberId = await requireGameMember(request);
  return jsonOk({ ok: true, ...(await readHome(memberId)) });
});
