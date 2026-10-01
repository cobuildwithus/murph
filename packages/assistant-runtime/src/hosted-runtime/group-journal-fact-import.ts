import { resolveLocalDateAtNoon } from "@murphai/contracts";
import {
  ID_PREFIXES,
  deterministicContractId,
  findEventByExternalRef,
  loadVault,
  upsertEvent,
} from "@murphai/core";
import type {
  HostedExecutionGroupJournalFactRecordedWake,
} from "@murphai/hosted-execution/contracts";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";

const GROUP_JOURNAL_EXTERNAL_SYSTEM = "manual";
const GROUP_JOURNAL_EXTERNAL_RESOURCE_TYPE = "group-journal-fact";
const GROUP_JOURNAL_EXTERNAL_VERSION = "v1";

export async function importHostedGroupJournalFactMailboxItem(input: {
  item: HostedMailboxResolvedImportItem;
  vaultRoot: string;
  wake: HostedExecutionGroupJournalFactRecordedWake;
}): Promise<HostedMailboxItemImportOutcome> {
  if (
    input.item.route.action !== "import-group-journal-fact"
    || input.item.item.kind !== "journal.group-fact.recorded"
  ) {
    return blocked("group_journal.route_mismatch", false);
  }
  if (
    input.wake.userId !== input.item.item.userId
    || input.wake.eventId !== input.item.item.dedupeKey
    || input.wake.occurredAt !== input.item.item.occurredAt
  ) {
    return blocked("group_journal.decode_mismatch", false);
  }
  const causalSeq = readPositiveCausalSeq(input.item.item.causalSeq);
  if (!causalSeq) {
    return blocked("group_journal.causal_seq_invalid", false);
  }

  const eventId = deterministicContractId(
    ID_PREFIXES.event,
    `group-journal-fact:${input.wake.eventId}`,
  );
  const externalRef = {
    resourceId: input.wake.eventId,
    resourceType: GROUP_JOURNAL_EXTERNAL_RESOURCE_TYPE,
    system: GROUP_JOURNAL_EXTERNAL_SYSTEM,
    version: GROUP_JOURNAL_EXTERNAL_VERSION,
  };
  let existing: Awaited<ReturnType<typeof findEventByExternalRef>>;
  try {
    existing = await findEventByExternalRef({
      resourceId: externalRef.resourceId,
      resourceType: externalRef.resourceType,
      system: externalRef.system,
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return blocked("group_journal.idempotency_read_failed", true);
  }

  if (existing) {
    return groupJournalFactMatches({ eventId, existing, wake: input.wake })
      ? imported()
      : blocked("group_journal.conflict", false);
  }

  let timeZone: string;
  let occurredAt: string;
  try {
    const vault = await loadVault({ vaultRoot: input.vaultRoot });
    timeZone = vault.metadata.timezone;
    occurredAt = resolveLocalDateAtNoon(input.wake.journalFact.date, timeZone);
  } catch {
    return blocked("group_journal.vault_read_failed", true);
  }

  try {
    await upsertEvent({
      payload: {
        dayKey: input.wake.journalFact.date,
        externalRef,
        id: eventId,
        kind: "note",
        note: input.wake.journalFact.note,
        noteType: input.wake.journalFact.noteType,
        occurredAt,
        recordedAt: input.wake.occurredAt,
        source: "manual",
        tags: journalTags(input.wake),
        timeZone,
        title: input.wake.journalFact.title,
      },
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return blocked("group_journal.canonical_import_failed", true);
  }
  return imported();
}

function groupJournalFactMatches(input: {
  eventId: string;
  existing: NonNullable<Awaited<ReturnType<typeof findEventByExternalRef>>>;
  wake: HostedExecutionGroupJournalFactRecordedWake;
}): boolean {
  if (!input.existing.timeZone) return false;
  let occurredAt: string;
  try {
    occurredAt = resolveLocalDateAtNoon(
      input.wake.journalFact.date,
      input.existing.timeZone,
    );
  } catch {
    return false;
  }
  return input.existing.id === input.eventId
    && input.existing.kind === "note"
    && input.existing.source === "manual"
    && input.existing.dayKey === input.wake.journalFact.date
    && input.existing.occurredAt === occurredAt
    && input.existing.recordedAt === input.wake.occurredAt
    && input.existing.note === input.wake.journalFact.note
    && input.existing.noteType === input.wake.journalFact.noteType
    && input.existing.title === input.wake.journalFact.title
    && sameStrings(input.existing.tags ?? [], journalTags(input.wake))
    && input.existing.externalRef?.version === GROUP_JOURNAL_EXTERNAL_VERSION;
}

function journalTags(
  wake: HostedExecutionGroupJournalFactRecordedWake,
): string[] {
  if (wake.journalFact.noteType === "journal-plan") return ["planned"];
  if (
    wake.journalFact.noteType !== "journal-factor"
    && wake.journalFact.noteType !== "journal-context"
  ) return [];
  const key = wake.journalFact.title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  return key ? [`key-${key}`] : [];
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readPositiveCausalSeq(value: string | null | undefined): string | null {
  if (!value || !/^[1-9][0-9]{0,18}$/u.test(value)) return null;
  return BigInt(value) <= 9_223_372_036_854_775_807n ? value : null;
}

function imported(): HostedMailboxItemImportOutcome {
  return { reasonCode: "group_journal.imported", status: "imported" };
}

function blocked(
  reasonCode: string,
  retryable: boolean,
): HostedMailboxItemImportOutcome {
  return { reasonCode, retryable, status: "blocked" };
}
