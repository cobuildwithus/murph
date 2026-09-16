import type { HostedRuntimeMigrationCommand } from "@murphai/hosted-execution/runtime-migration";
import type { Prisma, PrismaClient } from "@prisma/client";

// Resolve Web-only implementation at runtime, following this testkit's existing
// cross-app seam. Worker compilation must not adopt Web's private path aliases.
const prismaModule = new URL("../../src/lib/prisma.ts", import.meta.url).href;
const migrationModule = new URL("../../src/lib/hosted-execution/runtime-migration.ts", import.meta.url).href;
const cutoverModule = new URL("../../src/lib/hosted-execution/runtime-cutover.ts", import.meta.url).href;
const cryptoModule = new URL("../../src/lib/hosted-crypto/domain-root-store.ts", import.meta.url).href;
type Backend = "legacy" | "draining" | "postgres";


/** Public cross-app proof seam: actual Web commands and Postgres transactions,
 * scoped to an unused loopback fixture database and explicitly owned identities.
 */
export async function createHostedRuntimeMigrationRehearsalForTest(input: {
  databaseUrl: string; userIds: string[]; objectIds: string[];
}) {
  const url = new URL(input.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname) || url.searchParams.has("host")) throw new Error("Migration rehearsal requires an isolated loopback database.");
  const { createPrismaClient } = await import(prismaModule) as {
    createPrismaClient(input: { databaseUrl: string; poolMax: number }): PrismaClient;
  };
  const { executeHostedRuntimeMigrationCommand } = await import(migrationModule) as {
    executeHostedRuntimeMigrationCommand(input: { prisma: PrismaClient; command: HostedRuntimeMigrationCommand }): Promise<Record<string, unknown>>;
  };
  const { lockHostedRuntimeMemberCutoverTx, readHostedRuntimeMemberBackend } = await import(cutoverModule) as {
    lockHostedRuntimeMemberCutoverTx(tx: Prisma.TransactionClient, userId: string): Promise<Backend>;
    readHostedRuntimeMemberBackend(prisma: PrismaClient, userId: string): Promise<Backend>;
  };
  const { provisionHostedCryptoDomainRootsForUser } = await import(cryptoModule) as {
    provisionHostedCryptoDomainRootsForUser(input: { prisma: PrismaClient; userId: string; reason: string }): Promise<unknown>;
  };
  const prisma = createPrismaClient({ databaseUrl: input.databaseUrl, poolMax: 4 });
  const original = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
  if (original.phase !== "legacy" || original.namespaceId || await prisma.hostedRuntimeLegacyImport.count()) {
    await prisma.$disconnect(); throw new Error("Migration rehearsal requires an unused legacy campaign.");
  }
  return {
    prisma,
    command: (command: HostedRuntimeMigrationCommand) => executeHostedRuntimeMigrationCommand({ prisma, command }),
    backend: (userId: string) => readHostedRuntimeMemberBackend(prisma, userId),
    callback: (userId: string) => prisma.$transaction(tx => lockHostedRuntimeMemberCutoverTx(tx, userId)),
    async seed(userId: string) {
      if (!input.userIds.includes(userId)) throw new Error("Rehearsal member is outside the fixture scope.");
      await prisma.hostedMember.create({ data: { id: userId, billingStatus: "active" } });
      await provisionHostedCryptoDomainRootsForUser({ prisma, userId, reason: "synthetic-migration-rehearsal" });
    },
    async close() {
      try {
        await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: original });
        await prisma.hostedRuntimeLegacyImport.deleteMany({ where: { objectId: { in: input.objectIds } } });
        await prisma.hostedMember.deleteMany({ where: { id: { in: input.userIds } } });
        await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: input.userIds } } });
      } finally { await prisma.$disconnect(); }
    },
  };
}
