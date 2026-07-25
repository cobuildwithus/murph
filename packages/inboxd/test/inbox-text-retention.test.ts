import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import {
  appendJsonlRecord,
  initializeVault,
  readJsonlRecords,
  validateVault,
  walkVaultFiles,
  VAULT_LAYOUT,
} from "@murphai/core";
import {
  INBOX_TEXT_RETENTION_DAYS,
  openInboxRuntime,
  persistCanonicalInboxCapture,
  rebuildRuntimeFromVault,
  runInboxTextRetention,
} from "../src/index.ts";

const VAULT_CREATED_AT = "2026-06-01T00:00:00.000Z";
const OLD_AT = "2026-06-01T00:00:00.000Z";
// 30 days after the old capture, so the old one is well past the 14-day window
// and the recent one is comfortably inside it.
const NOW = "2026-07-01T00:00:00.000Z";
const RECENT_AT = "2026-06-28T00:00:00.000Z";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

async function persistTextCapture(input: {
  captureId: string;
  eventId: string;
  recordedAt: string;
  text: string;
  vaultRoot: string;
}): Promise<void> {
  await persistCanonicalInboxCapture({
    vaultRoot: input.vaultRoot,
    captureId: input.captureId,
    eventId: input.eventId,
    storedAt: input.recordedAt,
    input: {
      source: "telegram",
      externalId: `msg-${input.captureId}`,
      accountId: "self",
      thread: { id: "thread-1", isDirect: true },
      actor: { isSelf: false },
      occurredAt: input.recordedAt,
      receivedAt: input.recordedAt,
      text: input.text,
      attachments: [],
      raw: {
        schema: "murph.telegram-capture.v1",
        message_id: 41,
        // The one place a connector puts message content in `raw`.
        reply_context_preview: "quoted text from the replied-to message",
      },
    },
  });
}

async function readCaptureRecords(
  vaultRoot: string,
): Promise<Record<string, unknown>[]> {
  const shardPaths = await walkVaultFiles(
    vaultRoot,
    VAULT_LAYOUT.inboxCaptureLedgerDirectory,
    { extension: ".jsonl" },
  );
  const records: Record<string, unknown>[] = [];
  for (const relativePath of shardPaths) {
    records.push(
      ...(await readJsonlRecords({ vaultRoot, relativePath })) as Record<string, unknown>[],
    );
  }
  return records;
}

function findCapture(
  records: readonly Record<string, unknown>[],
  captureId: string,
): Record<string, unknown> {
  const record = records.find((entry) => entry.captureId === captureId);
  assert.ok(record, `expected capture ${captureId} to still be present`);
  return record;
}

test("runInboxTextRetention expires message content past the window and keeps recent messages", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-text-retention");
  await initializeVault({ vaultRoot, createdAt: VAULT_CREATED_AT });

  await persistTextCapture({
    captureId: "cap_text_old",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W1",
    recordedAt: OLD_AT,
    text: "an old message body",
    vaultRoot,
  });
  await persistTextCapture({
    captureId: "cap_text_recent",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W2",
    recordedAt: RECENT_AT,
    text: "a recent message body",
    vaultRoot,
  });

  const result = await runInboxTextRetention({ now: NOW, vaultRoot });
  assert.equal(result.expiredCaptures, 1);

  const records = await readCaptureRecords(vaultRoot);
  const expired = findCapture(records, "cap_text_old");
  const recent = findCapture(records, "cap_text_recent");

  // The expired capture keeps its structure but loses every carrier of content.
  assert.equal(expired.text, undefined);
  assert.equal(expired.textContent, undefined);
  assert.deepEqual(expired.raw, {});
  assert.equal(expired.textRetiredAt, NOW);
  assert.equal(expired.captureId, "cap_text_old");
  assert.ok(expired.thread, "thread metadata must survive so continuity holds");
  assert.equal(expired.occurredAt, OLD_AT);

  // No trace of the body, including the reply preview that rides in `raw`.
  const expiredJson = JSON.stringify(expired);
  assert.ok(!expiredJson.includes("an old message body"));
  assert.ok(!expiredJson.includes("quoted text from the replied-to message"));

  // The in-window message is untouched.
  assert.equal(recent.text, "a recent message body");
  assert.equal(recent.textRetiredAt, undefined);

  await validateVault({ vaultRoot });
});

test("runInboxTextRetention is idempotent and reports the next eligible wake", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-text-retention-repeat");
  await initializeVault({ vaultRoot, createdAt: VAULT_CREATED_AT });

  await persistTextCapture({
    captureId: "cap_text_old",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W1",
    recordedAt: OLD_AT,
    text: "an old message body",
    vaultRoot,
  });
  await persistTextCapture({
    captureId: "cap_text_recent",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W2",
    recordedAt: RECENT_AT,
    text: "a recent message body",
    vaultRoot,
  });

  const first = await runInboxTextRetention({ now: NOW, vaultRoot });
  assert.equal(first.expiredCaptures, 1);

  // A second pass must not reconsider the already-redacted record; without the
  // textRetiredAt marker an emptied capture would look expirable forever and
  // rewrite its shard on every idle checkpoint.
  const second = await runInboxTextRetention({ now: NOW, vaultRoot });
  assert.equal(second.expiredCaptures, 0);

  // The recent capture becomes eligible exactly one window after it was recorded.
  const expectedWake = new Date(
    Date.parse(RECENT_AT) + INBOX_TEXT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  assert.equal(second.nextEligibleAt, expectedWake);
});

test("runInboxTextRetention honors protected captures and the batch ceiling", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-text-retention-bounds");
  await initializeVault({ vaultRoot, createdAt: VAULT_CREATED_AT });

  await persistTextCapture({
    captureId: "cap_text_protected",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W1",
    recordedAt: OLD_AT,
    text: "a message still being worked on",
    vaultRoot,
  });
  await persistTextCapture({
    captureId: "cap_text_other",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W2",
    recordedAt: OLD_AT,
    text: "another old message",
    vaultRoot,
  });

  const protectedRun = await runInboxTextRetention({
    now: NOW,
    protectedCaptureIds: ["cap_text_protected"],
    vaultRoot,
  });
  assert.equal(protectedRun.expiredCaptures, 1);

  const records = await readCaptureRecords(vaultRoot);
  assert.equal(findCapture(records, "cap_text_protected").text, "a message still being worked on");
  assert.equal(findCapture(records, "cap_text_other").text, undefined);

  // With the protection lifted the remaining capture expires, and a ceiling of
  // zero is a no-op rather than an unbounded sweep.
  const noop = await runInboxTextRetention({ maxCaptures: 0, now: NOW, vaultRoot });
  assert.equal(noop.expiredCaptures, 0);

  const finalRun = await runInboxTextRetention({ now: NOW, vaultRoot });
  assert.equal(finalRun.expiredCaptures, 1);
});

test("runInboxTextRetention leaves legacy envelope captures alone and counts them", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-text-retention-legacy");
  await initializeVault({ vaultRoot, createdAt: VAULT_CREATED_AT });

  // A legacy capture keeps its body in a separate envelope file that this pass
  // must not delete, so it has to be reported rather than half-expired.
  const legacyCaptureId = "cap_01HQW7K0M9N8P7Q6R5S4T3VB99";
  const sourceDirectory = "raw/inbox/email/2026/06/cap_01HQW7K0M9N8P7Q6R5S4T3VB99";
  const envelopePath = `${sourceDirectory}/envelope.json`;
  await appendJsonlRecord({
    vaultRoot,
    relativePath: "ledger/inbox-captures/2026/2026-06.jsonl",
    record: {
      schemaVersion: "murph.inbox-capture.v1",
      captureId: legacyCaptureId,
      identityKey: "email:self",
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB98",
      source: "email",
      externalId: "msg-legacy",
      thread: { id: "thread-legacy", isDirect: true },
      actor: { isSelf: false },
      occurredAt: OLD_AT,
      recordedAt: OLD_AT,
      raw: { provider: "test" },
      sourceDirectory,
      rawRefs: [envelopePath],
      attachments: [],
      text: "a legacy message body",
      envelopePath,
    },
  });

  const result = await runInboxTextRetention({ now: NOW, vaultRoot });
  assert.equal(result.expiredCaptures, 0);
  assert.equal(result.legacyCapturesSkipped, 1);

  const records = await readCaptureRecords(vaultRoot);
  const legacy = findCapture(records, legacyCaptureId);
  assert.equal(legacy.text, "a legacy message body");
  assert.equal(legacy.envelopePath, envelopePath);
  assert.equal(legacy.textRetiredAt, undefined);
});

test("expired capture text stops being searchable without a projection rebuild", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-text-retention-search");
  await initializeVault({ vaultRoot, createdAt: VAULT_CREATED_AT });

  await persistTextCapture({
    captureId: "cap_text_old",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W1",
    recordedAt: OLD_AT,
    text: "kumquat marmalade experiment",
    vaultRoot,
  });

  // Prime the projection the way ordinary ingest does.
  const before = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime: before });
    assert.ok(
      before.searchCaptures({ text: "kumquat" }).length > 0,
      "the phrase must be searchable before retention runs",
    );
  } finally {
    before.close();
  }

  await runInboxTextRetention({ now: NOW, vaultRoot });

  // No rebuild here on purpose: production idle maintenance does not run one,
  // and hosted snapshots carry this database, so retention has to clear it.
  const after = await openInboxRuntime({ vaultRoot });
  try {
    assert.equal(after.searchCaptures({ text: "kumquat" }).length, 0);
    const capture = after.getCapture("cap_text_old");
    assert.ok(capture, "the capture row itself must survive");
    assert.equal(capture.text, null);
  } finally {
    after.close();
  }
});

test("expired capture text disappears from the rebuilt projection", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-text-retention-projection");
  await initializeVault({ vaultRoot, createdAt: VAULT_CREATED_AT });

  await persistTextCapture({
    captureId: "cap_text_old",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3V2W1",
    recordedAt: OLD_AT,
    text: "an old message body",
    vaultRoot,
  });

  await runInboxTextRetention({ now: NOW, vaultRoot });

  // The sqlite projection is rebuilt from the vault, so redacting the ledger has
  // to be enough to clear search and snippets — no separate purge step.
  const runtime = await openInboxRuntime({ vaultRoot });
  try {
    await rebuildRuntimeFromVault({ enqueueParserJobs: false, vaultRoot, runtime });
    const capture = runtime.getCapture("cap_text_old");
    assert.ok(capture, "the capture itself must survive so the thread stays intact");
    assert.equal(capture.text, null);
    assert.ok(!JSON.stringify(capture).includes("an old message body"));
  } finally {
    runtime.close();
  }

  await validateVault({ vaultRoot });
});
