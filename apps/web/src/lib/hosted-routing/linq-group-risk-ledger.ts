import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHostedLinqChatLookupKey } from "../hosted-onboarding/contact-privacy";
import type { HostedLinqChatRosterObservation } from "../hosted-onboarding/linq-client";
import type { HostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { acquireHostedLinqChatOwnershipLockTx } from "./linq-chat-ownership-lock";
import { readHostedLinqGroupLeave } from "./linq-group-leave";

export type HostedLinqGroupRiskObservation = {
  chatId: string;
  observedAt: Date;
  lineLookupKey?: string | null;
  providerChatCreatedAt?: Date | null;
  service?: string | null;
  roster?: HostedLinqChatRosterObservation;
  handles: Array<{ contact: HostedLinqParticipantContact; via: "roster" | "participant_added" | "sender"; observedAt?: Date }>;
  selfRemovedAt?: Date;
};

/** One narrow database-only transaction; duplicate and delayed events commute. */
export async function observeHostedLinqGroupRiskTx(input: HostedLinqGroupRiskObservation & { prisma: Prisma.TransactionClient }): Promise<void> {
  const { prisma, chatId, observedAt, handles } = input;
  const chatKey = createHostedLinqChatLookupKey(chatId)!;
  await acquireHostedLinqChatOwnershipLockTx({ chatId, tx: prisma });
  const marker = await readHostedLinqGroupLeave({ chatId, prisma });
  if (marker && input.selfRemovedAt) {
    await prisma.$executeRaw`UPDATE hosted_linq_group_leave SET provider_removed_at = LEAST(provider_removed_at, ${input.selfRemovedAt})
      WHERE thread_identity_lookup_key = ${marker.threadIdentityLookupKey}`;
  }
  await writeSightingTx(input, chatKey, marker?.threadIdentityLookupKey ?? null);
  await writeHandlesTx(mergeHandleObservations(handles, observedAt), chatKey, prisma);
}

async function writeSightingTx(input: HostedLinqGroupRiskObservation & { prisma: Prisma.TransactionClient }, chatKey: string, markerKey: string | null) {
  const { prisma, observedAt, roster } = input;
  const service = ["iMessage", "SMS", "RCS"].find(value => value.toLowerCase() === input.service?.trim().toLowerCase()) ?? null;
  const firstObservedAt = new Date(Math.min(observedAt.getTime(), roster?.observedAt.getTime() ?? Infinity));
  const lastObservedAt = new Date(Math.max(observedAt.getTime(), roster?.observedAt.getTime() ?? -Infinity));
  await prisma.$executeRaw`
    INSERT INTO hosted_linq_group_sighting (chat_lookup_key, line_lookup_key, first_observed_at, last_observed_at,
      provider_chat_created_at, service, roster_handle_count, roster_complete, roster_observed_at, leave_marker_key)
    VALUES (${chatKey}, ${input.lineLookupKey ?? null}, ${firstObservedAt}, ${lastObservedAt}, ${input.providerChatCreatedAt ?? null},
      ${service}, ${roster?.handleCount ?? null}, ${roster?.handlesComplete ?? false}, ${roster?.observedAt ?? null}, ${markerKey})
    ON CONFLICT (chat_lookup_key) DO UPDATE SET
      first_observed_at = LEAST(hosted_linq_group_sighting.first_observed_at, EXCLUDED.first_observed_at),
      last_observed_at = GREATEST(hosted_linq_group_sighting.last_observed_at, EXCLUDED.last_observed_at),
      line_lookup_key = COALESCE(hosted_linq_group_sighting.line_lookup_key, EXCLUDED.line_lookup_key),
      provider_chat_created_at = LEAST(hosted_linq_group_sighting.provider_chat_created_at, EXCLUDED.provider_chat_created_at),
      service = COALESCE(hosted_linq_group_sighting.service, EXCLUDED.service),
      -- Roster metadata orders by its own observation time, never by sender events.
      roster_handle_count = CASE WHEN EXCLUDED.roster_observed_at IS NOT NULL AND (hosted_linq_group_sighting.roster_observed_at IS NULL
        OR EXCLUDED.roster_observed_at >= hosted_linq_group_sighting.roster_observed_at)
        THEN EXCLUDED.roster_handle_count ELSE hosted_linq_group_sighting.roster_handle_count END,
      roster_complete = CASE WHEN EXCLUDED.roster_observed_at IS NOT NULL AND (hosted_linq_group_sighting.roster_observed_at IS NULL
        OR EXCLUDED.roster_observed_at >= hosted_linq_group_sighting.roster_observed_at)
        THEN EXCLUDED.roster_complete ELSE hosted_linq_group_sighting.roster_complete END,
      roster_observed_at = GREATEST(hosted_linq_group_sighting.roster_observed_at, EXCLUDED.roster_observed_at),
      leave_marker_key = COALESCE(EXCLUDED.leave_marker_key, hosted_linq_group_sighting.leave_marker_key)
  `;
}

function mergeHandleObservations(handles: HostedLinqGroupRiskObservation["handles"], observedAt: Date) {
  const unique = new Map<string, { key: string; first: Date; last: Date; via: string; sent: Date | null }>();
  for (const handle of handles) {
    const at = handle.observedAt ?? observedAt, key = handle.contact.lookupKey;
    const row = unique.get(key);
    if (!row) { unique.set(key, { key, first: at, last: at, via: handle.via, sent: handle.via === "sender" ? at : null }); continue; }
    if (at < row.first || (at.getTime() === row.first.getTime() && handle.via < row.via)) { row.first = at; row.via = handle.via; }
    if (at > row.last) row.last = at;
    if (handle.via === "sender" && (!row.sent || at < row.sent)) row.sent = at;
  }
  return [...unique.values()];
}

async function writeHandlesTx(rows: ReturnType<typeof mergeHandleObservations>, chatKey: string, prisma: Prisma.TransactionClient) {
  // Chunk SQL parameters, not roster meaning. Completeness remains the provider contract.
  for (let offset = 0; offset < rows.length; offset += 500) {
    const values = rows.slice(offset, offset + 500).map(({ key, first, last, via, sent }) => Prisma.sql`(
      ${chatKey}, ${key}, ${first}::timestamp, ${last}::timestamp, ${via}, ${sent}::timestamp)`);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO hosted_linq_group_handle (chat_lookup_key, handle_lookup_key, first_seen_at, last_seen_at, first_seen_via, first_sent_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (chat_lookup_key, handle_lookup_key) DO UPDATE SET
        first_seen_via = CASE WHEN EXCLUDED.first_seen_at < hosted_linq_group_handle.first_seen_at
          OR (EXCLUDED.first_seen_at = hosted_linq_group_handle.first_seen_at AND EXCLUDED.first_seen_via < hosted_linq_group_handle.first_seen_via)
          THEN EXCLUDED.first_seen_via ELSE hosted_linq_group_handle.first_seen_via END,
        first_seen_at = LEAST(hosted_linq_group_handle.first_seen_at, EXCLUDED.first_seen_at),
        last_seen_at = GREATEST(hosted_linq_group_handle.last_seen_at, EXCLUDED.last_seen_at),
        first_sent_at = LEAST(hosted_linq_group_handle.first_sent_at, EXCLUDED.first_sent_at)
    `);
  }
}

/** Independent per-handle clocks; expiration never deletes departure authority. */
export async function expireHostedLinqGroupRiskBatch(input: { prisma: PrismaClient; now: Date }) {
  const cutoff = new Date(input.now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const handles = await input.prisma.$executeRaw`
    WITH doomed AS (SELECT chat_lookup_key, handle_lookup_key FROM hosted_linq_group_handle
      WHERE last_seen_at < ${cutoff} ORDER BY last_seen_at, chat_lookup_key, handle_lookup_key LIMIT 1000 FOR UPDATE SKIP LOCKED)
    DELETE FROM hosted_linq_group_handle h USING doomed d WHERE h.chat_lookup_key = d.chat_lookup_key AND h.handle_lookup_key = d.handle_lookup_key`;
  const sightings = await input.prisma.$executeRaw`
    WITH doomed AS (SELECT chat_lookup_key FROM hosted_linq_group_sighting s
      WHERE last_observed_at < ${cutoff} AND NOT EXISTS (SELECT 1 FROM hosted_linq_group_handle h WHERE h.chat_lookup_key = s.chat_lookup_key)
      ORDER BY last_observed_at, chat_lookup_key LIMIT 1000 FOR UPDATE SKIP LOCKED)
    DELETE FROM hosted_linq_group_sighting s USING doomed d WHERE s.chat_lookup_key = d.chat_lookup_key`;
  return { handles, sightings };
}
