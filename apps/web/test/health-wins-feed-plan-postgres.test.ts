import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { healthPostPageSql } from "../src/lib/health-wins/read";
import { buildCurrentHostedConsentDocumentVersions } from "../src/lib/legal/consent";
import { getPrisma } from "../src/lib/prisma";

interface PlanNode {
  "Index Name"?: string;
  "Index Cond"?: string;
  "Actual Rows": number;
  Plans?: PlanNode[];
}

function findIndexSeek(node: PlanNode, indexName: string, condition: string): PlanNode | undefined {
  if (node["Index Name"] === indexName && node["Index Cond"]?.includes(condition)) return node;
  for (const child of node.Plans ?? []) {
    const found = findIndexSeek(child, indexName, condition);
    if (found) return found;
  }
}

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("The feed plan proof requires an isolated loopback test database.");
}

describe.skipIf(!enabled)("health post query plans", () => {
  it("seeks feed and profile pages by author and a post detail by primary key", async () => {
    const viewer = randomUUID(), partner = randomUUID(), other = randomUUID();
    const members = [viewer, partner, other];
    const sharedGame = randomUUID(), otherGames = Array.from({ length: 30 }, () => randomUUID());
    const games = [sharedGame, ...otherGames];
    const db = getPrisma();
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", members.join(","));
    try {
      await db.hostedMember.createMany({ data: members.map(id => ({ id, billingStatus: "active" as const })) });
      await db.gameProfile.createMany({ data: members.map(memberId => ({ memberId, timeZone: "UTC", firstNameEncrypted: "unused" })) });
      const scopes = ["launch.legal", "launch.health-data"] as const;
      await db.hostedConsentGrant.createMany({ data: members.flatMap(memberId => scopes.map(scope => ({
        memberId, scope, source: "test", status: "granted", grantedAt: new Date(),
        documentVersionsJson: buildCurrentHostedConsentDocumentVersions(scope),
      }))) });
      await db.game.createMany({ data: games.map(id => ({
        id, createdBy: partner, wordsOwnerMemberId: partner, status: "settled" as const, terms: {}, termsWordsEncrypted: "unused",
      })) });
      await db.gamePlayer.createMany({ data: games.flatMap(gameId =>
        [partner, gameId === sharedGame ? viewer : other].map((memberId, seat) => ({
          gameId, memberId, seat, timeZone: "UTC", dayOne: new Date(), joinedAt: new Date(),
        }))) });
      await db.$transaction(async tx => {
        // Isolate both the table's cardinality and planner statistics from parallel route fixtures.
        await tx.$executeRaw`CREATE TEMP TABLE health_post (LIKE public.health_post INCLUDING ALL) ON COMMIT DROP`;
        // The CI database can still have its predeploy indexes.
        await tx.$executeRaw`DROP INDEX IF EXISTS pg_temp.health_post_deleted_at_created_at_id_idx`;
        const postId = randomUUID();
        await tx.$executeRaw`INSERT INTO health_post (id, author_member_id, created_at)
          SELECT CASE WHEN i = 1 THEN ${postId}::uuid ELSE gen_random_uuid() END,
            CASE WHEN i % 2 = 1 THEN ${viewer} ELSE ${randomUUID()} END,
            timestamptz '2032-04-03' - i * interval '1 second'
          FROM generate_series(1, 20000) AS i`;
        const cursor = { createdAt: new Date("2032-04-02T21:00:00.000Z"), id: randomUUID() };
        // Newer payoffs belong to the partner's other games. The first page must reach past all of them.
        const visible = Array.from({ length: 21 }, () => randomUUID());
        await tx.$executeRaw`INSERT INTO health_post (id, author_member_id, game_id, created_at)
          SELECT gen_random_uuid(), ${partner}, game_id, ${cursor.createdAt}::timestamptz - i * interval '1 millisecond'
          FROM unnest(${otherGames}::text[]) WITH ORDINALITY AS games(game_id, i)`;
        await tx.$executeRaw`INSERT INTO health_post (id, author_member_id, created_at)
          SELECT post_id, ${partner}, ${cursor.createdAt}::timestamptz - (i + 30) * interval '1 millisecond'
          FROM unnest(${visible}::uuid[]) WITH ORDINALITY AS posts(post_id, i)`;
        await tx.$executeRaw`ANALYZE pg_temp.health_post`;
        const explain = async (query: ReturnType<typeof healthPostPageSql>) => {
          const [result] = await tx.$queryRaw<Array<{ "QUERY PLAN": [{ Plan: PlanNode }] }>>`
            EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF) ${query}`;
          return result["QUERY PLAN"][0].Plan;
        };
        for (const filter of [{ cursor }, { author: partner, cursor }]) {
          const query = healthPostPageSql(viewer, filter);
          const rows = await tx.$queryRaw<{ id: string }[]>(query);
          expect(rows.map(row => row.id)).toEqual(visible);
          const plan = await explain(query);
          expect(plan["Actual Rows"]).toBe(21);
          const seek = findIndexSeek(plan, "health_post_author_member_id_deleted_at_created_at_id_idx", "ROW(created_at, id)");
          expect(seek?.["Actual Rows"]).toBe(21);
        }
        const detail = await explain(healthPostPageSql(viewer, { postId }));
        expect(detail["Actual Rows"]).toBe(1);
        expect(findIndexSeek(detail, "health_post_pkey", postId)?.["Actual Rows"]).toBe(1);
      }, { timeout: 30_000 });
    } finally {
      vi.unstubAllEnvs();
      await db.game.deleteMany({ where: { id: { in: games } } });
      await db.hostedMember.deleteMany({ where: { id: { in: members } } });
    }
  });
});
