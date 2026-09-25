import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { openAuthRecord } from "./record-crypto";
import { AuthRecordChangedError } from "./adapter";

// Same twenty-session bound as existing browser issuance. Caller holds the
// canonical member lock; every row is authenticated before any deletion.
export async function makeHostedAuthSessionRoomTx(prisma: Prisma.TransactionClient, memberId: string): Promise<void> {
  const rows = await prisma.hostedAuthRecord.findMany({
    where: { model: "session", memberId }, take: 21, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length > 20) throw new Error("Authentication session bound exceeded.");
  for (const row of rows) await openAuthRecord(row, prisma);
  if (rows.length < 20) return;
  const result = await prisma.hostedAuthRecord.deleteMany({ where: { ...rows[0] } });
  if (result.count !== 1) throw new AuthRecordChangedError();
}

// Prepare all possible revocation/issuance reads before locks. The existing
// twenty-session ceiling bounds both decryption work and the commit snapshot.
// A concurrent issuance/renewal is a retry, never an unwrap under the lock.
export async function prepareHostedAuthSessionSet(prisma: PrismaClient, memberId: string) {
  const read = (db: PrismaClient | Prisma.TransactionClient) => db.hostedAuthRecord.findMany({
    where: { model: "session", memberId }, take: 21, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const rows = await read(prisma);
  if (rows.length > 20) throw new Error("Authentication session bound exceeded.");
  for (const row of rows) await openAuthRecord(row, prisma);
  const expected = JSON.stringify(rows);
  return {
    async assertCurrentTx(tx: Prisma.TransactionClient) {
      if (JSON.stringify(await read(tx)) !== expected) throw new AuthRecordChangedError();
    },
  };
}
