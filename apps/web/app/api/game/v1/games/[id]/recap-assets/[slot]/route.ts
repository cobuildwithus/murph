import { requireGameMember } from "@/src/lib/game/http/auth";
import { gameNotFound } from "@/src/lib/game/http/errors";
import { readAuthorizedRecapAsset } from "@/src/lib/game/recap-asset-access";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (request: Request, context: { params: Promise<{ id: string; slot: string }> }) => {
  const memberId = await requireGameMember(request);
  const { id: gameId, slot } = await context.params;
  const generationId = new URL(request.url).searchParams.get("generation") ?? "";
  const asset = await readAuthorizedRecapAsset({ memberId, gameId, generationId, slot });
  if (!asset) throw gameNotFound();
  return new Response(new Uint8Array(asset.bytes), { headers: { "content-type": asset.contentType, "content-length": String(asset.bytes.length),
    "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
});
