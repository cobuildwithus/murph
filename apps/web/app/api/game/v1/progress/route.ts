import { withProgressReadTiming, type ProgressReadTiming } from "@/src/lib/game/progress/read-timing";
import { clientUnits } from "@/src/lib/companion/client-info";
import { requireGameMemberAuth, assertGameMemberAuthCurrentTx } from "@/src/lib/game/http/auth";
import { readProgress } from "@/src/lib/game/progress/view";
import { scheduleProgressSettlement } from "@/src/lib/game/progress/settlement";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";
import { progressEffect, withProgressJsonError } from "@/src/lib/game/progress/http";

export const GET = withProgressReadTiming("/api/game/v1/progress", withProgressJsonError(async (request: Request, timing: ProgressReadTiming) => {
  const auth = await timing.measure("auth", () => requireGameMemberAuth(request));
  const units = clientUnits(request);
  const view = await progressEffect(() => readProgress(auth.member.id, units, tx => assertGameMemberAuthCurrentTx(auth, tx), timing));
  if (!view.incomplete) scheduleProgressSettlement(auth);
  return timing.measure("render", () => jsonOk(view, 200, { "Cache-Control": "private, no-store" }));
}));
