import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { claimHostedRuntime } from "../src/lib/hosted-execution/runtime-owner";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/u.test(url.pathname) || url.search || url.hash) {
    throw new Error("Runtime contract proof requires an isolated loopback test database.");
  }
}

/** Actual history includes the trigger bodies and their real dependent tables. */
async function installHistory(url: URL) {
  const root = new URL("../prisma/migrations/", import.meta.url);
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const sql = await Promise.all(directories.map(name => readFile(new URL(`${name}/migration.sql`, root), "utf8")));
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    input: sql.join("\n"), stdio: ["pipe", "ignore", "pipe"],
    env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port,
      PGUSER: url.username, PGPASSWORD: url.password, PGDATABASE: url.pathname.slice(1) },
  });
}

describe.skipIf(!enabled)("switched runtime client against retained historical schema", () => {
  it("admits current work and preserves exact owners, uploads and cleanup guards", async () => {
    const name = `murph_test_runtime_contract_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    const url = new URL(databaseUrl); url.pathname = `/${name}`;
    const client = new pg.Client({ connectionString: url.toString() });
    let prisma: PrismaClient | undefined;
    try {
      await client.connect();
      await installHistory(url);
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
      await client.query("UPDATE hosted_runtime_cutover SET phase = 'postgres' WHERE id = 'runtime'");
      const owner = await prisma.hostedRuntimeOwner.create({ data: {
        userId: "synthetic-retained-owner", generation: 17n, phase: "idle",
        allocationId: "synthetic-allocation", runnerContainerName: "synthetic-retained-target",
      } });
      const pending = await prisma.hostedRuntimePutDrain.create({ data: {
        userId: owner.userId, writeId: "synthetic-upload", kind: "snapshot", attemptId: "synthetic-attempt",
        generation: 17n, admittedAt: new Date("2030-01-01T00:00:00Z"), objectKey: "synthetic-object",
        uploadId: "synthetic-provider-upload", encryptedByteSize: 123n, encryptedSha256: "a".repeat(64),
      } });
      const receipt = await prisma.hostedAccountDeletionCleanup.create({ data: {
        id: "synthetic-cleanup", payloadCiphertext: "synthetic-ciphertext", kmsKeyName: "synthetic-key",
        environment: "test", nextAttemptAt: new Date("2030-01-01T00:00:00Z"),
      } });
      // Old workflow-pinned clients may still select retired fields. Keep their
      // physical schema and terminal campaign row while the new client omits them.
      await prisma.hostedMember.create({ data: { id: "synthetic-current-member", billingStatus: "active" } });
      const claimed = await claimHostedRuntime({ prisma, userId: "synthetic-current-member", processingMode: "default" });
      expect(claimed).toMatchObject({ status: "claimed", cutover: "postgres", owner: { phase: "starting", generation: 1n } });
      await prisma.hostedMember.delete({ where: { id: "synthetic-current-member" } });
      expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: "synthetic-current-member" } }))
        .toMatchObject({ phase: "starting", generation: 1n });
      expect((await client.query("SELECT phase FROM hosted_runtime_cutover WHERE id = 'runtime'")).rows)
        .toEqual([{ phase: "postgres" }]);
      expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: owner.userId } })).toEqual(owner);
      expect(await prisma.hostedRuntimePutDrain.findUnique({ where: { userId_writeId: { userId: pending.userId, writeId: pending.writeId } } })).toEqual(pending);
      expect(await prisma.hostedAccountDeletionCleanup.findUnique({ where: { id: receipt.id } })).toEqual(receipt);
      // Omitting the retired census field must leave live cleanup guards intact.
      await expect(prisma.hostedAccountDeletionCleanup.delete({ where: { id: receipt.id } }))
        .rejects.toThrow("still owns isolated runtime-log deletion");
      await prisma.hostedAccountDeletionCleanup.update({ where: { id: receipt.id },
        data: { runtimeLogsCompletedAt: new Date("2030-01-01T00:01:00Z") } });
      await expect(prisma.hostedAccountDeletionCleanup.delete({ where: { id: receipt.id } }))
        .rejects.toThrow("still owns Temporal workflow termination");
      await prisma.hostedAccountDeletionCleanup.update({ where: { id: receipt.id },
        data: { temporalCompletedAt: new Date("2030-01-01T00:02:00Z") } });
      await prisma.hostedAccountDeletionCleanup.delete({ where: { id: receipt.id } });
      expect(await prisma.hostedRuntimeOwner.findUnique({ where: { userId: owner.userId } })).toEqual(owner);
      expect(await prisma.hostedRuntimePutDrain.count({ where: { completedAt: null } })).toBe(1);
    } finally {
      await prisma?.$disconnect();
      await client.end();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
    }
  });
});
