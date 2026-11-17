import { pathToFileURL } from "node:url";
import { getPrisma } from "../../src/lib/prisma";
import { openProgressMany } from "../../src/lib/game/progress/crypto";
import type { Candidate } from "../../src/lib/game/progress/registry";
import { runWithHostedDomainRootUnwrapCache } from "../../src/lib/hosted-crypto/domain-root-unwrap-cache";

/** Run in the hosted environment after old Progress writers have drained. */
export async function removeProgressStreakAwards(): Promise<number> {
  const db = getPrisma();
  let after: { memberId: string; lookup: string } | undefined;
  let deleted = 0;
  for (;;) {
    const rows = await db.gameProgressAward.findMany({
      where: after ? { OR: [{ memberId: { gt: after.memberId } },
        { memberId: after.memberId, lookup: { gt: after.lookup } }] } : {},
      orderBy: [{ memberId: "asc" }, { lookup: "asc" }], take: 100,
      select: { memberId: true, lookup: true, dataEncrypted: true },
    });
    if (rows.length === 0) return deleted;
    const data = await runWithHostedDomainRootUnwrapCache(() => openProgressMany<Candidate>(rows.map(row => ({
      memberId: row.memberId, table: "game_progress_award", rowId: row.lookup, field: "data", value: row.dataEncrypted,
    }))));
    const retired = rows.flatMap((row, index) => data[index].kind === "streak"
      ? [{ memberId: row.memberId, lookup: row.lookup }] : []);
    if (retired.length) deleted += (await db.gameProgressAward.deleteMany({ where: { OR: retired } })).count;
    after = rows.at(-1)!;
  }
}

async function main(): Promise<void> {
  try {
    console.log(JSON.stringify({ deletedAwards: await removeProgressStreakAwards() }));
  } finally {
    await getPrisma().$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => { console.error("Progress streak award migration failed."); process.exitCode = 1; });
}
