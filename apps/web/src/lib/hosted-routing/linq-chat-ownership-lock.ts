import type { Prisma } from "@prisma/client";

import { normalizeHostedOpaqueInput } from "../hosted-onboarding/contact-privacy";

export async function acquireHostedLinqChatOwnershipLockTx(input: {
  chatId: string | number | null | undefined;
  tx: Pick<Prisma.TransactionClient, "$executeRaw">;
}): Promise<void> {
  const chatId = normalizeHostedOpaqueInput(input.chatId);
  if (!chatId) {
    throw new TypeError("Hosted Linq chat ownership lock requires a non-empty chat id.");
  }

  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-linq-routing:chat"}),
      hashtext(${chatId})
    )
  `;
}
