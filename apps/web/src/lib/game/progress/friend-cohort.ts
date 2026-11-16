import "server-only";
import type { Prisma } from "@prisma/client";
import { toLocalDayKey } from "@murphai/contracts";
import { getPrisma } from "../../prisma";
import { runWithHostedDomainRootUnwrapCache } from "../../hosted-crypto/domain-root-unwrap-cache";
import { isHiddenBy, readGameBlocks } from "../blocks";
import { labelTarget, openGameTexts } from "../crypto";
import { departedLabels } from "../account-deletion";
import { gameMediaUrl, pendingInviteeLabel } from "../views";
import { isGameInviteExpired } from "../rules";
import { gameHttpError } from "../http/errors";
import type { FriendSeries } from "./friends";

type Db = Pick<Prisma.TransactionClient, "game" | "gameBlock" | "gameProfile">;

/** Played friends and the member's current invitations have separate data audiences. */
export async function friendCohortIds(memberId: string, db: Db) {
  const games = await db.game.findMany({ where: { events: { none: { type: "cancelled" } }, OR: [
    { status: { in: ["live", "settled"] }, players: { some: { memberId, leftAt: null, joinedAt: { not: null } } } },
    { createdBy: memberId, status: { in: ["invited", "negotiating", "live"] }, players: { some: { memberId, leftAt: null } } },
  ] },
    take: 501, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, status: true, createdBy: true, inviteExpiresAt: true,
      players: { take: 10, select: { memberId: true, seat: true, joinedAt: true, leftAt: true, departedLabel: true,
        profile: { select: { member: { select: { suspendedAt: true } } } } } },
      invitees: { where: { game: { createdBy: memberId }, OR: [{ memberId: null }, { member: { suspendedAt: null } }] },
        take: 9, select: { seat: true, memberId: true, pendingLabel: true } } } });
  if (games.length > 500) return { ids: [memberId], invited: [], incomplete: true, departure: null };
  const played = games.filter(game => ["live", "settled"].includes(game.status)
    && game.players.some(player => player.memberId === memberId && player.joinedAt && !player.leftAt));
  const ids = [...new Set([memberId, ...played.flatMap(game => game.players.flatMap(player =>
    player.memberId && player.joinedAt && !player.leftAt && !player.profile!.member.suspendedAt ? [player.memberId] : []))])];
  const pending = games.filter(game => game.createdBy === memberId && ["invited", "negotiating", "live"].includes(game.status)
    && !isGameInviteExpired(game, new Date())).flatMap(game => game.invitees
    .filter(invitee => !game.players.some(player => player.seat === invitee.seat))
    .map(invitee => ({ memberId: invitee.memberId ?? `invite:${game.id}:${invitee.seat}`,
      label: pendingInviteeLabel(invitee.pendingLabel) })));
  const blocks = await readGameBlocks(db, memberId, [...ids, ...pending.map(person => person.memberId)]);
  const invited = [...new Map(pending.map(person => [person.memberId, person])).values()]
    .filter(person => !ids.includes(person.memberId) && !isHiddenBy(blocks, person.memberId));
  const departure = games.flatMap(game => game.players.flatMap(player => {
    if (player.memberId !== null || !player.leftAt) return [];
    const label = departedLabels(player.departedLabel).find(label => label.ownerMemberId === memberId);
    return label ? [{ on: player.leftAt, nameEncrypted: label.nameEncrypted }] : [];
  })).sort((a, b) => b.on.getTime() - a.on.getTime())[0] ?? null;
  return { ids: ids.filter(id => !isHiddenBy(blocks, id)), invited, incomplete: false, departure };
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
    ...cohort.invited.map(person => ({ ...labelTarget(memberId, "name"), value: person.label.nameEncrypted })),
  ]));
  const current = await friendCohortIds(memberId, db);
  const people: FriendSeries[] = profiles.flatMap((profile, index) => current.ids.includes(profile.memberId) ? [{
    memberId: profile.memberId, firstName: names[index]!, avatarUrl: profile.photoKey ? gameMediaUrl(profile.photoKey) : null,
    me: profile.memberId === memberId, invited: false,
    joinedOn: toLocalDayKey(profile.createdAt, profile.timeZone), daily: null,
  }] : []);
  cohort.invited.forEach((person, index) => {
    if (!current.invited.some(invitee => invitee.memberId === person.memberId)) return;
    people.push({ memberId: person.memberId, firstName: names[profiles.length + Number(cohort.departure !== null) + index] ?? "",
      avatarUrl: person.label.photoKey ? gameMediaUrl(person.label.photoKey) : null,
      me: false, invited: true, joinedOn: null, daily: null });
  });
  return { people, incomplete: cohort.incomplete || current.incomplete,
    timeZone: ownProfile.timeZone,
    departureNotice: cohort.departure && current.departure?.nameEncrypted === cohort.departure.nameEncrypted
      ? `${names[profiles.length] ?? "A friend"} left Murph on ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: ownProfile.timeZone }).format(cohort.departure.on)}. Your games with them still count in your totals.` : null };
}
