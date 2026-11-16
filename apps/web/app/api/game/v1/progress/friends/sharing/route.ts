import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { parseSetSharingBody } from "@/src/lib/game/progress/contract";
import { setProgressFriendSharing } from "@/src/lib/game/progress/friends-reader";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const PUT = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  const body = parseSetSharingBody(await readJsonObject(request, { limitBytes: 128 * 1024 }));
  return jsonOk(await setProgressFriendSharing(auth, body, request.signal), 200, { "Cache-Control": "private, no-store" });
});
