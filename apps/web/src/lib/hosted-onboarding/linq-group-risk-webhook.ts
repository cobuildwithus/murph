import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { readHostedThreadRouteByThreadIdentity } from "../hosted-routing/thread-route-store";
import { readHostedLinqGroupLeave } from "../hosted-routing/linq-group-leave";
import { observeHostedLinqGroupRiskTx, type HostedLinqGroupRiskObservation } from "../hosted-routing/linq-group-risk-ledger";
import { createHostedPhoneLookupKey } from "./contact-privacy";
import type { HostedLinqChatRosterObservation, HostedLinqChatSummary } from "./linq-client";
import { createHostedLinqParticipantContact } from "./linq-participant-contact";
import { requireHostedLinqMessageReceivedEvent, requireHostedLinqParticipantChangedEvent, resolveHostedLinqParticipantContact,
  resolveHostedLinqRecipientPhoneNumber, type HostedLinqWebhookEvent } from "./linq-webhook";

function messageObservation(event: HostedLinqWebhookEvent) {
  const message = requireHostedLinqMessageReceivedEvent(event), data = message.data;
  const sender = data.is_from_me || data.sender_handle?.is_me ? null : resolveHostedLinqParticipantContact(message);
  return { chatId: data.chat_id, isGroup: data.chat?.is_group ?? null,
    line: resolveHostedLinqRecipientPhoneNumber(message), service: data.service,
    observedAt: new Date(data.received_at ?? data.sent_at ?? event.created_at),
    handles: sender ? [{ contact: sender, via: "sender" as const }] : [] };
}
function participantObservation(event: HostedLinqWebhookEvent) {
  const participantEvent = requireHostedLinqParticipantChangedEvent(event), data = participantEvent.data;
  if (!data.chat_id) return null;
  const changedAt = participantEvent.event_type === "participant.removed" ? participantEvent.data.removed_at : participantEvent.data.added_at;
  const observedAt = new Date(changedAt ?? event.created_at);
  const contact = data.participant.is_me ? null : createHostedLinqParticipantContact({
    kind: data.participant.handle.includes("@") ? "email" : "phone", value: data.participant.handle,
  });
  return { chatId: data.chat_id, isGroup: null, line: null, service: data.participant.service, observedAt,
    ...(event.event_type === "participant.removed" && data.participant.is_me ? { selfRemovedAt: observedAt } : {}),
    handles: contact && event.event_type === "participant.added" ? [{ contact, via: "participant_added" as const }] : [] };
}
function eventObservation(event: HostedLinqWebhookEvent) {
  if (event.event_type === "message.received") return messageObservation(event);
  if (event.event_type === "participant.added" || event.event_type === "participant.removed") return participantObservation(event);
  return null;
}

function rosterContacts(roster: HostedLinqChatRosterObservation) {
  return roster.handles.flatMap(handle => {
    if (handle.isMe || (handle.status !== null && handle.status.trim().toLowerCase() !== "active")) return [];
    const contact = createHostedLinqParticipantContact({ kind: handle.handle.includes("@") ? "email" : "phone", value: handle.handle });
    return contact ? [contact] : [];
  });
}

/**
 * Evidence never blocks message handling, so every writer here is fail-open:
 * a ledger fault logs a bounded code and the webhook continues. An aborted
 * request still rethrows. No writer here reads a provider roster; roster
 * evidence comes from the roster admission already fetched.
 */
async function writeEvidence(evidence: HostedLinqGroupRiskObservation, prisma: PrismaClient, signal?: AbortSignal) {
  try {
    await prisma.$transaction(tx => observeHostedLinqGroupRiskTx({ ...evidence, prisma: tx }));
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("Hosted Linq group risk observation failed.", { code: "observation_failed" });
  }
}

/** Runs before the group-left fence, so rejected rooms keep producing evidence. Database only. */
export async function observeHostedLinqGroupRiskWebhook(input: {
  event: HostedLinqWebhookEvent; prisma?: PrismaClient; signal?: AbortSignal;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  let evidence: HostedLinqGroupRiskObservation | null = null;
  try {
    const observation = eventObservation(input.event);
    if (!observation || observation.isGroup === false) return;
    const known = observation.isGroup === true
      || await readHostedLinqGroupLeave({ chatId: observation.chatId, prisma }) !== null
      || await readHostedThreadRouteByThreadIdentity({ channel: "linq", threadId: observation.chatId, prisma }) !== null;
    if (!known) return;
    evidence = { ...observation, lineLookupKey: createHostedPhoneLookupKey(observation.line) };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    console.warn("Hosted Linq group risk observation failed.", { code: "observation_failed" });
    return;
  }
  await writeEvidence(evidence, prisma, input.signal);
}

/** Records the complete roster admission fetched for an unbound group, after its plan commits. */
export async function recordHostedLinqGroupRosterEvidenceAfterCommit(input: {
  event: HostedLinqWebhookEvent; requestLocalRoster?: { observation: HostedLinqChatSummary };
  scheduleAfterResponse?: (task: () => Promise<void>) => void;
}): Promise<void> {
  const roster = input.requestLocalRoster?.observation;
  if (!roster || roster.isGroup === false || input.event.event_type !== "message.received") return;
  const observation = messageObservation(input.event);
  const run = () => writeEvidence({
    chatId: observation.chatId, observedAt: roster.observedAt, roster,
    lineLookupKey: createHostedPhoneLookupKey(observation.line),
    providerChatCreatedAt: roster.createdAt ?? null, service: roster.service ?? observation.service,
    handles: rosterContacts(roster).map(contact => ({ contact, via: "roster" as const })),
  }, getPrisma());
  if (input.scheduleAfterResponse) { input.scheduleAfterResponse(run); return; }
  await run();
}
