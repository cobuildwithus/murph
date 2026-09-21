import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addHostedExecutionRuntimeAuthority,
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution/auth";
import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";

// Substitute only the database handle: signature/replay validation, owner locks,
// access policy and the mailbox projection all execute their production code.
const database = vi.hoisted(() => ({ current: null as PrismaClient | null }));
vi.mock("@/src/lib/prisma", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/prisma")>(),
  getPrisma: () => {
    if (!database.current) throw new Error("Synthetic callback database is not initialized.");
    return database.current;
  },
}));
import { POST } from "../app/api/internal/hosted-mailbox/fetch/route";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) throw new Error("Callback SQL proof requires local PostgreSQL.");
}
afterEach(() => { vi.unstubAllEnvs(); database.current = null; });

describe.skipIf(!enabled)("signed runtime callback SQL load", () => {
  it("counts replay protection, ownership, access and mailbox SQL together", async () => {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }),
      log: [{ emit: "event", level: "query" }] });
    let statements = 0;
    client.$on("query", () => { statements += 1; });
    // This extension preserves all used public client operations, including transactions.
    const baseline = client.$extends({ query: { $allModels: {
      async findUnique({ args, query }) { return query({ ...args, relationLoadStrategy: "query" }); },
      async findFirst({ args, query }) { return query({ ...args, relationLoadStrategy: "query" }); },
      async findMany({ args, query }) { return query({ ...args, relationLoadStrategy: "query" }); },
    } } }) as PrismaClient;
    const suffix = randomUUID();
    const owner = `callback_owner_${suffix}`;
    const member = `callback_member_${suffix}`;
    const container = `callback_container_${suffix}`;
    const ids = [owner, member, container];
    const group = `callback_group_${suffix}`;
    const attemptId = `callback_attempt_${suffix}`;
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", "v1");
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK", JSON.stringify(publicJwk));
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON", JSON.stringify({ v1: publicJwk }));
    const signedRequest = async (userId: string, generation = "1") => {
      const url = new URL("/api/internal/hosted-mailbox/fetch", "https://web.example.test");
      addHostedExecutionRuntimeAuthority(url, { attemptId, generation, workspaceVersion: "1" });
      const payload = JSON.stringify({ cursorMode: "imported_seq", requestId: randomUUID(), limitPerLane: 10,
        lanes: [{ lane: "conversation", importedSeq: "0" }, { lane: "system", importedSeq: "0" }] });
      const nonce = randomUUID();
      const timestamp = new Date().toISOString();
      const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey,
        encodeHostedExecutionSignedRequestPayload({ method: "POST", path: url.pathname, search: url.search,
          payload, nonce, timestamp, userId }));
      return new Request(url, { method: "POST", body: payload, headers: {
        "content-type": "application/json",
        [HOSTED_EXECUTION_NONCE_HEADER]: nonce,
        [HOSTED_EXECUTION_SIGNATURE_HEADER]: Buffer.from(signature).toString("base64url"),
        [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: "v1",
        [HOSTED_EXECUTION_TIMESTAMP_HEADER]: timestamp,
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      } });
    };
    let previousPhase: string | undefined;
    try {
      previousPhase = (await client.hostedRuntimeCutover.findUnique({ where: { id: "runtime" } }))?.phase;
      await client.hostedRuntimeCutover.upsert({ where: { id: "runtime" },
        create: { id: "runtime", phase: "postgres" }, update: { phase: "postgres" } });
      await client.hostedMember.createMany({ data: ids.map(id => ({ id,
        billingStatus: id === owner ? "active" : "not_started" })) });
      await client.hostedMemberBillingRef.create({ data: { memberId: owner, currentBillingPlanCode: "launch_monthly",
        stripeSubscriptionLookupKey: `test_subscription_${suffix}` } });
      await client.hostedAccountGroup.create({ data: { id: group, ownerMemberId: owner, billingStatus: "active" } });
      await client.hostedAccountGroupMembership.create({ data: { id: `callback_membership_${suffix}`,
        groupId: group, memberId: member, role: "member" } });
      await client.hostedThreadContainer.create({ data: { memberId: container, ownerMemberId: owner } });
      await client.hostedRuntimeOwner.createMany({ data: ids.map(userId => ({ userId, attemptId, generation: 1n,
        migrationPhase: "postgres", phase: "active", workspaceVersion: 1n })) });
      const sample = async (prisma: PrismaClient) => {
        database.current = prisma;
        statements = 0;
        const responses = [];
        for (let index = 0; index < 60; index += 1) {
          const response = await POST(await signedRequest(ids[index % ids.length]!));
          const body = await response.json();
          expect(response.status, JSON.stringify(body)).toBe(200);
          expect(body.items).toEqual([]);
          const { fetchedAt, ...stable } = body;
          expect(typeof fetchedAt).toBe("string");
          responses.push(stable);
        }
        return { statements, responses };
      };
      const before = await sample(baseline);
      const after = await sample(client);
      expect(after.responses).toEqual(before.responses);
      process.stdout.write(JSON.stringify({ label: "Synthetic 60 signed empty-mailbox callbacks",
        before: before.statements, after: after.statements }) + "\n");
      expect(after.statements).toBeLessThanOrEqual(before.statements / 2);

      // Optimized reads retain replay protection and reject a stale owner.
      const request = await signedRequest(owner);
      const replay = request.clone();
      expect((await POST(request)).status).toBe(200);
      expect((await POST(replay)).status).toBe(401);
      expect((await POST(await signedRequest(owner, "2"))).status).toBe(409);
      await client.hostedMember.update({ where: { id: owner }, data: { suspendedAt: new Date() } });
      expect((await POST(await signedRequest(owner))).status).toBe(403);
      expect((await POST(await signedRequest(container))).status).toBe(403);
    } finally {
      await client.hostedWebInternalRequestNonce.deleteMany({ where: { userId: { in: ids } } });
      await client.hostedRuntimeOwner.deleteMany({ where: { userId: { in: ids } } });
      await client.hostedThreadContainer.deleteMany({ where: { memberId: container } });
      await client.hostedAccountGroup.deleteMany({ where: { id: group } });
      await client.hostedMember.deleteMany({ where: { id: { in: ids } } });
      if (previousPhase !== undefined) {
        await client.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: { phase: previousPhase } });
      } else {
        await client.hostedRuntimeCutover.deleteMany({ where: { id: "runtime" } });
      }
      await client.$disconnect();
    }
  });
});
