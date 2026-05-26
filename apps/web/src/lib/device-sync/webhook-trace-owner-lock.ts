import type { Prisma } from "@prisma/client";

type HostedWebhookTraceOwnerLockInput<TPrisma> = {
  prisma: TPrisma;
  provider: string;
  providerAccountBlindIndex: string;
};

export async function acquireHostedWebhookTraceOwnerLockTx(input: {
  prisma: Pick<Prisma.TransactionClient, "$executeRaw">;
  provider: string;
  providerAccountBlindIndex: string;
}): Promise<void> {
  const lockKey = readHostedWebhookTraceOwnerLockKey(input);

  await input.prisma.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted-webhook-trace-owner'),
      hashtext(${lockKey})
    )
  `;
}

export async function tryAcquireHostedWebhookTraceOwnerLockTx(input: {
  prisma: Pick<Prisma.TransactionClient, "$queryRaw">;
  provider: string;
  providerAccountBlindIndex: string;
}): Promise<boolean> {
  const lockKey = readHostedWebhookTraceOwnerLockKey(input);
  const rows = await input.prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_xact_lock(
      hashtext('hosted-webhook-trace-owner'),
      hashtext(${lockKey})
    ) AS "acquired"
  `;

  return rows.some((row) => row.acquired === true);
}

function readHostedWebhookTraceOwnerLockKey(
  input: HostedWebhookTraceOwnerLockInput<unknown>,
): string {
  const provider = input.provider.trim();
  const providerAccountBlindIndex = input.providerAccountBlindIndex.trim();

  if (!provider || !providerAccountBlindIndex) {
    throw new TypeError("Hosted webhook trace owner lock requires a provider and blind index.");
  }

  return `${provider}:${providerAccountBlindIndex}`;
}
