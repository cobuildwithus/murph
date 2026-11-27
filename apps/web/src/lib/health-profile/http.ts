import * as z from "@murphai/contracts/zod-runtime";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import { clientUnits } from "../companion/client-info";
import { assertHealthYouEnabled } from "../health-wins/flag";
import { withHealthRoute } from "../health-wins/http";
import { healthMemberId, readHealthBody } from "../health-wins/request";
import { invalidGameRequest } from "../game/http/errors";
import { jsonOk } from "../hosted-onboarding/http";
import type { ProfileAuth } from "./access";
import { factors } from "./factors";
import { pinCandidates, setPins } from "./pins";
import { readExtendedProfile } from "./profile";
import { setWorking, setWorkingCheer, workingOptions } from "./working-on";

function route<Args extends unknown[]>(handler: (request: Request, auth: ProfileAuth, ...args: Args) => Promise<unknown>) {
  return withHealthRoute<Args>(async (request, auth, ...args) => {
    assertHealthYouEnabled(auth.member.id);
    const budget = await hostedAuthRateLimitStorage(getPrisma()).consume(`health-profile:member:${auth.member.id}`, { max: 60, window: 60 });
    if (!budget.allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, retryable: true,
      message: "Wait a minute before editing your profile again." });
    return jsonOk(await handler(request, auth, ...args));
  });
}
const picksBody = z.strictObject({ picks: z.array(z.strictObject({ key: z.string().min(1).max(256),
  revision: z.string().min(1).max(256), option: z.string().min(1).max(100).optional() })).max(3)
  .refine(picks => new Set(picks.map(p => p.key)).size === picks.length) });
const factorsBody = z.strictObject({ factors: z.array(z.enum(factors)).max(3).refine(items => new Set(items).size === items.length) });

export const getCandidates = route((req, auth) => pinCandidates(auth, req.signal, clientUnits(req)));
export const getOptions = route((req, auth) => workingOptions(auth, req.signal));
export const putPins = route(async (req, auth) => {
  const { picks } = await readHealthBody(req, picksBody);
  await setPins(auth, picks, req.signal, clientUnits(req));
  return (await readExtendedProfile(auth, auth.member.id, req.signal)).extras;
});
export const putWorking = route(async (req, auth) => {
  const { factors } = await readHealthBody(req, factorsBody);
  await setWorking(auth, factors, req.signal);
  return (await readExtendedProfile(auth, auth.member.id, req.signal)).extras;
});
type CheerContext = { params: Promise<{ memberId: string; factor: string }> };
export const workingCheerRoute = (enabled: boolean) => route(async (_req, auth, context: CheerContext) => {
  const factor = z.enum(factors).safeParse((await context.params).factor);
  if (!factor.success) throw invalidGameRequest("Unknown profile metric.");
  return setWorkingCheer(auth, await healthMemberId(context), factor.data, enabled);
});
