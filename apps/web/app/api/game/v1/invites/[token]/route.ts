import { gameHttpError } from "@/src/lib/game/http/errors";
import { readInvitePreview } from "@/src/lib/game/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

// No sign-in: the invitee opens this before they have an account.
export const GET = withJsonError(async (
  _request: Request,
  context: { params: Promise<{ token: string }> },
) => {
  const preview = await readInvitePreview(await resolveDecodedRouteParam(context.params, "token"));
  if (!preview) throw gameHttpError("INVITE_NOT_FOUND", 404, "That invite isn't available.");
  return jsonOk({ ok: true, preview });
});
