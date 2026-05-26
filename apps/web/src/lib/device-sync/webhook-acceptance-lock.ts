import type { Prisma } from "@prisma/client";

export async function tryAcquireHostedWebhookAcceptanceLockTx(input: {
  prisma: Pick<Prisma.TransactionClient, "$queryRaw">;
  connectionId: string;
}): Promise<boolean> {
  const rows = await input.prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_xact_lock(
      hashtext('hosted-webhook-acceptance'),
      hashtext(${input.connectionId})
    ) AS "acquired"
  `;

  return rows.some((row) => row.acquired === true);
}
