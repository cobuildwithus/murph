import type { Prisma } from "@prisma/client";
import type { HostedExecutionWake } from "@murphai/hosted-execution/contracts";

export const INACTIVITY_MS = 60 * 24 * 60 * 60_000;

export function interactionMemberId(wake: HostedExecutionWake): string | null {
  if (wake.kind !== "conversation.message") return null;
  const message = wake.message;
  if (message.channel === "voice") return wake.userId;
  if (message.channel === "email") {
    return message.threadIsDirect ? wake.userId : null;
  }
  if (message.channel === "linq" && (message.linqMessage.isFromMe || message.groupParticipantAdded)) return null;
  if (message.senderMemberId) return message.senderMemberId;
  const direct = message.channel === "linq" ? message.linqMessage.threadIsDirect : message.telegramMessage.threadIsDirect;
  return !message.routeAuthority && direct !== false ? wake.userId : null;
}

export async function recordRuntimeMemberInteraction(
  db: Pick<Prisma.TransactionClient, "hostedMember">, memberId: string, occurredAt = new Date(), mailboxOwnerId = memberId,
): Promise<void> {
  const now = Date.now();
  const at = new Date(Math.min(now, occurredAt.getTime()));
  if (at.getTime() <= now - INACTIVITY_MS) return;
  await db.hostedMember.updateMany({
    where: { id: memberId, OR: [{ runtimeLastInteractionAt: null }, { runtimeLastInteractionAt: { lt: at } }] },
    data: { runtimeLastInteractionAt: at, ...(mailboxOwnerId === memberId ? { runtimeDormantAt: null } : {}) },
  });
}

/** Called after the exact physical target is released, under the member lock. */
export async function markDormantRuntimeAfterStop(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - INACTIVITY_MS);
  // Correlate every history probe to this member so a stop never scans the fleet.
  // Older installations have daily Linq counts without an exact last-inbound time.
  await tx.$executeRaw`
    UPDATE hosted_member AS m SET runtime_dormant_at = ${now}
    WHERE m.id = ${userId} AND m.runtime_dormant_at IS NULL
      AND GREATEST(m.created_at, m.runtime_last_interaction_at, m.companion_last_foreground_at) <= ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM hosted_thread_container WHERE member_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM hosted_group WHERE runtime_member_id = m.id)
      AND (m.runtime_last_interaction_at IS NOT NULL OR (
        NOT EXISTS (SELECT 1 FROM hosted_mailbox_item
          WHERE user_id = m.id AND kind = 'conversation.message' AND created_at > ${cutoff})
        AND NOT EXISTS (SELECT 1 FROM hosted_linq_daily_state
          WHERE member_id = m.id AND inbound_count > 0 AND last_seen_at > ${cutoff}
            AND day_utc >= date_trunc('day', ${cutoff}::timestamp))
        AND NOT EXISTS (SELECT 1 FROM hosted_auth_record
          WHERE model = 'session' AND member_id = m.id AND updated_at > ${cutoff})
      ))
  `;
}
