import "server-only";

import { getPrisma } from "../prisma";
import { openRecordedActivitySummaries } from "./recorded-summary";

const PAGE_SIZE = 64;

/** The Settings approval authorizes the owner's retained summaries, including after withdrawal. */
export async function prepareRecordedActivityExport(memberId: string, assertCurrent: () => Promise<void>) {
  const db = getPrisma();
  const through = new Date();
  function readPage(after?: { day: string; id: string }) {
    return db.healthActivity.findMany({
      where: {
        memberId,
        deletedAt: null,
        createdAt: { lte: through },
        ...(after && {
          day: { gte: after.day },
          OR: [{ day: { gt: after.day } }, { day: after.day, id: { gt: after.id } }],
        }),
      },
      select: { memberId: true, id: true, day: true, createdAt: true, postId: true, summaryEncrypted: true },
      orderBy: [{ day: "asc" }, { id: "asc" }],
      take: PAGE_SIZE,
    });
  }

  const firstPage = await readPage();
  if (!firstPage.length) return null;
  return async function* records() {
    let rows = firstPage;
    while (rows.length) {
      await assertCurrent();
      const summaries = await openRecordedActivitySummaries(rows);
      await assertCurrent();
      const recordedActivities = rows.map(({ day, createdAt, postId }, index) => ({
        ...summaries[index], day, createdAt, postId,
      }));
      yield JSON.stringify({ recordedActivities }) + "\n";
      if (rows.length < PAGE_SIZE) return;
      rows = await readPage(rows[rows.length - 1]);
    }
  };
}
