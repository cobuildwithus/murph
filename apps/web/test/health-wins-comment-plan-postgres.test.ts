import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { healthCommentPageSql } from "../src/lib/health-wins/read";
import { buildCurrentHostedConsentDocumentVersions } from "../src/lib/legal/consent";
import { getPrisma } from "../src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("The comment plan proof requires an isolated loopback test database.");
}

const viewer = "plan-member-3500", poster = "plan-member-1025";
const publicComments = 17;
const fixtureTables = [
  "hosted_member", "hosted_account_group", "hosted_account_group_membership", "hosted_consent_grant", "health_post_comment",
].map(name => Prisma.raw(name));

async function seedCommentPage(tx: Prisma.TransactionClient, postId: string) {
  for (const table of fixtureTables) {
    await tx.$executeRaw`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`;
  }
  await tx.$executeRaw`INSERT INTO hosted_member (id, billing_status, updated_at)
    SELECT 'plan-member-' || i, (CASE WHEN i BETWEEN 1025 AND 2048 THEN 'not_started' ELSE 'active' END)::"HostedBillingStatus", now()
    FROM generate_series(1, 8192) i`;
  await tx.$executeRaw`INSERT INTO hosted_account_group (id, owner_member_id, billing_status, updated_at)
    SELECT 'plan-group-' || i, 'plan-member-' || i, 'active', now() FROM generate_series(1, 1024) i`;
  await tx.$executeRaw`INSERT INTO hosted_account_group_membership (id, group_id, member_id, role, updated_at)
    SELECT 'plan-seat-' || i, 'plan-group-' || i, 'plan-member-' || (1024 + i), 'member', now()
    FROM generate_series(1, 1024) i`;
  for (const scope of ["launch.legal", "launch.health-data"] as const) {
    const versions = JSON.stringify(buildCurrentHostedConsentDocumentVersions(scope));
    await tx.$executeRaw`INSERT INTO hosted_consent_grant (member_id, scope, document_versions_json, source, granted_at, updated_at)
      SELECT id, ${scope}, ${versions}::jsonb, 'test', now(), now() FROM hosted_member`;
  }
  await tx.$executeRaw`INSERT INTO health_post_comment (id, post_id, author_member_id, created_at, visibility, body_encrypted)
    SELECT gen_random_uuid(), ${postId}::uuid, ${poster}, timestamptz '2033-01-01' + i * interval '1 second',
      CASE WHEN i <= ${publicComments} THEN 'everyone' ELSE 'poster' END, 'unused'
    FROM generate_series(1, 3000) i`;
  for (const table of fixtureTables) await tx.$executeRaw`ANALYZE pg_temp.${table}`;
}

interface PlanNode {
  "Relation Name"?: string;
  "Actual Rows": number;
  "Actual Loops": number;
  "Rows Removed by Filter"?: number;
  Plans?: PlanNode[];
}

function authorRowsVisited(node: PlanNode): number {
  const local = node["Relation Name"] === "hosted_member"
    ? node["Actual Loops"] * (node["Actual Rows"] + (node["Rows Removed by Filter"] ?? 0))
    : 0;
  return local + (node.Plans ?? []).reduce((sum, child) => sum + authorRowsVisited(child), 0);
}

describe.skipIf(!enabled)("comment page eligibility plan", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("checks only candidate authors after skipping newer poster-only comments under either rollout", async () => {
    const postId = randomUUID();
    await getPrisma().$transaction(async tx => {
      await seedCommentPage(tx, postId);
      for (const rollout of [[viewer, poster].join(","), "*"]) {
        vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", rollout);
        const query = healthCommentPageSql(viewer, postId, poster);
        const [result] = await tx.$queryRaw<Array<{ "QUERY PLAN": [{ Plan: PlanNode }] }>>`
          EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF) ${query}`;
        const plan = result["QUERY PLAN"][0].Plan;
        expect(plan["Actual Rows"]).toBe(publicComments);
        const work = authorRowsVisited(plan);
        expect(work).toBeGreaterThan(0);
        expect(work).toBeLessThanOrEqual(publicComments);
      }
      const query = healthCommentPageSql(viewer, postId, poster);
      // This author qualifies through a group. Lapsed personal billing independently restores eligibility.
      await tx.$executeRaw`UPDATE hosted_account_group SET suspended_at = now() WHERE id = 'plan-group-1'`;
      expect(await tx.$queryRaw(query)).toHaveLength(0);
      await tx.$executeRaw`UPDATE hosted_member SET billing_status = 'past_due' WHERE id = ${poster}`;
      expect(await tx.$queryRaw(query)).toHaveLength(publicComments);
    }, { timeout: 30_000 });
  });
});
