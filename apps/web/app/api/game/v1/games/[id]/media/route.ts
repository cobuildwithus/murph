import { requireGameMember } from "@/src/lib/game/http/auth";
import { uploadGameMedia } from "@/src/lib/game/http/media-routes";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => {
  const memberId = await requireGameMember(request);
  const mediaKey = await uploadGameMedia({
    gameId: await resolveDecodedRouteParam(context.params, "id"),
    memberId,
    request,
  });
  return jsonOk({ ok: true, mediaKey });
});
