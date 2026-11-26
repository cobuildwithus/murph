import "server-only";
import { randomUUID } from "node:crypto";
import { toLocalDayKey } from "@murphai/contracts";
import { type HealthWinSet, Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import type { ClientUnits } from "../companion/client-info";
import { assertGameMemberAuthCurrentForRead, assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { gameHttpError } from "../game/http/errors";
import { createHostedOpaqueIdentifier } from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import {
  findCandidate, freezeHealthSelections, prepareHealthCandidates, previewHealthCandidate, withDistanceTrendUnits,
  type CachedHealthCandidate, type HealthCardSelection,
} from "./card-options";
import { readHealthWinIdentities } from "./achievement";
import { openHealthTexts, sealHealthTexts } from "./crypto";
import { rankHealthCards } from "./decisions";
import { readHealthWinDetection } from "./detection";
import { isHealthWinTextEnabled } from "./flag";
import { recordHealthWinPresentationTx } from "./nudge-state";
import { postedCardKeys } from "./posted-card-keys";

export type { FrozenHealthCard, HealthCardSelection } from "./card-options";

const DETECTOR_VERSION = "v6";
const CHECK_INTERVAL_MS = 60 * 60_000;

const staleSet = () => hostedOnboardingError({
  code: "HEALTH_WIN_SET_CHANGED", httpStatus: 409, message: "Your win cards changed. Choose from your current set.",
});

async function assertAuthority(auth: HostedNativeMemberAuth, db: Prisma.TransactionClient, access: "read" | "write" = "read") {
  if (access === "write") await assertGameMemberAuthCurrentTx(auth, db);
  else await assertGameMemberAuthCurrentForRead(auth, db);
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
    await assertAuthority(auth, tx);
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
  return (JSON.parse(opened) as CachedHealthCandidate[]).map(withDistanceTrendUnits);
}

interface WinReadOptions { signal: AbortSignal; refresh?: boolean; units?: ClientUnits }

async function present(auth: HostedNativeMemberAuth, row: HealthWinSet, { signal, units }: WinReadOptions) {
  signal.throwIfAborted();
  const cached = await openSet(row, signal);
  const memberId = auth.member.id;
  const textEnabled = isHealthWinTextEnabled(memberId);
  const eligible = cached.flatMap(({ id, achievement }) => achievement ? [{ id, achievement }] : []);
  const observations = textEnabled
    ? readHealthWinIdentities(memberId, eligible.map(({ achievement }) => achievement), row.day)
    : null;
  const refs = new Map(observations?.items.map((item, i) => [eligible[i].id, item.winRef]));
  const candidates = cached.map(candidate => {
    const display = units === "metric" ? candidate : candidate.miles ?? candidate;
    const winRef = refs.get(candidate.id);
    return { ...previewHealthCandidate(display), ...(winRef && { winRef }) };
  });
  const keys = postedCardKeys(memberId, candidates.map(card => card.id));
  const posted = await getPrisma().$transaction(async tx => {
    await assertAuthority(auth, tx, textEnabled ? "write" : "read");
    if (textEnabled) await recordHealthWinPresentationTx(tx, {
      memberId, observations, complete: cached.some(candidate => candidate.sourceComplete === true),
    });
    if (!keys.size) return [];
    return tx.$queryRaw<{ key: string }[]>`
      SELECT DISTINCT card.key
      FROM health_post CROSS JOIN LATERAL unnest(posted_card_keys) AS card(key)
      WHERE author_member_id = ${memberId} AND deleted_at IS NULL
        AND card.key IN (${Prisma.join([...keys.values()])})
    `;
  });
  const shared = new Set(posted.map(card => card.key));
  const suggestions = candidates.filter(card => {
    const key = keys.get(card.id);
    return key === undefined || !shared.has(key);
  });
  return { day: row.day, setRevision: row.revision, candidates: suggestions };
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

export async function readHealthWins(auth: HostedNativeMemberAuth, options: WinReadOptions) {
  const db = getPrisma(), memberId = auth.member.id;
  const { today, row: observed } = await readCurrent(auth);
  const now = new Date();
  if (!options.refresh && observed?.day === today && now.getTime() - observed.checkedAt.getTime() < CHECK_INTERVAL_MS) {
    return present(auth, observed, options);
  }

  const canRecompute = !options.refresh || (await hostedAuthRateLimitStorage(db).consume(
    `health-wins-refresh:member:${memberId}`, { max: 1, window: 60 },
  )).allowed;
  const checkAuthority = () => db.$transaction(tx => assertAuthority(auth, tx));
  const source = canRecompute ? await readHealthWinDetection({ memberId, today, checkAuthority, signal: options.signal }) : null;
  if (!source) {
    const { row: lastGood } = await readCurrent(auth);
    if (lastGood) return present(auth, lastGood, options);
    throw hostedOnboardingError({ code: "HEALTH_WINS_UNAVAILABLE", httpStatus: 503, retryable: true, message: "Your win cards are still loading." });
  }
  const sourceRevision = createHostedOpaqueIdentifier("health-win-source", JSON.stringify([memberId, DETECTOR_VERSION, source.sourceRevision]))!;
  const keep = observed?.day === today && observed.sourceRevision === sourceRevision && !options.refresh;
  let replacement: HealthWinSet | null = null;
  if (!keep) {
    const { selected, achievements } = source.detect();
    if (!selected.length && !source.complete && observed) return present(auth, observed, options);
    await checkAuthority();
    const ranked = await rankHealthCards(selected, options.signal);
    const nudge = isHealthWinTextEnabled(memberId) ? { achievements, complete: source.complete } : undefined;
    const candidates = prepareHealthCandidates(memberId, ranked, source.distanceArtUrl, nudge);
    const revision = randomUUID();
    const [candidatesEncrypted] = await sealHealthTexts([{ ...cipherTarget(memberId, revision), value: JSON.stringify(candidates) }], options.signal);
    replacement = { memberId, day: today, sourceRevision, revision, candidatesEncrypted, createdAt: now, checkedAt: now };
  }
  options.signal.throwIfAborted();

  // Serialize the brief publication step with other publishers and post acceptance. The
  // observed revision and check time also fence a slower recomputation of an unchanged set.
  const published = await db.$transaction(async tx => {
    await assertAuthority(auth, tx, "write");
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
  return present(auth, published, options);
}

async function openSelectedSet(auth: HostedNativeMemberAuth, expectedRevision: string) {
  const { row } = await readCurrent(auth);
  if (!row || row.revision !== expectedRevision) throw staleSet();
  const candidates = await openSet(row);
  // Re-evaluate both content authority and set identity after decrypting. Post writes
  // repeat the revision check under the shared publication lock in their own transaction.
  await getPrisma().$transaction(async tx => {
    await assertAuthority(auth, tx);
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
  return { card: previewHealthCandidate(findCandidate(candidates, input.candidateId).display, input.option) };
}
