import { randomUUID } from "node:crypto";
import {
  type AddressInfo,
  createConnection,
  createServer,
  type Socket,
} from "node:net";

import { describe, expect, it, vi } from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresRetryProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const runTcpRetryProof = runPostgresRetryProof
  && isClearlyLocalTcpPostgresUrl(databaseUrl);

if (
  runPostgresRetryProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted database retry PostgreSQL proof requires a local DATABASE_URL.",
  );
}

/**
 * The unit suite proves the retry policy against fabricated errors. This proves
 * that real local saturation is returned as backpressure without re-entering
 * the pool queue, that a pre-dispatch connection failure is retried through the
 * real adapter and pool, and that a callback which already ran is never replayed.
 */
describe.skipIf(!runPostgresRetryProof)(
  "hosted web database retry (real PostgreSQL)",
  () => {
    it("does not retry a real transaction-start timeout under local saturation", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        const { holding, release } = await holdTheOnlyConnection(prisma);
        let callbackRuns = 0;

        try {
          await expect(prisma.$transaction(async (tx) => {
            callbackRuns += 1;
            await tx.$queryRaw`select 1`;
          }, { maxWait: 900, timeout: 10_000 })).rejects.toMatchObject({
            code: "P2028",
          });
        } finally {
          release();
          await holding;
        }

        expect(callbackRuns).toBe(0);
        expect(loggedCategories(warn)).toEqual(["transaction_start_timeout"]);
      } finally {
        await prisma.$disconnect();
        warn.mockRestore();
      }
    }, 60_000);

    it("does not retry a real checkout timeout or persist the write", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const setup = createPrismaClient({ databaseUrl, poolMax: 2 });
      const table = `murph_retry_proof_${randomUUID().replace(/-/g, "")}`;
      await setup.$executeRawUnsafe(
        `create table "${table}" (id text primary key)`,
      );

      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      try {
        const { holding, release } = await holdTheOnlyConnection(prisma);

        const rowId = randomUUID();
        // Not a transaction: this goes through the $allOperations seam.
        try {
          await expect(prisma.$executeRawUnsafe(
            `insert into "${table}" (id) values ($1)`,
            rowId,
          )).rejects.toThrow();
        } finally {
          release();
          await holding;
        }

        const rows = await setup.$queryRawUnsafe<{ id: string }[]>(
          `select id from "${table}"`,
        );
        expect(rows).toEqual([]);
        expect(loggedCategories(warn)).toEqual(["pool_checkout_timeout"]);
      } finally {
        await prisma.$disconnect();
        await setup.$executeRawUnsafe(`drop table if exists "${table}"`);
        await setup.$disconnect();
        warn.mockRestore();
      }
    }, 90_000);

    it.skipIf(!runTcpRetryProof)(
      "retries a real pre-dispatch connection timeout and persists one ordinary write",
      async () => {
        const fixture = await createRetryProofFixture();
        try {
          const rowId = randomUUID();

          await expect(fixture.prisma.$executeRawUnsafe(
            `insert into "${fixture.table}" (id) values ($1)`,
            rowId,
          )).resolves.toBe(1);

          const rows = await fixture.setup.$queryRawUnsafe<{ id: string }[]>(
            `select id from "${fixture.table}"`,
          );
          expect(rows).toEqual([{ id: rowId }]);
          expect(fixture.proxy.acceptedConnections()).toBe(2);
          expect(loggedFailures(fixture.warn).filter((failure) => (
            failure.source === "operation"
          ))).toEqual([
            expect.objectContaining({
              attempt: 1,
              category: "connection_establishment_timeout",
              disposition: "retrying",
              operation: "$executeRawUnsafe",
            }),
          ]);
        } finally {
          await fixture.close();
        }
      },
      90_000,
    );

    it.skipIf(!runTcpRetryProof)(
      "retries a real pre-dispatch connection timeout before one interactive transaction",
      async () => {
        const fixture = await createRetryProofFixture();
        let callbackRuns = 0;
        try {
          const rowId = randomUUID();

          await expect(fixture.prisma.$transaction(async (tx) => {
            callbackRuns += 1;
            await tx.$executeRawUnsafe(
              `insert into "${fixture.table}" (id) values ($1)`,
              rowId,
            );
            return rowId;
          }, { maxWait: 10_000, timeout: 10_000 })).resolves.toBe(rowId);

          const rows = await fixture.setup.$queryRawUnsafe<{ id: string }[]>(
            `select id from "${fixture.table}"`,
          );
          expect(callbackRuns).toBe(1);
          expect(rows).toEqual([{ id: rowId }]);
          expect(fixture.proxy.acceptedConnections()).toBe(2);
          expect(loggedFailures(fixture.warn).filter((failure) => (
            failure.source === "transaction"
          ))).toEqual([
            expect.objectContaining({
              attempt: 1,
              category: "connection_establishment_timeout",
              disposition: "retrying",
              operation: "transaction.interactive",
            }),
          ]);
        } finally {
          await fixture.close();
        }
      },
      90_000,
    );

    it("never replays a real transaction that opened and then expired", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
      let callbackRuns = 0;

      try {
        // A transaction that outlives its own timeout closes with P2028 too, but
        // its callback already ran, so replaying it could duplicate an effect.
        await expect(prisma.$transaction(async (tx) => {
          callbackRuns += 1;
          await tx.$queryRaw`select 1`;
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          await tx.$queryRaw`select 2`;
        }, { maxWait: 5_000, timeout: 700 })).rejects.toMatchObject({
          code: "P2028",
        });

        expect(callbackRuns).toBe(1);
        expect(loggedCategories(warn)).not.toContain("transaction_start_timeout");
      } finally {
        await prisma.$disconnect();
        warn.mockRestore();
      }
    }, 60_000);
  },
);

/** Occupies the single pooled connection until the returned release runs. */
async function holdTheOnlyConnection(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<{ holding: Promise<unknown>; release: () => void }> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select 1`;
    await held;
  }, { maxWait: 10_000, timeout: 60_000 });

  // Let the holder acquire the connection before the contended call starts.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { holding, release };
}

function loggedCategories(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls
    .filter((call) => call[0] === "Hosted web database pool failure.")
    .map((call) => (call[1] as { category: string }).category);
}

interface LoggedDatabasePoolFailure {
  attempt: number | null;
  category: string;
  disposition: string;
  operation: string;
  source: string;
}

function loggedFailures(
  warn: { mock: { calls: unknown[][] } },
): LoggedDatabasePoolFailure[] {
  return warn.mock.calls
    .filter((call) => call[0] === "Hosted web database pool failure.")
    .map((call) => call[1] as LoggedDatabasePoolFailure);
}

interface FirstConnectionStallProxy {
  acceptedConnections: () => number;
  close: () => Promise<void>;
  databaseUrl: string;
}

async function createRetryProofFixture() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const setup = createPrismaClient({ databaseUrl, poolMax: 2 });
  const table = `murph_retry_proof_${randomUUID().replace(/-/g, "")}`;
  await setup.$executeRawUnsafe(`create table "${table}" (id text primary key)`);
  const proxy = await startFirstConnectionStallProxy(databaseUrl);
  const prisma = createPrismaClient({
    databaseUrl: proxy.databaseUrl,
    poolMax: 1,
  });

  return {
    close: async () => {
      try {
        await prisma.$disconnect();
      } finally {
        try {
          await proxy.close();
        } finally {
          try {
            await setup.$executeRawUnsafe(`drop table if exists "${table}"`);
          } finally {
            try {
              await setup.$disconnect();
            } finally {
              warn.mockRestore();
            }
          }
        }
      }
    },
    prisma,
    proxy,
    setup,
    table,
    warn,
  };
}

/**
 * Keeps the first PostgreSQL startup socket local until pg times it out, then
 * transparently forwards the retry. No bytes from the failed attempt can reach
 * PostgreSQL, so a successful retry is safe to verify with an exactly-once row.
 */
async function startFirstConnectionStallProxy(
  value: string,
): Promise<FirstConnectionStallProxy> {
  if (!isClearlyLocalTcpPostgresUrl(value)) {
    throw new Error("The retry proxy requires a loopback TCP PostgreSQL URL.");
  }

  const directUrl = new URL(value);
  const upstreamHost = directUrl.hostname.replace(/^\[|\]$/g, "");
  const upstreamPort = Number.parseInt(directUrl.port || "5432", 10);
  const sockets = new Set<Socket>();
  let acceptedConnections = 0;

  const trackSocket = (socket: Socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("close", () => sockets.delete(socket));
  };
  const server = createServer((downstream) => {
    acceptedConnections += 1;
    trackSocket(downstream);

    if (acceptedConnections === 1) {
      // Consume the startup packet without forwarding it. pg owns the timeout
      // and closes this socket before the retry opens another connection.
      downstream.resume();
      return;
    }

    const upstream = createConnection({
      host: upstreamHost,
      port: upstreamPort,
    });
    trackSocket(upstream);
    upstream.once("connect", () => {
      downstream.pipe(upstream);
      upstream.pipe(downstream);
    });
    upstream.once("error", () => downstream.destroy());
    downstream.once("close", () => upstream.destroy());
    upstream.once("close", () => downstream.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", handleListening);
  });

  const address = server.address() as AddressInfo;
  const proxyUrl = new URL(value);
  proxyUrl.hostname = "127.0.0.1";
  proxyUrl.port = String(address.port);

  return {
    acceptedConnections: () => acceptedConnections,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    databaseUrl: proxyUrl.toString(),
  };
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}

function isClearlyLocalTcpPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  if (parsed.searchParams.has("host") || parsed.searchParams.has("port")) {
    return false;
  }
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(
    parsed.hostname.toLowerCase(),
  );
}
