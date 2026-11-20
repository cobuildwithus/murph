import "server-only";
import type { Prisma } from "@prisma/client";
import { toLocalDayKey } from "@murphai/contracts";
import { getPrisma } from "../../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import { isHiddenBy, readGameBlocks } from "../blocks";
import { labelTarget, openGameTexts } from "../crypto";
import { departedLabels } from "../row";
import { gameMediaUrl } from "../views";
import { gameHttpError } from "../http/errors";
import type { FriendSeries } from "./friends";

type Db = Pick<Prisma.TransactionClient, "game" | "gamePlayer" | "gameBlock" | "gameProfile">;

/** Current, unblocked players from games the member has played. */
export async function friendCohortIds(memberId: string, db: Db) {
  const games = await db.game.findMany({ where: { events: { none: { type: "cancelled" } },
    status: { in: ["live", "settled"] }, players: { some: { memberId, leftAt: null, joinedAt: { not: null } } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { players: { take: 10, select: { memberId: true, joinedAt: true, leftAt: true,
      profile: { select: { member: { select: { suspendedAt: true } } } } } } } });
  const ids = [...new Set([memberId, ...games.flatMap(game => game.players.flatMap(player =>
    player.memberId && player.joinedAt && !player.leftAt && !player.profile!.member.suspendedAt ? [player.memberId] : []))])];
  const blocks = await readGameBlocks(db, memberId, ids);
  const latest = await db.gamePlayer.findFirst({
    where: { memberId: null, leftAt: { not: null }, departedLabel: { array_contains: [{ ownerMemberId: memberId }] },
      game: { events: { none: { type: "cancelled" } }, players: { some: { memberId, joinedAt: { not: null }, leftAt: null } } },
      OR: [{ game: { status: { in: ["live", "settled"] } } }, { game: { status: "void" }, joinedAt: { not: null } }] },
    orderBy: [{ leftAt: "desc" }, { gameId: "asc" }, { seat: "asc" }],
    select: { leftAt: true, departedLabel: true },
  });
  const label = departedLabels(latest?.departedLabel ?? null).find(label => label.ownerMemberId === memberId);
  const departure = latest?.leftAt && label ? { on: latest.leftAt, nameEncrypted: label.nameEncrypted } : null;
  return { ids: ids.filter(id => !isHiddenBy(blocks, id)), departure };
}

export async function readFriendCohort(memberId: string) {
  const db = getPrisma(), cohort = await friendCohortIds(memberId, db);
  const profiles = await db.gameProfile.findMany({ where: { memberId: { in: cohort.ids } },
    take: cohort.ids.length, orderBy: { memberId: "asc" },
    select: { memberId: true, firstNameEncrypted: true, photoKey: true, createdAt: true, timeZone: true } });
  const ownProfile = profiles.find(profile => profile.memberId === memberId);
  if (!ownProfile) throw gameHttpError("PROFILE_REQUIRED", 409, "Add your first name and time zone first.");
  const names = await runWithHostedDomainRootUnwrapCache(() => openGameTexts([
    ...profiles.map(profile => ({ table: "game_profile" as const,
      field: "first_name", rowId: profile.memberId, memberId: profile.memberId, value: profile.firstNameEncrypted })),
    ...cohort.departure ? [{ ...labelTarget(memberId, "name"), value: cohort.departure.nameEncrypted }] : [],
  ]));
  const people: FriendSeries[] = profiles.map((profile, index) => ({
    memberId: profile.memberId, firstName: names[index]!, avatarUrl: profile.photoKey ? gameMediaUrl(profile.photoKey) : null,
    me: profile.memberId === memberId, joinedOn: toLocalDayKey(profile.createdAt, profile.timeZone), daily: null,
  }));
  return { people, departure: cohort.departure,
    timeZone: ownProfile.timeZone,
    departureNotice: cohort.departure
      ? `${names[profiles.length] ?? "A friend"} left Murph on ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ownProfile.timeZone }).format(cohort.departure.on)}. Your games with them still count in your totals.` : null };
}
