import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";
import { expect, test, vi } from "vitest";

test("PrismaPg recognizes the hosted web pg Pool as an external pool", async () => {
  const pool = new pg.Pool({
    connectionString: "postgresql://example.invalid/db",
  });
  const adapter = await new PrismaPg(pool, {
    disposeExternalPool: true,
  }).connect();

  try {
    expect(adapter.underlyingDriver()).toBe(pool);
  } finally {
    await adapter.dispose();
  }
});

test("Vercel registration and Prisma disposal retain one real pool lifecycle", async () => {
  const pool = new pg.Pool({
    connectionString: "postgresql://example.invalid/db",
  });
  const releaseListenersBefore = pool.listenerCount("release");
  const end = vi.spyOn(pool, "end");

  attachDatabasePool(pool);
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, {
      disposeExternalPool: true,
    }),
  });

  expect(pool.listenerCount("release")).toBe(releaseListenersBefore + 1);
  await prisma.$connect();
  await prisma.$disconnect();

  expect(end).toHaveBeenCalledOnce();
});
