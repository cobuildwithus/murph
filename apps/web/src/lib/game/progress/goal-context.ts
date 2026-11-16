import "server-only";
import type { HostedNativeMemberAuth } from "../../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../../browser-vault/authority";
import { hostedOnboardingError } from "../../hosted-onboarding/errors";
import { getPrisma } from "../../prisma";
import { assertGameMemberAuthCurrentTx } from "../http/auth";
import { gameNotFound } from "../http/errors";
import { readAwards } from "./awards";
import type { GoalContext } from "./goals";
import { readHealthInput, readHealthProfile, readHealthStates } from "./health-input";
import { healthSumMeasures } from "./health-journeys";
import { readGameSeries } from "./series";
import type { BeforeProgressMutation } from "./state";

/** Route composition: only these exact IDs belong to the member's health. */
export async function readGoalContext(auth: HostedNativeMemberAuth, id: string, signal: AbortSignal): Promise<GoalContext & ({ source: "wearable"; today: string } | { source: "games" })> {
  const memberId = auth.member.id;
  const wearable = id === "steps" || id === "sleep";
  const beforeMutationTx: BeforeProgressMutation = async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    if (wearable) await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
  };
  if (wearable) {
    const { joinedOn, today } = await readHealthProfile(memberId);
    const { metrics } = await readHealthInput(auth, signal, today);
    const states = await readHealthStates(memberId), awards = await readAwards(memberId);
    await beforeMutationTx(getPrisma());
    const measure = healthSumMeasures(metrics, joinedOn, today, awards).find(measure => measure.id === id);
    if (!measure?.amounts.length) throw hostedOnboardingError({ code: "PROGRESS_HEALTH_UNAVAILABLE", httpStatus: 503,
      retryable: true, message: "Health progress is temporarily unavailable." });
    return { measure, state: states.get(id)!, awards, incomplete: false, today, source: "wearable", beforeMutationTx };
  }
  const snapshot = await readGameSeries(memberId, new Date());
  const measure = snapshot.measures.find(measure => measure.id === id);
  if (!measure) throw gameNotFound();
  return { measure, state: snapshot.states.get(id) ?? {}, awards: snapshot.awards,
    incomplete: snapshot.incomplete, source: "games", beforeMutationTx };
}
