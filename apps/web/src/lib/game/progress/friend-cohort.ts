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

/** Only current, unblocked people from games already played enter the friends audience. */
export async function friendCohortIds(memberId: string, db: Db) {
  const games = await db.game.findMany({ where: { status: { in: ["live", "settled"] },
    players: { some: { memberId, leftAt: null, joinedAt: { not: null } } } },
    take: 501, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { players: { where: { OR: [{ leftAt: null, joinedAt: { not: null }, memberId: { not: null },
      profile: { member: { suspendedAt: null } } }, { memberId: null, leftAt: { not: null } }] },
      take: 10, select: { memberId: true, leftAt: true, departedLabel: true } } } });
  if (games.length > 500) return { ids: [memberId], incomplete: true, departure: null };
  const ids = [...new Set([memberId, ...games.flatMap(game => game.players.flatMap(player => player.memberId ? [player.memberId] : []))])];
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
  const current = await friendCohortIds(memberId, db);
  const people: FriendSeries[] = profiles.flatMap((profile, index) => current.ids.includes(profile.memberId) ? [{
    memberId: profile.memberId, firstName: names[index]!, avatarUrl: profile.photoKey ? gameMediaUrl(profile.photoKey) : null,
    me: profile.memberId === memberId, invited: false,
    joinedOn: toLocalDayKey(profile.createdAt, profile.timeZone), daily: null,
  }] : []);
  return { people, incomplete: cohort.incomplete || current.incomplete,
    timeZone: ownProfile.timeZone,
    departureNotice: cohort.departure && current.departure?.nameEncrypted === cohort.departure.nameEncrypted
      ? `${names[profiles.length] ?? "A friend"} left Murph on ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ownProfile.timeZone }).format(cohort.departure.on)}. Your games with them still count in your totals.` : null };
}
