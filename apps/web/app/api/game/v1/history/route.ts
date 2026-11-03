import { hasGameMultiplayer } from "@/src/lib/game/http/capability";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { requireGameMember } from "@/src/lib/game/http/auth";
import { withHistoryPhotoDeliveries } from "@/src/lib/game/http/media-routes";
import { readHistory } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request) => {
  // Reuse exact member roots across auth and hydration; the scope wipes them
  // before signing, and every request still reads current session/authority rows.
  const { memberId, view } = await runWithHostedDomainRootUnwrapCache(async () => {
    const memberId = await requireGameMember(request);
    return { memberId, view: await readHistory(memberId, hasGameMultiplayer(request)) };
  });
  const history = await withHistoryPhotoDeliveries(view, memberId);
  return jsonOk({ ok: true, ...history }, 200, { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
});
