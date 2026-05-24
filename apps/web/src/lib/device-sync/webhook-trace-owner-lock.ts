import type { Prisma } from "@prisma/client";

export async function acquireHostedWebhookTraceOwnerLockTx(input: {
  prisma: Pick<Prisma.TransactionClient, "$executeRaw">;
  provider: string;
  providerAccountBlindIndex: string;
}): Promise<void> {
  const provider = input.provider.trim();
  const providerAccountBlindIndex = input.providerAccountBlindIndex.trim();

  if (!provider || !providerAccountBlindIndex) {
    throw new TypeError("Hosted webhook trace owner lock requires a provider and blind index.");
  }

  await input.prisma.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted-webhook-trace-owner'),
      hashtext(${`${provider}:${providerAccountBlindIndex}`})
    )
  `;
}
