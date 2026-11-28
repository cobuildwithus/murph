import * as z from "@murphai/contracts/zod-runtime";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import { clientUnits } from "../companion/client-info";
import { withHealthRoute } from "../health-wins/http";
import { readHealthBody } from "../health-wins/request";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk } from "../hosted-onboarding/http";
import { getPrisma } from "../prisma";
import { advanceMark, readNotifications } from "./read";

const seenBody = z.strictObject({ through: z.iso.datetime({ offset: true }) });

export function notificationRoute(mode: "list" | "unread" | "seen") {
  return withHealthRoute(async (request, auth) => {
    const budget = await hostedAuthRateLimitStorage(getPrisma()).consume(
      `health-notifications:member:${auth.member.id}`, { max: 120, window: 60 },
    );
    if (!budget.allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429,
      retryable: true, message: "Wait a moment before checking notifications again." });
    if (mode === "seen") {
      const { through } = await readHealthBody(request, seenBody);
      await advanceMark(auth, new Date(through));
    }
    return jsonOk(await readNotifications(auth, request.signal, clientUnits(request), mode !== "list"));
  });
}
