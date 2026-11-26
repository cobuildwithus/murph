import "server-only";
import type { HealthWinNudge, Prisma } from "@prisma/client";
import type { HealthWinObservations } from "./achievement";

type Tx = Prisma.TransactionClient;
type Claim = { memberId: string; day: string; startedAt: Date };
type LockedState = Omit<HealthWinNudge, "seenKeys"> & { matchingKeys: string[] };

async function lockState(tx: Tx, memberId: string, observations?: HealthWinObservations | null) {
  const keys = observations?.items.map(item => item.seenKey) ?? [];
  // Keep the lifetime history in Postgres. Only this detector pass's matching keys cross the wire.
  const [state] = await tx.$queryRaw<LockedState[]>`
    SELECT member_id AS "memberId", seen_version AS "seenVersion", baseline_at AS "baselineAt",
           last_presented_at AS "lastPresentedAt", last_evaluated_day AS "lastEvaluatedDay",
           ARRAY(SELECT key FROM unnest(${keys}::text[]) AS k(key) WHERE key = ANY(n.seen_keys)) AS "matchingKeys"
    FROM health_win_nudge n WHERE member_id = ${memberId} FOR UPDATE
  `;
  return state;
}

function observedChanges(state: LockedState, observations: HealthWinObservations | null, complete: boolean, at: Date) {
  const data: Prisma.HealthWinNudgeUpdateInput = {};
  let winRef: string | null = null;
  if (!observations?.items.length || (state.seenVersion !== null && state.seenVersion !== observations.version)) {
    return { data, winRef };
  }
  const seen = new Set(state.matchingKeys);
  const added: string[] = [];
  for (const item of observations.items) {
    if (seen.has(item.seenKey)) continue;
    seen.add(item.seenKey);
    added.push(item.seenKey);
    if (state.baselineAt && item.fresh) winRef ??= item.winRef;
  }
  if (added.length) data.seenKeys = { push: added };
  if (state.seenVersion === null) data.seenVersion = observations.version;
  if (state.baselineAt === null && complete) data.baselineAt = at;
  return { data, winRef };
}

/** Called inside the successful presenter's authority transaction. Only a composer read enrolls a member. */
export async function recordHealthWinPresentationTx(tx: Tx, input: {
  memberId: string; observations: HealthWinObservations | null; complete: boolean;
}) {
  const { memberId } = input;
  await tx.healthWinNudge.createMany({ data: { memberId, lastPresentedAt: new Date() }, skipDuplicates: true });
  const state = await lockState(tx, memberId, input.observations);
  if (!state) throw new Error("Health win presentation state unavailable.");
  // Capture the watermark after taking the lock so a slow presentation still cancels an intervening claim.
  const at = new Date(Math.max(Date.now(), state.lastPresentedAt.getTime()));
  const { data } = observedChanges(state, input.observations, input.complete, at);
  await tx.healthWinNudge.update({ where: { memberId }, data: { ...data, lastPresentedAt: at }, select: { memberId: true } });
}

/** The conditional update takes the row lock and consumes the day before any external reads. */
export async function claimHealthWinDayTx(tx: Tx, { memberId, day }: Claim) {
  const result = await tx.healthWinNudge.updateMany({
    where: { memberId, OR: [{ lastEvaluatedDay: null }, { lastEvaluatedDay: { lt: day } }] },
    data: { lastEvaluatedDay: day },
  });
  return result.count === 1;
}

async function memberHasNotSeenWinSinceClaim(tx: Tx, state: LockedState, claim: Claim) {
  if (state.lastPresentedAt >= claim.startedAt) return false;
  // A post can come from a previously opened composer.
  const post = await tx.healthPost.findFirst({ where: {
    authorMemberId: claim.memberId, createdAt: { gte: claim.startedAt },
  }, select: { id: true } });
  return !post;
}

/** The caller appends the wake in this same transaction, holding the lock until both effects commit. */
export async function finishHealthWinEvaluationTx(tx: Tx, claim: Claim & { observations: HealthWinObservations }) {
  const state = await lockState(tx, claim.memberId, claim.observations);
  if (!state || state.lastEvaluatedDay !== claim.day) return null;
  const { data, winRef } = observedChanges(state, claim.observations, true, claim.startedAt);
  if (Object.keys(data).length) {
    await tx.healthWinNudge.update({ where: { memberId: claim.memberId }, data, select: { memberId: true } });
  }
  return winRef && await memberHasNotSeenWinSinceClaim(tx, state, claim) ? winRef : null;
}

export async function isHealthWinClaimCurrentTx(tx: Tx, claim: Claim & { version: string }) {
  const state = await lockState(tx, claim.memberId);
  return !!state && state.baselineAt !== null && state.seenVersion === claim.version
    && state.lastEvaluatedDay === claim.day && await memberHasNotSeenWinSinceClaim(tx, state, claim);
}
