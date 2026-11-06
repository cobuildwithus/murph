import { respondToGameCommand } from "@/src/lib/game/http/command-route";
import { withUnlockedPhotoDeliveries } from "@/src/lib/game/http/media-routes";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

// `?delivery=signed`: the answer also carries signed URLs for the pictures this post unlocked.
export const POST = withJsonError(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const gameId = await resolveDecodedRouteParam(context.params, "id");
  const signed = new URL(request.url).searchParams.get("delivery") === "signed";
  return respondToGameCommand(request, (body) => ({ ...body, gameId, type: "post" }), {
    body: true,
    ...(signed ? { answer: (game, { command, memberId }) =>
      withUnlockedPhotoDeliveries(game, { entryId: String(command.entryId), memberId }) } : {}),
  });
});
