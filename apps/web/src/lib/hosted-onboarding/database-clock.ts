import { Prisma, type PrismaClient } from "@prisma/client";

type HostedDatabaseClockClient = PrismaClient | Prisma.TransactionClient;

export async function readHostedDatabaseClock(
  prisma: HostedDatabaseClockClient,
): Promise<Date> {
  const rows = await prisma.$queryRaw<Array<{ now: Date | string }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  const value = rows[0]?.now;
  const now = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Hosted database clock did not return a valid timestamp.");
  }
  return now;
}
