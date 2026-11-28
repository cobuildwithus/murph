import "server-only";
import { getPrisma } from "../prisma";
import { openPinRows, readPinRows, readWorkingSelections, workingFactor } from "./storage";

/** Settings approval covers the owner's retained choices and outgoing cheers after withdrawal. */
export async function prepareHealthProfileExport(memberId: string, assertCurrent: () => Promise<void>) {
  const db = getPrisma();
  const readMark = await db.healthNotificationRead.findUnique({ where: { memberId }, select: { through: true } });
  const pinRows = await readPinRows(memberId);
  const working = await readWorkingSelections(memberId);
  const cover = await db.gameProfile.findUnique({ where: { memberId }, select: { coverKind: true, coverArt: true, coverPhotoKey: true } });
  const readCheers = (after?: { ownerId: string; factor: string }) => db.healthWorkingOnCheer.findMany({
    where: { memberId, ...(after && { OR: [{ ownerId: { gt: after.ownerId } }, { ownerId: after.ownerId, factor: { gt: after.factor } }] }) },
    orderBy: [{ ownerId: "asc" }, { factor: "asc" }], take: 64, select: { ownerId: true, factor: true, createdAt: true },
  });
  const first = await readCheers();
  if (!readMark && !pinRows.length && !working.length && !first.length && (!cover || cover.coverKind === "none")) return null;
  return async function* records() {
    await assertCurrent();
    const pins = await openPinRows(memberId, pinRows);
    await assertCurrent();
    yield JSON.stringify({ healthProfile: {
      ...(readMark && { notificationsSeenThrough: readMark.through }),
      cover: cover?.coverKind === "art" ? { art: cover.coverArt } : cover?.coverKind === "photo" ? { photoKey: cover.coverPhotoKey } : null,
      pins: pins.map(({ row, stored }) => ({ key: row.sourceKey, ...stored })),
      workingOn: working.map(({ factor, since }) => ({ factor, since })),
    } }) + "\n";
    let page = first;
    while (page.length) {
      await assertCurrent();
      yield JSON.stringify({ workingOnCheers: page.map(row => ({ ownerId: row.ownerId, createdAt: row.createdAt, factor: workingFactor(row.ownerId, row.factor) })) }) + "\n";
      if (page.length < 64) return;
      page = await readCheers(page.at(-1));
    }
  };
}
