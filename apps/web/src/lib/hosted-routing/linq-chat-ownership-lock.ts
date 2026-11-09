import type { Prisma } from "@prisma/client";

import { normalizeHostedOpaqueInput } from "../hosted-onboarding/contact-privacy";
import {
  buildHostedLinqParticipantContactLockValue,
  type HostedLinqParticipantContact,
} from "../hosted-onboarding/linq-participant-contact";

export async function acquireHostedLinqChatOwnershipLockTx(input: {
  chatId: string | number | null | undefined;
  participantContact?: HostedLinqParticipantContact;
  tx: Pick<Prisma.TransactionClient, "$executeRaw">;
}): Promise<void> {
  const chatId = normalizeHostedOpaqueInput(input.chatId);
  if (!chatId) {
    throw new TypeError("Hosted Linq chat ownership lock requires a non-empty chat id.");
  }

  if (input.participantContact) {
    const lockValue = buildHostedLinqParticipantContactLockValue(input.participantContact);
    // Consume the participant lock result before acquiring the chat lock.
    // Route reads must remain a following statement for a fresh snapshot.
    await input.tx.$executeRaw`
      WITH participant AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(
          hashtext('hosted-linq-routing:participant-contact'), hashtext(${lockValue})
        )
      )
      SELECT pg_advisory_xact_lock(hashtext(${"hosted-linq-routing:chat"}), hashtext(${chatId}))
      FROM participant
    `;
    return;
  }

  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-linq-routing:chat"}),
      hashtext(${chatId})
    )
  `;
}
