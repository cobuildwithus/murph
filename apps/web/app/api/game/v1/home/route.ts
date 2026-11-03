import { hasGameMultiplayer } from "@/src/lib/game/http/capability";
import { requireGameMember } from "@/src/lib/game/http/auth";
import { withLockedPreviewDeliveries } from "@/src/lib/game/http/media-routes";
import { readHome } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

// `?delivery=signed`: today's locked pictures also come signed, for the app to keep ready.
export const GET = withJsonError(async (request: Request) => {
  const memberId = await requireGameMember(request);
  const home = await readHome(memberId, hasGameMultiplayer(request));
  const signed = new URL(request.url).searchParams.get("delivery") === "signed";
  return jsonOk({ ok: true, ...(signed ? await withLockedPreviewDeliveries(home, memberId) : home) });
});
