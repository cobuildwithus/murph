import { requireGameMember } from "@/src/lib/game/http/auth";
import { withHistoryPhotoDeliveries } from "@/src/lib/game/http/media-routes";
import { readHistory } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  const memberId = await requireGameMember(request);
  const history = await withHistoryPhotoDeliveries(await readHistory(memberId), memberId);
  return jsonOk({ ok: true, ...history }, 200, { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
});
