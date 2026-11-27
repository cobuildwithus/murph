import "server-only";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import type { ClientUnits } from "../companion/client-info";
import { gameNotFound, invalidGameRequest } from "../game/http/errors";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import {
  prepareSeeYoursCandidate, previewRecordedCandidate, resolveRecordedSelection, type FrozenHealthCard, type HealthCardSelection,
} from "./card-options";
import { isMeasure, measures } from "./engine/measures";
import { chooseSeeYours, seeYoursCard } from "./engine/see-yours";
import { labUnitKey } from "./engine/shared";
import type { CardSpec, Measure } from "./engine/types";
import { readMeasureInputs } from "./inputs";
import { postedCardKeys } from "./posted-card-keys";
import { assertVisibleFrozenCardCurrent, readVisibleFrozenCard } from "./read";
import { localToday } from "./wins";

async function readViewerMeasure(auth: HostedNativeMemberAuth, measure: Measure, signal: AbortSignal) {
  const profile = await getPrisma().gameProfile.findUnique({ where: { memberId: auth.member.id }, select: { timeZone: true } });
  return readMeasureInputs(auth, localToday(profile), measure, signal);
}

function friendMarker(frozen: FrozenHealthCard["spec"], viewerCard: CardSpec) {
  const friend = frozen.chart, own = viewerCard.chart;
  if (frozen.kind !== "percentile" || friend.type !== "percentile" || own.type !== "percentile") return null;
  if (labUnitKey(friend.unit) !== labUnitKey(own.unit)) return null;
  if (viewerCard.measure === "rhr_bpm" && (!own.referenceKey || friend.referenceKey !== own.referenceKey)) return null;
  return { value: friend.value, unit: friend.unit };
}

/** The viewer already has a live post carrying this card: See yours shows it, but doesn't offer it again. */
async function alreadyShared(viewer: string, cardId: string): Promise<boolean> {
  const key = postedCardKeys(viewer, [cardId]).get(cardId);
  if (!key) return false;
  const rows = await getPrisma().$queryRaw<{ found: number }[]>`
    SELECT 1 AS found FROM health_post
    WHERE author_member_id = ${viewer} AND deleted_at IS NULL AND ${key} = ANY(posted_card_keys)
    LIMIT 1`;
  return rows.length > 0;
}

// Once the frozen card is admitted, loss of viewer authority makes it unavailable just like a lost audience grant.
function concealRevokedRead(error: unknown): never {
  if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) throw gameNotFound();
  throw error;
}

export async function readSeeYours(
  auth: HostedNativeMemberAuth, postId: string, cardId: string, units: ClientUnits, signal: AbortSignal,
) {
  const viewer = auth.member.id;
  const budget = await hostedAuthRateLimitStorage(getPrisma()).consume(`health-see-yours:member:${viewer}`, { max: 10, window: 60 });
  if (!budget.allowed) throw hostedOnboardingError({
    code: "AUTH_RATE_LIMITED", httpStatus: 429, retryable: true, message: "Wait a minute before opening another card.",
  });
  const { spec, authorMemberId, version } = await readVisibleFrozenCard(viewer, postId, cardId, signal);
  const key = "measure" in spec ? spec.measure : undefined;
  if (authorMemberId === viewer || spec.chart.type === "hidden" || !isMeasure(key)) {
    throw invalidGameRequest("Choose a shared measure on a friend's post.");
  }

  const { input, observed } = await readViewerMeasure(auth, key, signal).catch(concealRevokedRead);
  const result = chooseSeeYours(input, key, spec.kind, observed);
  const measure = { key, ...measures[key] };
  const card = "card" in result ? previewRecordedCandidate(prepareSeeYoursCandidate(viewer, result.card, units)) : null;
  const shared = card ? await alreadyShared(viewer, card.id) : false;
  const response = "card" in result ? {
    measure, card, reason: null, friend: friendMarker(spec, result.card), shared,
  } : { measure, card: null, reason: result.reason, friend: null };
  await assertVisibleFrozenCardCurrent(auth, postId, version).catch(concealRevokedRead);
  return response;
}

const cardChanged = () => hostedOnboardingError({
  code: "HEALTH_SEE_YOURS_CHANGED", httpStatus: 409, message: "Open your card again before posting.",
});

export async function resolveSeeYoursSelection(
  auth: HostedNativeMemberAuth, pick: HealthCardSelection, units: ClientUnits, signal = new AbortController().signal,
) {
  const [prefix, measure, kind, ...extra] = pick.candidateId.split(":");
  if (prefix !== "mine" || !isMeasure(measure) || !kind || extra.length) throw invalidGameRequest("Choose a See yours card.");
  const { input } = await readViewerMeasure(auth, measure, signal);
  const card = seeYoursCard(input, measure, kind);
  if (!card) throw cardChanged();
  const candidate = prepareSeeYoursCandidate(auth.member.id, card, units);
  const frozen = resolveRecordedSelection([candidate], pick, cardChanged);
  if (!frozen) throw cardChanged();
  return frozen;
}
