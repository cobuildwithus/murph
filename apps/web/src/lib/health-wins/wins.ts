import "server-only";
import { randomUUID } from "node:crypto";
import { toLocalDayKey } from "@murphai/contracts";
import { type HealthWinSet, Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { assertGameMemberAuthCurrentForRead, assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { gameHttpError } from "../game/http/errors";
import { createHostedOpaqueIdentifier } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import {
  findCandidate, freezeHealthSelections, prepareHealthCandidates, previewHealthCandidate,
  type CachedHealthCandidate, type HealthCardSelection,
} from "./card-options";
import { openHealthTexts, sealHealthTexts } from "./crypto";
import { rankHealthCards } from "./decisions";
import { generateHealthWins } from "./engine";
import { readHealthWinInputs } from "./inputs";

export type { FrozenHealthCard, HealthCardSelection } from "./card-options";

const DETECTOR_VERSION = "v4";
const CHECK_INTERVAL_MS = 60 * 60_000;
const INPUT_BUDGET_MS = 8_000;

const staleSet = () => hostedOnboardingError({
  code: "HEALTH_WIN_SET_CHANGED", httpStatus: 409, message: "Your win cards changed. Choose from your current set.",
});

async function readAuthority(auth: HostedNativeMemberAuth, db: Prisma.TransactionClient) {
  await assertGameMemberAuthCurrentForRead(auth, db);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: db });
}

function localToday(profile: { timeZone: string } | null | undefined) {
  if (!profile) throw gameHttpError("PROFILE_REQUIRED", 409, "Add your first name and time zone first.");
  return toLocalDayKey(new Date(), profile.timeZone);
}

function latest(db: Prisma.TransactionClient, memberId: string, today: string) {
  return db.healthWinSet.findFirst({ where: { memberId, day: { lte: today } }, orderBy: { day: "desc" } });
}

async function readCurrent(auth: HostedNativeMemberAuth) {
  const db = getPrisma(), memberId = auth.member.id;
  return db.$transaction(async tx => {
    await readAuthority(auth, tx);
    const profile = await tx.gameProfile.findUnique({ where: { memberId }, select: { timeZone: true } });
    const today = localToday(profile);
    return { today, row: await latest(tx, memberId, today) };
  });
}

function cipherTarget(memberId: string, revision: string) {
  return { memberId, table: "health_win_set", rowId: revision, field: "candidates" } as const;
}

async function openSet(row: HealthWinSet, signal?: AbortSignal) {
  const [opened] = await openHealthTexts([{ ...cipherTarget(row.memberId, row.revision), value: row.candidatesEncrypted }], signal);
  // The ciphertext is bound to the owner and the exact set revision.
  return JSON.parse(opened) as CachedHealthCandidate[];
}

async function present(auth: HostedNativeMemberAuth, row: HealthWinSet, signal: AbortSignal) {
  signal.throwIfAborted();
  const candidates = (await openSet(row, signal)).map(candidate => previewHealthCandidate(candidate));
  await getPrisma().$transaction(tx => readAuthority(auth, tx));
  return { day: row.day, setRevision: row.revision, candidates };
}

// Stop source work at the budget, then drain the request-scoped replica/crypto work
// before decrypting a fallback or opening a publication transaction.
async function loadInputs(auth: HostedNativeMemberAuth, today: string, requestSignal: AbortSignal) {
  const deadline = AbortSignal.timeout(INPUT_BUDGET_MS);
  const signal = AbortSignal.any([requestSignal, deadline]);
  signal.throwIfAborted();
  try {
    const source = await readHealthWinInputs(auth, today, signal);
    requestSignal.throwIfAborted();
    return deadline.aborted ? null : source;
  } catch (error) {
    if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) throw error;
    requestSignal.throwIfAborted();
    if (deadline.aborted) return null;
    throw error;
  }
}

/** A post sharing yesterday's timeout fallback must also serialize with creation of today's row. */
export async function assertHealthSetCurrent(
  tx: Prisma.TransactionClient, memberId: string, day: string, setRevision: string, access: "preview" | "publish" = "publish",
) {
  const [profile] = await tx.$queryRaw<{ timeZone: string }[]>`
    SELECT time_zone AS "timeZone" FROM game_profile WHERE member_id = ${memberId}
    ${access === "publish" ? Prisma.sql`FOR SHARE` : Prisma.empty}
  `;
  const today = localToday(profile);
  const current = await tx.healthWinSet.findFirst({
    where: { memberId, day: { lte: today } }, orderBy: { day: "desc" }, select: { day: true, revision: true },
  });
  if (current?.day !== day || current.revision !== setRevision) throw staleSet();
}

export async function readHealthWins(auth: HostedNativeMemberAuth, options: { signal: AbortSignal; refresh?: boolean }) {
  const db = getPrisma(), memberId = auth.member.id;
  const { today, row: observed } = await readCurrent(auth);
  const now = new Date();
  if (!options.refresh && observed?.day === today && now.getTime() - observed.checkedAt.getTime() < CHECK_INTERVAL_MS) {
    return present(auth, observed, options.signal);
  }

  const canRecompute = !options.refresh || (await hostedAuthRateLimitStorage(db).consume(
    `health-wins-refresh:member:${memberId}`, { max: 1, window: 60 },
  )).allowed;
  const source = canRecompute ? await loadInputs(auth, today, options.signal) : null;
  if (!source) {
    const { row: lastGood } = await readCurrent(auth);
    if (lastGood) return present(auth, lastGood, options.signal);
    throw hostedOnboardingError({ code: "HEALTH_WINS_UNAVAILABLE", httpStatus: 503, retryable: true, message: "Your win cards are still loading." });
  }
  const sourceRevision = createHostedOpaqueIdentifier("health-win-source", JSON.stringify([memberId, DETECTOR_VERSION, source.sourceRevision]))!;
  const keep = observed?.day === today && observed.sourceRevision === sourceRevision && !options.refresh;
  let replacement: HealthWinSet | null = null;
  if (!keep) {
    const generated = generateHealthWins(source.input);
    if (!generated.length && !source.complete && observed) return present(auth, observed, options.signal);
    await db.$transaction(tx => readAuthority(auth, tx));
    const ranked = await rankHealthCards(generated, options.signal);
    const candidates = prepareHealthCandidates(memberId, ranked, source.distanceArtUrl);
    const revision = randomUUID();
    const [candidatesEncrypted] = await sealHealthTexts([{ ...cipherTarget(memberId, revision), value: JSON.stringify(candidates) }], options.signal);
    replacement = { memberId, day: today, sourceRevision, revision, candidatesEncrypted, createdAt: now, checkedAt: now };
  }
  options.signal.throwIfAborted();

  // Serialize the brief publication step with other publishers and post acceptance. The
  // observed revision and check time also fence a slower recomputation of an unchanged set.
  const published = await db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    const [profile] = await tx.$queryRaw<{ timeZone: string }[]>`
      SELECT time_zone AS "timeZone" FROM game_profile WHERE member_id = ${memberId} FOR UPDATE
    `;
    const currentDay = localToday(profile);
    const current = await latest(tx, memberId, currentDay);
    if (currentDay !== today || current?.revision !== observed?.revision
      || current?.checkedAt.getTime() !== observed?.checkedAt.getTime()) {
      if (current) return current;
      throw staleSet();
    }
    const where = { memberId_day: { memberId, day: today } };
    const stored = replacement && current?.day !== today
      ? await tx.healthWinSet.create({ data: replacement })
      : await tx.healthWinSet.update({ where, data: replacement ?? { checkedAt: now } });
    // A sparse older day can still serve as the fallback after a time-zone change.
    await tx.$executeRaw`
      DELETE FROM health_win_set WHERE member_id = ${memberId} AND day < (
        SELECT day FROM health_win_set WHERE member_id = ${memberId}
        ORDER BY day DESC LIMIT 1 OFFSET 2
      )
    `;
    return stored;
  });
  return present(auth, published, options.signal);
}

async function openSelectedSet(auth: HostedNativeMemberAuth, expectedRevision: string) {
  const { row } = await readCurrent(auth);
  if (!row || row.revision !== expectedRevision) throw staleSet();
  const candidates = await openSet(row);
  // Re-evaluate both content authority and set identity after decrypting. Post writes
  // repeat the revision check under the shared publication lock in their own transaction.
  await getPrisma().$transaction(async tx => {
    await readAuthority(auth, tx);
    await assertHealthSetCurrent(tx, auth.member.id, row.day, row.revision, "preview");
  });
  return { day: row.day, candidates };
}

export async function resolveHealthCards(auth: HostedNativeMemberAuth, setRevision: string, selections: readonly HealthCardSelection[]) {
  const { day, candidates } = await openSelectedSet(auth, setRevision);
  return { day, cards: freezeHealthSelections(candidates, selections) };
}

export async function changeHealthWin(auth: HostedNativeMemberAuth, input: { candidateId: string; setRevision: string; option: string }) {
  const { candidates } = await openSelectedSet(auth, input.setRevision);
  return { card: previewHealthCandidate(findCandidate(candidates, input.candidateId), input.option) };
}
