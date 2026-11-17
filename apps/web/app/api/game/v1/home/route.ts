import { readAppReviewGamePhoto } from "@/app/app-review-game-photos";
import { hasGameMultiplayer } from "@/src/lib/game/http/capability";
import { isHostedAuthReviewMember } from "@/src/lib/better-auth/review-account";
import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { withLockedPreviewDeliveries } from "@/src/lib/game/http/media-routes";
import { readHome } from "@/src/lib/game/service";
import { refreshAppReviewGameForHome } from "@/src/lib/hosted-ops/app-review-game";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

// `?delivery=signed`: today's locked pictures also come signed, for the app to keep ready.
export const GET = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const memberId = auth.member.id;
  const multiplayer = hasGameMultiplayer(request);
  const [initialHome, reviewMember] = await Promise.all([
    readHome(memberId, multiplayer, auth),
    isHostedAuthReviewMember({ memberId, prisma: getPrisma() }),
  ]);
  const home = reviewMember && await refreshAppReviewGameForHome({ memberId, homeGameIds: initialHome.games.map(game => game.id), readPhoto: readAppReviewGamePhoto })
    ? await readHome(memberId, multiplayer, auth) : initialHome;
  const signed = new URL(request.url).searchParams.get("delivery") === "signed";
  return jsonOk({ ok: true, ...(signed ? await withLockedPreviewDeliveries(home, memberId) : home) });
});
