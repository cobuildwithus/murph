import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";

import { runHostedAccountDeletionCleanup } from "@/src/lib/hosted-privacy/account-deletion-cleanup";

const crypto = vi.hoisted(() => ({ decrypt: vi.fn() }));
vi.mock("@/src/lib/hosted-crypto/env", () => ({ getHostedWebCryptoConfig: () => ({ env: "test", gcpKms: { decrypt: crypto.decrypt } }) }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname) || url.searchParams.has("host")) throw new Error("Cleanup enrollment proof requires an isolated loopback database.");
}
describe.skipIf(!enabled)("ordinary encrypted cleanup after runtime migration", () => {
  let prisma: PrismaClient;
  const cleanupIds: string[] = [];
  const memberIds: string[] = [];
  const identities = (count: number) => {
    const ids = Array.from({ length: count }, () => `synthetic_deleted_${randomUUID()}`); memberIds.push(...ids); return ids;
  };
  async function cleanup(ids: string[]) {
    const now = new Date(); const id = `synthetic_cleanup_${randomUUID()}`; cleanupIds.push(id);
    return prisma.hostedAccountDeletionCleanup.create({ data: { id, environment: "test", nextAttemptAt: now,
      kmsKeyName: "projects/murph-test/locations/global/keyRings/test/cryptoKeys/account-cleanup",
      payloadCiphertext: Buffer.from(JSON.stringify({ schema: "murph.hosted-account-deletion-cleanup.v1", runtimeMemberIds: ids,
        privyUserId: null, stripeCustomerIds: [] })).toString("base64"),
      cloudflareCompletedAt: now, stripeCompletedAt: now, runtimeLogsCompletedAt: now, temporalCompletedAt: now } });
  }
  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 4 });

  });
  beforeEach(() => {
    crypto.decrypt.mockReset().mockImplementation(async ({ ciphertext }: { ciphertext: string }) => ({ plaintext: new Uint8Array(Buffer.from(ciphertext, "base64")) }));
  });
  afterEach(async () => {
    await prisma.hostedAccountDeletionCleanup.deleteMany({ where: { id: { in: cleanupIds } } });
    await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: memberIds } } });
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it("preserves ordinary cleanup deletion", async () => {
    const receipt = await cleanup(identities(1));
    await expect(prisma.hostedAccountDeletionCleanup.delete({ where: { id: receipt.id } })).resolves.toMatchObject({ id: receipt.id });
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });
  it.each([1, 201])("finishes ordinary cleanup for %i identities without migration enrollment", async count => {
    const ids = identities(count); const receipt = await cleanup(ids);
    await prisma.hostedRuntimeOwner.create({ data: { userId: ids[0]!, migrationPhase: "postgres", generation: 11n } });
    expect(await runHostedAccountDeletionCleanup({ prisma, cleanupId: receipt.id })).toMatchObject({ cleanupPending: false });
    expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toBeNull();
    expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: ids[0]! } })).toMatchObject({ generation: 11n });
    expect(await prisma.hostedRuntimeOwner.count({ where: { userId: { in: ids } } })).toBe(1);
  });
});
