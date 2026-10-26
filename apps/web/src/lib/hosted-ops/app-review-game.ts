import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { readHostedAuthReviewMemberId } from "../better-auth/review-account";
import { toPrismaJsonObject } from "../device-sync/prisma-store/prisma-json";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } from "../hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { generateHostedRandomPrefixedId } from "../primitives";
import { getPrisma } from "../prisma";
import { isGameEnabledFor, mediaKeyPrefixFor } from "../game/access";
import { sealGameText, type GameSealTarget } from "../game/crypto";
import { isGameMediaStorageAvailable, putGameMedia } from "../game/media";
import {
  decideSettle,
  GAME_SEATS_1V1,
  liveRosterKey,
  settleDueAt,
  ticketUseBy,
  type RuleEntry,
  type RuleState,
  type StoredTerms,
  type TermWords,
} from "../game/rules";
import { addDays, dayStartInstant, gameLocalDate } from "../game/time";

/**
 * App Review cannot invite a real second player, so the configured review
 * account gets a fixture opponent and two games with it: one settled with an
 * IOU the reviewer holds, and a long live rematch where the opponent has
 * posted today. Every run replaces the opponent's games with fresh ones dated
 * from now, so it is safe to repeat before each submission.
 *
 * Rows are written directly. No game command, history-driven chat notice,
 * push, Linq or email path runs, and the opponent has no phone, email, push
 * route, chat routing or sign-in, which apply re-checks under the member lock.
 */

export type HostedOpsAppReviewGameMode = "apply" | "dry-run";
/** Reads one traced public image (a path under `public`). */
export type HostedOpsAppReviewGamePhotoReader = (publicPath: string) => Promise<Uint8Array>;

export const APP_REVIEW_PARTNER_MEMBER_ID = "hbm_appReviewPartner";
export const APP_REVIEW_GAME_TIME_ZONE = "America/Los_Angeles";
/** Synthetic marketing art the site already serves; traced into the ops route. */
export const APP_REVIEW_GAME_PHOTOS = {
  porch: "/design-assets/hero-morning-outdoor-light-exposure.jpeg",
  stretch: "/design-assets/hero-at-home-static-stretching-latest.jpeg",
  walk: "/design-assets/hero-walking-after-every-meal.jpeg",
} as const;

const PARTNER_NAME = "Sam";
const REVIEWER_NAME = "Alex";
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const HOUR_MS = 60 * 60 * 1000;

type Seat = "partner" | "reviewer";
type SeedEntry =
  | { by: Seat; day: number; hour: number; kind: "photo"; photo: keyof typeof APP_REVIEW_GAME_PHOTOS }
  | { by: Seat; day: number; hour: number; kind: "words"; text: string };
interface SeedGame {
  round: number;
  /** Day 1 relative to the seed's game day. */
  dayOneOffset: number;
  lengthDays: number;
  settled: boolean;
  tasks: Record<Seat, string>;
  stake: { kind: "prize" | "dare"; item: string };
  entries: readonly SeedEntry[];
}

/** You 4, Sam 3: the reviewer won and holds one open IOU. */
const SETTLED_GAME: SeedGame = {
  dayOneOffset: -9,
  entries: [
    { by: "partner", day: 0, hour: 7, kind: "photo", photo: "stretch" },
    { by: "reviewer", day: 0, hour: 18, kind: "words", text: "20 pushups before dinner." },
    { by: "reviewer", day: 1, hour: 8, kind: "words", text: "Done before coffee." },
    { by: "partner", day: 2, hour: 7, kind: "words", text: "4 miles. Slow, but done." },
    { by: "reviewer", day: 2, hour: 19, kind: "words", text: "Pushups on the balcony." },
    { by: "partner", day: 3, hour: 6, kind: "photo", photo: "porch" },
    { by: "reviewer", day: 4, hour: 12, kind: "words", text: "Last day. Did 25." },
  ],
  lengthDays: 5,
  round: 1,
  settled: true,
  stake: { item: "Coffee of your choice", kind: "prize" },
  tasks: { partner: "Morning run", reviewer: "20 pushups" },
};

/**
 * Today is Day 3 of 30. Sam's post today stays blurred until the reviewer
 * posts. The reviewer's task names pushups and a walk, so the app offers
 * every capture mode.
 */
const LIVE_GAME: SeedGame = {
  dayOneOffset: -2,
  entries: [
    { by: "partner", day: 0, hour: 7, kind: "photo", photo: "porch" },
    { by: "reviewer", day: 0, hour: 18, kind: "words", text: "20 pushups. Felt good." },
    { by: "partner", day: 1, hour: 6, kind: "words", text: "30 minutes in the rain. Still counts." },
    { by: "reviewer", day: 1, hour: 13, kind: "words", text: "Short walk after lunch." },
    { by: "partner", day: 2, hour: 7, kind: "photo", photo: "walk" },
  ],
  lengthDays: 30,
  round: 2,
  settled: false,
  stake: { item: "Dinner, loser pays", kind: "prize" },
  tasks: { partner: "30 minute run", reviewer: "20 pushups or a short walk" },
};

export interface HostedOpsAppReviewGameSummary {
  action: "applied" | "dry-run";
  blockers: string[];
  /** Apply only: the games it wrote. */
  created?: { id: string; round: number; status: string }[];
  partner: { contactSurfaces: string[]; exists: boolean; gameEnabled: boolean; id: string };
  plan: {
    live: { dayOne: string; lastDay: string; partnerPostedToday: true; round: number; today: string; todayDay: number };
    photos: number;
    settled: { dayOne: string; holderIsReviewer: true; lastDay: string; round: number; scores: { partner: number; reviewer: number }; ticketUseBy: string };
    timeZone: string;
  };
  replacedGames: { id: string; round: number; status: string }[];
  reviewMember: { gameEnabled: boolean; gameProfile: boolean; id: string | null; phoneVerified: boolean; suspended: boolean | null };
  sends: "none";
}

interface Members { partner: string; reviewer: string }

interface BuiltGame {
  id: string;
  seed: SeedGame;
  dayOne: string;
  state: RuleState;
  createdAt: Date;
  startedAt: Date;
  settledAt: Date | null;
  terms: StoredTerms;
  words: TermWords;
  entryIds: string[];
}

export async function seedHostedOpsAppReviewGame(input: {
  mode: HostedOpsAppReviewGameMode;
  now?: Date;
  prisma?: PrismaClient;
  readPhoto?: HostedOpsAppReviewGamePhotoReader;
}): Promise<HostedOpsAppReviewGameSummary> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const reviewer = await readHostedAuthReviewMemberId({ prisma });
  const inspected = await inspect(prisma, reviewer);
  const members = { partner: APP_REVIEW_PARTNER_MEMBER_ID, reviewer: reviewer ?? "" };
  const games = [buildGame(SETTLED_GAME, members, now, null), buildGame(LIVE_GAME, members, now, null)];
  const summary = summarize(input.mode === "apply" ? "applied" : "dry-run", inspected, games, now);
  if (input.mode === "dry-run") return summary;

  if (!reviewer || summary.blockers.length > 0) {
    throw hostedOnboardingError({
      code: "APP_REVIEW_GAME_BLOCKED",
      httpStatus: 409,
      message: `The App Review game can't be prepared: ${summary.blockers.join(", ")}.`,
      retryable: false,
    });
  }
  const readPhoto = input.readPhoto;
  if (!readPhoto) throw new Error("The App Review game needs its photos.");
  return runWithHostedDomainRootUnwrapCache(() => apply({ inspected, members, now, prisma, readPhoto }));
}

async function apply(input: {
  inspected: Inspected;
  members: Members;
  now: Date;
  prisma: PrismaClient;
  readPhoto: HostedOpsAppReviewGamePhotoReader;
}): Promise<HostedOpsAppReviewGameSummary> {
  const { members, now, prisma } = input;
  // Game words seal under each member's control root. The partner's first
  // apply signs one; the reviewer's must already exist. Both are pinned below.
  const [partnerRoot, reviewerRoot] = await Promise.all([
    prepareHostedDomainRootForWeb({ domain: "control", prisma, reason: "hosted-ops.app-review-game", userId: members.partner }),
    prepareHostedDomainRootForWeb({ domain: "control", prepareMissing: false, prisma, reason: "hosted-ops.app-review-game", userId: members.reviewer }),
  ]);
  const prepared = await prepare(members, now, input.readPhoto);
  await prisma.$transaction(async (tx) => {
    await tx.hostedMember.createMany({ data: [{ id: members.partner }], skipDuplicates: true });
    // Owner-before-game lock order, as in account deletion and game commands.
    const locked = await tx.$queryRaw<{ id: string; suspended_at: Date | null }[]>`
      SELECT id, suspended_at FROM hosted_member WHERE id IN (${members.reviewer}, ${members.partner}) ORDER BY id FOR UPDATE`;
    const review = locked.find((row) => row.id === members.reviewer);
    if (!review || review.suspended_at) {
      throw hostedOnboardingError({ code: "APP_REVIEW_GAME_BLOCKED", httpStatus: 409, retryable: false,
        message: "The review account is missing or suspended." });
    }
    const surfaces = await readContactSurfaces(tx, members.partner);
    if (surfaces.length > 0) {
      throw hostedOnboardingError({ code: "APP_REVIEW_GAME_BLOCKED", httpStatus: 409, retryable: false,
        message: `The review partner became reachable (${surfaces.join(", ")}).` });
    }
    // Inserts the partner's prepared root, or fails if a racing apply's root won.
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: partnerRoot, tx });
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: reviewerRoot, tx });
    const stale = await tx.$queryRaw<{ id: string }[]>`
      SELECT g.id FROM game g
      WHERE g.invitee_member_id = ${members.partner}
         OR EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = g.id AND p.member_id = ${members.partner})
      ORDER BY g.id FOR UPDATE`;
    if (stale.length > 0) await tx.game.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    await tx.gameProfile.upsert({
      create: { firstNameEncrypted: prepared.partnerName, memberId: members.partner, timeZone: APP_REVIEW_GAME_TIME_ZONE },
      update: { firstNameEncrypted: prepared.partnerName, photoKey: null, timeZone: APP_REVIEW_GAME_TIME_ZONE },
      where: { memberId: members.partner },
    });
    // The reviewer keeps a profile they already have, but not a private rename of Sam.
    await tx.gameContactLabel.deleteMany({ where: { ownerMemberId: members.reviewer, subjectMemberId: members.partner } });
    await tx.gameProfile.createMany({
      data: [{ firstNameEncrypted: prepared.reviewerName, memberId: members.reviewer, timeZone: APP_REVIEW_GAME_TIME_ZONE }],
      skipDuplicates: true,
    });
    const [settled, live] = prepared.games;
    await writeGame(tx, settled, members, prepared, null);
    await writeGame(tx, live, members, prepared, settled.id);
  });
  return { ...summarize("applied", await inspect(prisma, members.reviewer), prepared.games, now, input.inspected.replacedGames),
    created: prepared.games.map((game) => ({ id: game.id, round: game.seed.round, status: game.seed.settled ? "settled" : "live" })) };
}

// ------------------------------------------------------------------ inspect

interface Inspected {
  reviewer: string | null;
  reviewerSuspended: boolean | null;
  reviewerPhoneVerified: boolean;
  reviewerGameProfile: boolean;
  partnerExists: boolean;
  partnerSurfaces: string[];
  replacedGames: { id: string; round: number; status: string }[];
}

async function inspect(prisma: PrismaClient, reviewer: string | null): Promise<Inspected> {
  const partner = APP_REVIEW_PARTNER_MEMBER_ID;
  const [reviewerRow, identity, profile, partnerRow, surfaces, games] = await Promise.all([
    reviewer ? prisma.hostedMember.findUnique({ select: { suspendedAt: true }, where: { id: reviewer } }) : null,
    reviewer ? prisma.hostedMemberIdentity.findUnique({ select: { phoneNumberVerifiedAt: true }, where: { memberId: reviewer } }) : null,
    reviewer ? prisma.gameProfile.findUnique({ select: { memberId: true }, where: { memberId: reviewer } }) : null,
    prisma.hostedMember.findUnique({ select: { id: true }, where: { id: partner } }),
    readContactSurfaces(prisma, partner),
    prisma.game.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, round: true, status: true },
      where: { OR: [{ players: { some: { memberId: partner } } }, { inviteeMemberId: partner }] },
    }),
  ]);
  return {
    partnerExists: partnerRow !== null,
    partnerSurfaces: surfaces,
    replacedGames: games,
    reviewer: reviewerRow ? reviewer : null,
    reviewerGameProfile: profile !== null,
    reviewerPhoneVerified: Boolean(identity?.phoneNumberVerifiedAt),
    reviewerSuspended: reviewerRow ? reviewerRow.suspendedAt !== null : null,
  };
}

/**
 * Anything that could reach a person or let one sign in as the partner. Game
 * chats need both players' verified phones, and a post's push needs a route.
 */
async function readContactSurfaces(db: Prisma.TransactionClient | PrismaClient, memberId: string): Promise<string[]> {
  const [identity, email, routing, push, auth] = await Promise.all([
    db.hostedMemberIdentity.count({ where: { memberId } }),
    db.hostedMemberEmailAuthorization.count({ where: { memberId } }),
    db.hostedMemberRouting.count({ where: { memberId } }),
    db.companionPushRoute.count({ where: { userId: memberId } }),
    db.hostedAuthRecord.count({ where: { OR: [{ memberId }, { model: "user", id: memberId }] } }),
  ]);
  return [
    ...(identity > 0 ? ["identity"] : []),
    ...(email > 0 ? ["email"] : []),
    ...(routing > 0 ? ["routing"] : []),
    ...(push > 0 ? ["push"] : []),
    ...(auth > 0 ? ["sign-in"] : []),
  ];
}

function summarize(
  action: HostedOpsAppReviewGameSummary["action"],
  inspected: Inspected,
  games: readonly BuiltGame[],
  now: Date,
  replaced = inspected.replacedGames,
): HostedOpsAppReviewGameSummary {
  const [settled, live] = games;
  const scores = decideSettle(settled.state).result.scores;
  const score = (memberId: string) => scores.find((entry) => entry.memberId === memberId)?.score ?? 0;
  const photos = new Set([...SETTLED_GAME.entries, ...LIVE_GAME.entries].flatMap((entry) => entry.kind === "photo" ? [entry.photo] : []));
  return {
    action,
    blockers: [
      ...(inspected.reviewer ? [] : ["review_account_not_found"]),
      ...(inspected.reviewerSuspended ? ["review_account_suspended"] : []),
      ...inspected.partnerSurfaces.map((surface) => `partner_reachable_${surface}`),
      ...(isGameMediaStorageAvailable() ? [] : ["media_storage_unavailable"]),
    ],
    partner: {
      contactSurfaces: inspected.partnerSurfaces,
      exists: inspected.partnerExists,
      gameEnabled: isGameEnabledFor(APP_REVIEW_PARTNER_MEMBER_ID),
      id: APP_REVIEW_PARTNER_MEMBER_ID,
    },
    plan: {
      live: {
        dayOne: live.dayOne,
        lastDay: addDays(live.dayOne, LIVE_GAME.lengthDays - 1),
        partnerPostedToday: true,
        round: LIVE_GAME.round,
        today: seedToday(now),
        todayDay: -LIVE_GAME.dayOneOffset + 1,
      },
      photos: photos.size,
      settled: {
        dayOne: settled.dayOne,
        holderIsReviewer: true,
        lastDay: addDays(settled.dayOne, SETTLED_GAME.lengthDays - 1),
        round: SETTLED_GAME.round,
        scores: { partner: score(APP_REVIEW_PARTNER_MEMBER_ID), reviewer: inspected.reviewer ? score(inspected.reviewer) : 0 },
        ticketUseBy: ticketUseBy(settled.settledAt!).toISOString(),
      },
      timeZone: APP_REVIEW_GAME_TIME_ZONE,
    },
    replacedGames: replaced,
    reviewMember: {
      gameEnabled: inspected.reviewer ? isGameEnabledFor(inspected.reviewer) : false,
      gameProfile: inspected.reviewerGameProfile,
      id: inspected.reviewer,
      phoneVerified: inspected.reviewerPhoneVerified,
      suspended: inspected.reviewerSuspended,
    },
    sends: "none",
  };
}

// ------------------------------------------------------------------- build

function seedToday(now: Date): string {
  return gameLocalDate(now, APP_REVIEW_GAME_TIME_ZONE);
}

/** A local hour on a game day (3 is when the day starts), never after now. */
function at(date: string, hour: number, now: Date): Date {
  const instant = new Date(dayStartInstant(date, APP_REVIEW_GAME_TIME_ZONE).getTime() + (hour - 3) * HOUR_MS);
  return instant.getTime() > now.getTime() ? now : instant;
}

function seatOf(by: Seat): number {
  return by === "partner" ? 0 : 1;
}

/** The game's rule state and dates. Ids are fresh; mediaKeys are filled in at prepare. */
function buildGame(seed: SeedGame, members: Members, now: Date, mediaKeys: Readonly<Record<string, string>> | null): BuiltGame {
  const id = randomUUID();
  const dayOne = addDays(seedToday(now), seed.dayOneOffset);
  const startedAt = at(addDays(dayOne, -1), 12, now);
  const createdAt = new Date(startedAt.getTime() - 2 * HOUR_MS);
  const stakeKey = generateHostedRandomPrefixedId("gsk");
  const terms: StoredTerms = { v: 1, versions: [{ checkInKind: "any", fromDay: 0, n: 1, schedule: { days: [...ALL_DAYS] },
    stakes: [{ key: stakeKey, kind: seed.stake.kind }] }] };
  const words: TermWords = { v: 1, versions: [{ n: 1, stakes: [{ item: seed.stake.item, key: stakeKey }],
    tasks: [{ seat: 0, text: seed.tasks.partner }, { seat: 1, text: seed.tasks.reviewer }] }] };
  const entryIds = seed.entries.map(() => randomUUID());
  const entries: RuleEntry[] = seed.entries.map((entry, index) => ({
    attempt: 1,
    blurHash: null,
    dayIndex: entry.day,
    id: entryIds[index],
    incomplete: false,
    kind: entry.kind,
    mediaKeys: entry.kind === "photo" && mediaKeys ? [mediaKeys[entry.photo]] : [],
    memberId: members[entry.by],
    receivedAt: at(addDays(dayOne, entry.day), entry.hour, now),
    withdrawnAt: null,
  }));
  const state: RuleState = {
    entries,
    game: { createdBy: members.partner, id, inviteExpiresAt: null, inviteeMemberId: seed.round > 1 ? members.reviewer : null,
      lengthDays: seed.lengthDays, seats: GAME_SEATS_1V1, startsOn: null, status: "live", terms },
    players: (["partner", "reviewer"] as const).map((by) => ({
      dayOne, memberId: members[by], seat: seatOf(by), timeZone: APP_REVIEW_GAME_TIME_ZONE })),
  };
  // Settled a few minutes after it was due, as the first read after the end would.
  const settledAt = seed.settled ? new Date(settleDueAt(state).getTime() + 5 * 60 * 1000) : null;
  return { createdAt, dayOne, entryIds, id, seed, settledAt, startedAt, state, terms, words };
}

interface Prepared {
  games: BuiltGame[];
  partnerName: string;
  reviewerName: string;
  /** Sealed words by seal target key. */
  sealed: Map<string, string>;
}

/** KMS sealing and image uploads stay outside the transaction. */
async function prepare(members: Members, now: Date, readPhoto: HostedOpsAppReviewGamePhotoReader): Promise<Prepared> {
  // Content-addressed: a repeat upload of the same image is a no-op.
  const mediaKeys = Object.fromEntries(await Promise.all(Object.entries(APP_REVIEW_GAME_PHOTOS).map(async ([name, publicPath]) =>
    [name, await putGameMedia({ bytes: await readPhoto(publicPath), contentType: "image/jpeg", prefix: mediaKeyPrefixFor(members.partner) })] as const)));
  const games = [buildGame(SETTLED_GAME, members, now, mediaKeys), buildGame(LIVE_GAME, members, now, mediaKeys)];
  const targets: { target: GameSealTarget; value: string }[] = [];
  for (const game of games) {
    targets.push({ target: { field: "terms_words", memberId: members.partner, rowId: game.id, table: "game" }, value: JSON.stringify(game.words) });
    game.seed.entries.forEach((entry, index) => {
      if (entry.kind !== "words") return;
      targets.push({ target: { field: "text", memberId: members[entry.by], rowId: game.entryIds[index], table: "game_entry" }, value: entry.text });
    });
  }
  const [partnerName, reviewerName, ...values] = await Promise.all([
    seal(profileTarget(members.partner), PARTNER_NAME),
    seal(profileTarget(members.reviewer), REVIEWER_NAME),
    ...targets.map(({ target, value }) => seal(target, value)),
  ]);
  return { games, partnerName, reviewerName, sealed: new Map(targets.map(({ target }, index) => [sealKey(target), values[index]])) };
}

function profileTarget(memberId: string): GameSealTarget {
  return { field: "first_name", memberId, rowId: memberId, table: "game_profile" };
}

function sealKey(target: GameSealTarget): string {
  return `${target.table}:${target.rowId}:${target.field}`;
}

async function seal(target: GameSealTarget, value: string): Promise<string> {
  const sealed = await sealGameText(target, value);
  if (!sealed) throw new Error("Game encryption returned nothing.");
  return sealed;
}

async function writeGame(tx: Prisma.TransactionClient, game: BuiltGame, members: Members, prepared: Prepared, previousGameId: string | null): Promise<void> {
  const { seed, state } = game;
  const settled = seed.settled ? decideSettle(state) : null;
  const termsWordsEncrypted = prepared.sealed.get(`game:${game.id}:terms_words`);
  if (!termsWordsEncrypted) throw new Error("App Review game words were not sealed.");
  await tx.game.create({
    data: {
      createdAt: game.createdAt,
      createdBy: members.partner,
      id: game.id,
      inviteeMemberId: state.game.inviteeMemberId ?? null,
      lengthDays: seed.lengthDays,
      liveRosterKey: settled ? null : liveRosterKey([members.partner, members.reviewer]),
      previousGameId,
      result: settled ? toPrismaJsonObject(settled.result) : Prisma.DbNull,
      round: seed.round,
      settledAt: game.settledAt,
      startedAt: game.startedAt,
      status: settled ? "settled" : "live",
      terms: toPrismaJsonObject(game.terms),
      termsWordsEncrypted,
    },
  });
  await tx.gamePlayer.createMany({
    data: state.players.map((player) => ({
      dayOne: new Date(`${player.dayOne}T00:00:00Z`),
      gameId: game.id,
      joinedAt: player.seat === 0 ? game.createdAt : game.startedAt,
      memberId: player.memberId,
      seat: player.seat,
      timeZone: player.timeZone,
    })),
  });
  await tx.gameEntry.createMany({
    data: state.entries.map((entry) => ({
      attempt: entry.attempt,
      dayIndex: entry.dayIndex,
      gameId: game.id,
      id: entry.id,
      kind: entry.kind,
      mediaKeys: entry.mediaKeys,
      memberId: entry.memberId,
      receivedAt: entry.receivedAt,
      textEncrypted: prepared.sealed.get(`game_entry:${entry.id}:text`) ?? null,
    })),
  });
  if (settled) {
    await tx.gameTicket.createMany({
      data: settled.tickets.map((ticket) => ({ ...ticket, createdAt: game.settledAt!, gameId: game.id, id: generateHostedRandomPrefixedId("gtk") })),
    });
  }
  // Provenance only; nothing reads it, and no history type here starts a chat notice.
  await tx.gameEvent.create({
    data: { actor: "system", gameId: game.id, payload: { round: seed.round, v: 1 }, type: "app_review_seeded" },
  });
}
