import "server-only";
import type { Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import type { ClientUnits } from "../companion/client-info";
import { readGameVerifiedContacts, verifiedGameContactKeys } from "../game/audience";
import { openGameTexts } from "../game/crypto";
import { assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { gameMediaUrl } from "../game/views";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { factorInfo } from "../health-profile/factors";
import { workingFactor } from "../health-profile/storage";
import { isHealthYouEnabled } from "../health-wins/flag";
import { assertPrivateHealthAuthority, withInputAuthority } from "../health-wins/input-authority";
import { getPrisma } from "../prisma";
import { ownEvents, type OwnEvent } from "./private";
import { socialRows, type SocialRow } from "./social";

type Person = { memberId: string; firstName: string; avatarUrl: string | null };
const order = (a: { at: string; id: string }, b: { at: string; id: string }) =>
  b.at.localeCompare(a.at) || a.id.localeCompare(b.id);

export async function advanceMark(auth: HostedNativeMemberAuth, through: Date) {
  const member = auth.member.id;
  await getPrisma().$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId: member, prisma: tx });
    await tx.$executeRaw`INSERT INTO health_notification_read (member_id, through)
      VALUES (${member}, least(${through}::timestamptz, statement_timestamp()))
      ON CONFLICT (member_id) DO UPDATE SET through = excluded.through
      WHERE health_notification_read.through < excluded.through`;
  });
}

async function identities(db: Prisma.TransactionClient, rows: SocialRow[], signal: AbortSignal) {
  const ids = [...new Set(rows.flatMap(row => row.actors))];
  const profiles = ids.length ? await db.gameProfile.findMany({ where: { memberId: { in: ids } },
    select: { memberId: true, firstNameEncrypted: true, photoKey: true } }) : [];
  const names = await openGameTexts(profiles.map(p => ({ table: "game_profile", field: "first_name",
    rowId: p.memberId, memberId: p.memberId, value: p.firstNameEncrypted })), signal);
  return new Map(profiles.map((p, i) => [p.memberId, { memberId: p.memberId,
    firstName: names[i] || "A friend", avatarUrl: p.photoKey ? gameMediaUrl(p.photoKey) : null }]));
}

async function inviteTokens(db: Prisma.TransactionClient, rows: SocialRow[], signal: AbortSignal) {
  const ids = rows.filter(r => r.kind === "challenge").map(r => r.target);
  const games = ids.length ? await db.game.findMany({ where: { id: { in: ids } },
    select: { id: true, wordsOwnerMemberId: true, inviteTokenEncrypted: true } }) : [];
  const values = await openGameTexts(games.map(g => ({ table: "game", field: "invite_token", memberId: g.wordsOwnerMemberId,
    rowId: g.id, value: g.inviteTokenEncrypted })), signal);
  return new Map(games.map((g, i) => [g.id, values[i]]));
}

function socialNote(row: SocialRow, member: string, mark: Date, people: Map<string, Person>, invites: Map<string, string | null>) {
  const actors = row.actors.flatMap(id => people.get(id) ?? []);
  if (!actors.length) return null;
  const lead = actors[0].firstName + (row.count > 1 ? ` and ${row.count - 1} other${row.count === 2 ? "" : "s"}` : "");
  const base = { kind: row.kind, id: row.id, at: row.at.toISOString(), unread: row.at > mark,
    actors, actorCount: row.count, lead };
  switch (row.kind) {
    case "cheer": case "reply": case "comment":
      return { ...base, text: row.kind === "cheer" ? "cheered your post." : row.kind === "reply" ? "replied to your comment." : "commented on your post.",
        thumb: { kind: "post", postId: row.target }, open: { kind: "post", postId: row.target } };
    case "workingOnCheer": {
      const factor = workingFactor(member, row.target);
      if (!factor) return null;
      const open = { kind: "workingOn", factor };
      return { ...base, text: `cheered your work on ${factorInfo[factor].title.toLowerCase()}.`, open, thumb: open };
    }
    case "ticket":
      return { ...base, text: row.owed ? "earned a ticket from you." : row.count === 1 ? "owes you a ticket." : "owe you a ticket.",
        thumb: { kind: "ticket" }, open: { kind: "tickets" } };
    case "joined":
      return { ...base, text: "joined your game.", open: { kind: "game", gameId: row.target } };
    case "challenge": {
      const token = invites.get(row.target);
      return token ? { ...base, text: "invited you to a challenge.", open: { kind: "invite", token },
        action: { kind: "join", label: "Join", gameId: row.target, inviteToken: token } } : null;
    }
  }
}

function ownNote(e: OwnEvent, mark: Date) {
  const base = { id: e.kind === "milestone" ? e.key : e.kind + ":" + (e.eventId ?? e.key), kind: e.kind, at: e.at.toISOString(),
    unread: !e.seen && e.at > mark, actors: [], actorCount: 0, lead: e.kind === "ageChange" ? "Your" : "You", text: e.text };
  if (e.kind === "ageChange") return { ...base, open: { kind: "health" } };
  if (e.kind === "winReady") return { ...base, action: { kind: "post", label: "Post", winId: e.key } };
  const key = e.key.slice("milestone:".length);
  return { ...base, thumb: { kind: "medal", art: e.art }, open: { kind: "milestone", key },
    action: { kind: "post", label: "Post", milestoneKey: key } };
}

export async function readNotifications(auth: HostedNativeMemberAuth, signal: AbortSignal, units: ClientUnits, countOnly = false) {
  const db = getPrisma(), member = auth.member.id;
  return withInputAuthority(() => assertPrivateHealthAuthority(auth), async () => {
    const [profile, contacts] = await Promise.all([
      db.gameProfile.findUnique({ where: { memberId: member }, select: { timeZone: true } }), readGameVerifiedContacts(member),
    ]);
    if (!profile) return countOnly ? { unread: 0 } : { unread: 0, highlights: [], items: [] };
    const now = new Date(), from = new Date(now.getTime() - 30 * 86400000);
    const social = async () => socialRows(member, from, now, profile.timeZone,
      contacts.length ? await verifiedGameContactKeys(db, member, contacts) : [], isHealthYouEnabled(member));
    const [rows, own] = await Promise.all([social(), ownEvents(member, profile.timeZone, from, now, signal, units, countOnly)]);
    const page = rows.slice(0, 80);
    const [people, invites] = countOnly ? [new Map<string, Person>(), new Map<string, string | null>()]
      : await Promise.all([identities(db, page, signal), inviteTokens(db, page, signal)]);
    // A hide, departure, or consent change during name decryption also removes the actor from the count.
    const current = !countOnly && rows.length ? await social() : rows;
    const read = await db.healthNotificationRead.findUnique({ where: { memberId: member } });
    const mark = read?.through ?? new Date(0);
    const unread = Math.min(99, current.filter(r => r.at > mark).length + own.filter(e => !e.seen && e.at > mark).length);
    if (countOnly) return { unread };
    const personal = own.map(e => ownNote(e, mark));
    const socialNotes = current.slice(0, 80).flatMap(row => socialNote(row, member, mark, people, invites) ?? []);
    return { unread, highlights: personal.filter(e => e.kind !== "ageChange").sort(order).slice(0, 3),
      items: [...socialNotes, ...personal.filter(e => e.kind === "ageChange")].sort(order).slice(0, 80) };
  });
}
