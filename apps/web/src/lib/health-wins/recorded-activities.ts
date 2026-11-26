import "server-only";
import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import type { HealthActivity, Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import type { ClientUnits } from "../companion/client-info";
import { assertGameMemberAuthCurrentForRead, assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { gameHttpError } from "../game/http/errors";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import { previewRecordedCandidate } from "./card-options";
import { sealHealthTexts } from "./crypto";
import { activitySummaryTarget, openRecordedActivitySummaries } from "./recorded-summary";
import { buildRecordedCards, recordedActivitySummary, validateRecordedActivity } from "./engine/recorded";
import type { RecordedActivity, RecordedActivitySummary } from "./engine/types";

type Tx = Prisma.TransactionClient;
type SealedSummary = Pick<HealthActivity, "id" | "memberId" | "summaryEncrypted">;
type PreparedSummary = SealedSummary & { day: string };
const titleContextLimit = 32;
const sealedFields = { id: true, memberId: true, summaryEncrypted: true } as const;

const conflict = () => hostedOnboardingError({
  code: "HEALTH_ACTIVITY_CONFLICT", httpStatus: 409, message: "This activity has already been saved or posted with different details.",
});

async function readAuthority(auth: HostedNativeMemberAuth, db: Tx) {
  await assertGameMemberAuthCurrentForRead(auth, db);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: db });
}

async function recordingTime(db: Tx, memberId: string, activity: RecordedActivity) {
  const profile = await db.gameProfile.findUnique({ where: { memberId }, select: { timeZone: true } });
  if (!profile) throw gameHttpError("PROFILE_REQUIRED", 409, "Add your first name and time zone first.");
  const { dayKey: day, hour } = formatTimeZoneDateTimeParts(new Date(activity.startedAt), profile.timeZone);
  return { day, hour };
}

async function previousKind(memberId: string, day: string, activity: RecordedActivity) {
  const rows = await getPrisma().healthActivity.findMany({
    where: { memberId, day, deletedAt: null, id: { not: activity.id } }, select: sealedFields,
    orderBy: { id: "asc" }, take: titleContextLimit + 1,
  });
  // Start times are sealed. A partial day cannot identify the preceding activity reliably.
  if (rows.length > titleContextLimit) return undefined;
  const before = Date.parse(activity.startedAt);
  let latest: { end: number; kind: RecordedActivity["kind"] } | undefined;
  for (const summary of await openRecordedActivitySummaries(rows)) {
    const end = Date.parse(summary.startedAt) + summary.elapsedSec * 1000;
    if (end <= before && (!latest || end > latest.end)) latest = { end, kind: summary.kind };
  }
  return latest?.kind;
}

export async function previewRecordedActivity(auth: HostedNativeMemberAuth, activity: RecordedActivity, units: ClientUnits) {
  const db = getPrisma(), memberId = auth.member.id;
  validateRecordedActivity(activity);
  await readAuthority(auth, db);
  const time = await recordingTime(db, memberId, activity);
  const prior = await previousKind(memberId, time.day, activity);
  const { suggestedTitle, candidates } = buildRecordedCards(activity, { ...time, previousKind: prior, units });
  await readAuthority(auth, db);
  return { suggestedTitle, cards: candidates.map(previewRecordedCandidate) };
}

async function sealSummary(memberId: string, day: string, activity: RecordedActivity): Promise<PreparedSummary> {
  const value = JSON.stringify(recordedActivitySummary(activity));
  const [summaryEncrypted] = await sealHealthTexts([{ ...activitySummaryTarget(memberId, activity.id), value }]);
  return { id: activity.id, memberId, day, summaryEncrypted };
}

async function assertSameSummary(prior: SealedSummary & { deletedAt: Date | null }, memberId: string, activity: RecordedActivity) {
  if (prior.deletedAt || prior.memberId !== memberId) throw conflict();
  const [saved] = await openRecordedActivitySummaries([prior]);
  if (JSON.stringify(recordedActivitySummary(saved)) !== JSON.stringify(recordedActivitySummary(activity))) throw conflict();
}

/** Bind the posted cards to the same immutable summary as a previous private save. */
export async function prepareHealthActivity(auth: HostedNativeMemberAuth, activity: RecordedActivity, units: ClientUnits) {
  const db = getPrisma(), memberId = auth.member.id;
  const time = await recordingTime(db, memberId, activity);
  const { candidates } = buildRecordedCards(activity, { ...time, units });
  const prior = await db.healthActivity.findUnique({ where: { id: activity.id },
    select: { ...sealedFields, day: true, deletedAt: true } });
  if (!prior) return { candidates, prepared: await sealSummary(memberId, time.day, activity) };
  await assertSameSummary(prior, memberId, activity);
  return { candidates, prepared: { id: prior.id, memberId, day: prior.day, summaryEncrypted: prior.summaryEncrypted } };
}

export async function storeRecordedActivityTx(tx: Tx, prepared: PreparedSummary, postId: string) {
  const inserted = await tx.healthActivity.createMany({ data: [{ ...prepared, postId }], skipDuplicates: true });
  if (inserted.count) return;
  // Claim only the exact summary opened before this transaction. Never overwrite a concurrent save.
  const bound = await tx.healthActivity.updateMany({
    where: { id: prepared.id, memberId: prepared.memberId, deletedAt: null, postId: null, summaryEncrypted: prepared.summaryEncrypted },
    data: { postId },
  });
  if (bound.count) return;
  const prior = await tx.healthActivity.findUnique({ where: { id: prepared.id }, select: { memberId: true, deletedAt: true, postId: true } });
  if (!prior || prior.memberId !== prepared.memberId || prior.deletedAt || prior.postId) throw conflict();
  throw hostedOnboardingError({ code: "HEALTH_ACTIVITY_CONFLICT", httpStatus: 409, retryable: true,
    message: "The private save just finished. Try posting again." });
}

export async function saveRecordedActivity(auth: HostedNativeMemberAuth, activity: RecordedActivitySummary) {
  const db = getPrisma(), memberId = auth.member.id;
  validateRecordedActivity(activity);
  await readAuthority(auth, db);
  const { day } = await recordingTime(db, memberId, activity);
  const prepared = await sealSummary(memberId, day, activity);
  const prior = await db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    const inserted = await tx.healthActivity.createMany({ data: [prepared], skipDuplicates: true });
    if (inserted.count) return null;
    return tx.healthActivity.findUniqueOrThrow({ where: { id: activity.id }, select: { ...sealedFields, deletedAt: true } });
  });
  if (prior) await assertSameSummary(prior, memberId, activity);
  return { id: activity.id };
}
