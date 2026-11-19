import { requireGameMember } from "@/src/lib/game/http/auth";
import { withRetryableServerFailures } from "@/src/lib/hosted-onboarding/errors";
import { uploadGameMedia } from "@/src/lib/game/http/media-routes";
import { GameRequestTiming } from "@/src/lib/game/http/timing";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const timing = new GameRequestTiming("game.media.upload.timing");
  let ok = false;
  try {
    const memberId = await timing.measure("auth", () => withRetryableServerFailures(() => requireGameMember(request)));
    const mediaKey = await uploadGameMedia({ memberId, request, timing });
    ok = true;
    return jsonOk({ ok: true, mediaKey });
  } finally {
    timing.log({ ok, bytes: Number(request.headers.get("content-length")) || 0 });
  }
});
