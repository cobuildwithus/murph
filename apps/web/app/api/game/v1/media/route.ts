import { requireGameMember } from "@/src/lib/game/http/auth";
import { uploadGameMedia } from "@/src/lib/game/http/media-routes";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireGameMember(request);
  return jsonOk({ ok: true, mediaKey: await uploadGameMedia({ memberId, request }) });
});
