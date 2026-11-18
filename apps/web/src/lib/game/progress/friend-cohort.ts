import "server-only";
import type { Prisma } from "@prisma/client";
import { toLocalDayKey } from "@murphai/contracts";
import { getPrisma } from "../../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import { isHiddenBy, readGameBlocks } from "../blocks";
import { labelTarget, openGameTexts } from "../crypto";
import { departedLabels } from "../account-deletion";
import { gameMediaUrl } from "../views";
import { gameHttpError } from "../http/errors";
import type { FriendSeries } from "./friends";

type Db = Pick<Prisma.TransactionClient, "game" | "gameBlock" | "gameProfile">;

/** Current, unblocked players from games the member has played. */
export async function friendCohortIds(memberId: string, db: Db) {
  const games = await db.game.findMany({ where: { events: { none: { type: "cancelled" } },
    status: { in: ["live", "settled"] }, players: { some: { memberId, leftAt: null, joinedAt: { not: null } } } },
    take: 501, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { players: { take: 10, select: { memberId: true, joinedAt: true, leftAt: true, departedLabel: true,
      profile: { select: { member: { select: { suspendedAt: true } } } } } } } });
  if (games.length > 500) return { ids: [memberId], incomplete: true, departure: null };
  const ids = [...new Set([memberId, ...games.flatMap(game => game.players.flatMap(player =>
    player.memberId && player.joinedAt && !player.leftAt && !player.profile!.member.suspendedAt ? [player.memberId] : []))])];
  const blocks = await readGameBlocks(db, memberId, ids);
  const departure = games.flatMap(game => game.players.flatMap(player => {
    if (player.memberId !== null || !player.leftAt) return [];
    const label = departedLabels(player.departedLabel).find(label => label.ownerMemberId === memberId);
    return label ? [{ on: player.leftAt, nameEncrypted: label.nameEncrypted }] : [];
  })).sort((a, b) => b.on.getTime() - a.on.getTime())[0] ?? null;
  return { ids: ids.filter(id => !isHiddenBy(blocks, id)), incomplete: false, departure };
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
  return { people, incomplete: cohort.incomplete, departure: cohort.departure,
    timeZone: ownProfile.timeZone,
    departureNotice: cohort.departure
      ? `${names[profiles.length] ?? "A friend"} left Murph on ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ownProfile.timeZone }).format(cohort.departure.on)}. Your games with them still count in your totals.` : null };
}
