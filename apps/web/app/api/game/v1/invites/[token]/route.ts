import { gameHttpError } from "@/src/lib/game/http/errors";
import { readInvitePreview } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireGameMember } from "@/src/lib/game/http/auth";
import { hasGameMultiplayer } from "@/src/lib/game/http/capability";

// No sign-in: the invitee opens this before they have an account.
export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ token: string }> },
) => {
  const token = await resolveDecodedRouteParam(context.params, "token");
  const memberId = request.headers.has("authorization") ? await requireGameMember(request) : undefined;
  const preview = await readInvitePreview(token, hasGameMultiplayer(request), memberId);
  if (!preview) throw gameHttpError("INVITE_NOT_FOUND", 404, "That invite isn't available.");
  return jsonOk({ ok: true, preview }, 200, { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
});
