import "server-only";
import { readProfilePairBoard } from "../game/board";
import { gameMediaUrl } from "../game/views";
import { getPrisma } from "../prisma";
import { assertProfileAccess, type ProfileAuth, type ProfileDb } from "./access";
import { factorInfo, factors, formatReading } from "./factors";
import type { PairBoard } from "../game/board-numbers";
import { readWorkingSelections, storedPins } from "./storage";
import { publishedPins } from "./pins";
import { currentPartners, currentStreakRevisions, readProfileStreaks } from "./streaks";
import { profileWorking } from "./working-on";

type Streaks = Awaited<ReturnType<typeof readProfileStreaks>>;
type Numbers = PairBoard["people"][number]["numbers"] | undefined;

function compareRows(theirs: Numbers, mine: Numbers, currentStreaks: Streaks) {
  const compare: { label: string; them: string; you: string }[] = [];
  for (const f of factors) {
    const metric = factorInfo[f].board;
    if (!metric) continue;
    const a = theirs?.[metric], b = mine?.[metric];
    if (a?.state === "available" && b?.state === "available" && !a.stale && !b.stale) {
      compare.push({ label: factorInfo[f].title, them: formatReading(f, a.latest.value), you: formatReading(f, b.latest.value) });
    }
  }
  for (const s of currentStreaks) {
    if (s.peerCount !== undefined) compare.push({ label: s.row.title, them: String(s.row.count), you: String(s.peerCount) });
  }
  return compare;
}

function profileCover(cover: { coverKind: string; coverArt: string | null; coverPhotoKey: string | null } | null) {
  if (cover?.coverKind === "photo" && cover.coverPhotoKey) return { kind: "photo", url: gameMediaUrl(cover.coverPhotoKey) };
  return cover?.coverKind === "art" ? { kind: "art", key: cover.coverArt } : null;
}

async function viewerAge(viewer: string, compare: boolean) {
  if (!compare) return null;
  const rows = (await storedPins(viewer)).filter(p => p.stored.kind === "age");
  const [published] = await publishedPins(viewer, rows);
  return published && { row: rows[0].row, published };
}

export async function prepareExtendedProfile(auth: ProfileAuth, owner: string, signal: AbortSignal) {
  const db = getPrisma(), viewer = auth.member.id, isMe = viewer === owner;
  await assertProfileAccess(db, auth, owner);
  const profile = await db.gameProfile.findUnique({ where: { memberId: owner },
    select: { timeZone: true } });
  const pinRows = await storedPins(owner);
  const items = await readWorkingSelections(owner, viewer);
  const streaks = await readProfileStreaks(owner, viewer);
  const pins = await publishedPins(owner, pinRows, isMe ? streaks : undefined);
  const theirAge = pins.find(p => p.card.kind === "biological_age");
  const myAge = await viewerAge(viewer, !isMe && Boolean(theirAge));
  const pair = isMe ? null : await readProfilePairBoard(viewer, owner, items.some(i => i.factor === "bedtime")).catch(error => {
    // A game partner can have a group game and no pair board.
    if (error?.code === "GAME_NOT_FOUND" || error?.code === "BOARD_PROJECTION_UNAVAILABLE") return null;
    throw error;
  });
  const zone = profile?.timeZone ?? "UTC";
  const ownWorking = isMe ? await profileWorking(auth, owner, zone, null, signal, items) : null;
  return async (tx: ProfileDb) => {
    await assertProfileAccess(tx, auth, owner);
    const published = await tx.healthProfilePin.findMany({ where: { memberId: owner }, select: { sourceKey: true, specEncrypted: true }, take: 3 });
    const working = await tx.healthWorkingOn.findMany({ where: { memberId: owner }, select: { factor: true, since: true }, take: 3 });
    const myAgeCurrent = myAge && await tx.healthProfilePin.findFirst({ where: { memberId: viewer, sourceKey: myAge.row.sourceKey,
      specEncrypted: myAge.row.specEncrypted }, select: { position: true } });
    const revisions = await currentStreakRevisions(tx, owner, viewer, streaks.map(s => s.row.gameId));
    const partners = await currentPartners(tx, viewer, streaks.flatMap(s => s.row.partner ? [s.row.partner.memberId] : []));
    const cover = await tx.gameProfile.findUnique({ where: { memberId: owner }, select: { coverKind: true, coverPhotoKey: true, coverArt: true } });
    const shared = await pair?.atDisclosure(tx);
    const board = shared?.board;
    const workingRows = ownWorking ?? await profileWorking(auth, owner, zone, board ?? null, signal, items, shared?.sleepTimes);
    const visiblePins = pins.filter(p => published.some(r => r.sourceKey === p.key
      && pinRows.some(old => old.row.sourceKey === p.key && old.row.specEncrypted === r.specEncrypted)));
    const currentStreaks = streaks.filter(s => revisions.get(s.row.gameId) === s.revision);
    const theirs = board?.people.find(p => p.memberId === owner)?.numbers;
    const mine = board?.people.find(p => p.memberId === viewer)?.numbers;
    const compare = compareRows(theirs, mine, currentStreaks);
    if (theirAge && myAge && myAgeCurrent && visiblePins.includes(theirAge)) {
      compare.unshift({ label: "Biological age", them: theirAge.card.title.number, you: myAge.published.card.title.number });
    }
    return { numbers: theirs ?? null, extras: { isMe,
      cover: profileCover(cover),
      pins: visiblePins.map(pin => isMe ? pin : { key: pin.key, card: pin.card, ...(pin.pinnedOn && { pinnedOn: pin.pinnedOn }) }), workingOn: workingRows.filter((_, index) => working.some(r => r.factor === items[index].lookup && r.since === items[index].since)),
      streaks: currentStreaks.map(({ row }) => {
        const fresh = partners.find(p => p.id === row.partner?.memberId);
        return { ...row, partner: fresh && row.partner ? { ...row.partner, avatarUrl: fresh.photoKey ? gameMediaUrl(fresh.photoKey) : null } : null };
      }), compare: isMe ? null : { rows: compare } } };
  };
}

export async function readExtendedProfile(auth: ProfileAuth, owner: string, signal: AbortSignal) {
  const finish = await prepareExtendedProfile(auth, owner, signal);
  return getPrisma().$transaction(finish, { isolationLevel: "RepeatableRead" });
}
