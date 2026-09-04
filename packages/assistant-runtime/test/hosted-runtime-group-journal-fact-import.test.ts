import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ID_PREFIXES,
  deterministicContractId,
  findEventByExternalRef,
  initializeVault,
} from "@murphai/core";
import {
  buildHostedExecutionGroupJournalFactRecordedWake,
} from "@murphai/hosted-execution";

import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  importHostedGroupJournalFactMailboxItem,
} from "../src/hosted-runtime/group-journal-fact-import.ts";
import {
  enqueueHostedSystemMailboxItem,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";

const EVENT_ID = "group_journal_synthetic_001";
const MEMBER_ID = "member_synthetic_001";
const OCCURRED_AT = "2026-08-31T18:00:00.000Z";
const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((targetPath) =>
    rm(targetPath, { force: true, recursive: true })
  ));
});

describe("hosted group Journal fact import", () => {
  it("writes one private idempotent Journal factor with a Patterns key", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-group-journal-"));
    cleanupPaths.push(vaultRoot);
    await initializeVault({
      title: "Group Journal Test Vault",
      timezone: "Europe/Warsaw",
      vaultRoot,
    });
    const wake = buildHostedExecutionGroupJournalFactRecordedWake({
      eventId: EVENT_ID,
      journalFact: {
        date: "2026-08-31",
        factIndex: 1,
        note: "Worked in the yard for two hours.",
        noteType: "journal-factor",
        title: "Yard work",
      },
      memberId: MEMBER_ID,
      occurredAt: OCCURRED_AT,
    });
    const item = createMailboxItem();

    await expect(importHostedGroupJournalFactMailboxItem({ item, vaultRoot, wake }))
      .resolves.toEqual({
        reasonCode: "group_journal.imported",
        status: "imported",
      });
    await expect(importHostedGroupJournalFactMailboxItem({ item, vaultRoot, wake }))
      .resolves.toMatchObject({ status: "imported" });
    await expect(enqueueHostedSystemMailboxItem({ item, vaultRoot, wake }))
      .resolves.toEqual({
        reasonCode: "system_mailbox.queued",
        status: "imported",
      });
    await expect(readHostedSystemMailboxState(vaultRoot)).resolves.toMatchObject({
      pending: [{
        itemId: EVENT_ID,
        routeAction: "import-group-journal-fact",
        wake: { kind: "journal.group-fact.recorded" },
      }],
    });

    await expect(findEventByExternalRef({
      resourceId: EVENT_ID,
      resourceType: "group-journal-fact",
      system: "manual",
      vaultRoot,
    })).resolves.toMatchObject({
      dayKey: "2026-08-31",
      id: deterministicContractId(ID_PREFIXES.event, `group-journal-fact:${EVENT_ID}`),
      kind: "note",
      note: "Worked in the yard for two hours.",
      noteType: "journal-factor",
      source: "manual",
      tags: ["key-yard-work"],
      title: "Yard work",
    });
  });
});

function createMailboxItem(): HostedMailboxResolvedImportItem {
  return {
    item: {
      causalSeq: "1",
      createdAt: OCCURRED_AT,
      dedupeKey: EVENT_ID,
      expiresAt: null,
      id: EVENT_ID,
      kind: "journal.group-fact.recorded",
      lane: "system",
      laneSeq: "1",
      occurredAt: OCCURRED_AT,
      payloadBytes: 256,
      payloadInlineCiphertext: "ciphertext_synthetic_inline",
      payloadRef: null,
      payloadSchema: "murph.hosted-mailbox-item.v1",
      updatedAt: OCCURRED_AT,
      userId: MEMBER_ID,
    },
    payload: {
      payloadCiphertext: "ciphertext_synthetic_inline",
      payloadSchema: "murph.hosted-mailbox-item.v1",
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "import-group-journal-fact",
      advanceProgress: true,
      itemRef: {
        id: EVENT_ID,
        kind: "journal.group-fact.recorded",
        lane: "system",
        laneSeq: "1",
      },
      state: "route",
    },
  };
}
