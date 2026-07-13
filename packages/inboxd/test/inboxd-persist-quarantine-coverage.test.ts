import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "vitest";

import { initializeVault } from "@murphai/core";

import type { InboundCapture } from "../src/contracts/capture.ts";
import { findStoredCaptureSnapshot } from "../src/indexing/persist.ts";
import { createDeterministicInboxCaptureId } from "../src/shared.ts";
import {
  persistCanonicalInboxCapture,
} from "../src/index.ts";

function createCapture(overrides: Partial<InboundCapture> = {}): InboundCapture {
  return {
    source: "email",
    externalId: "msg-persist-quarantine",
    accountId: "acct",
    thread: {
      id: "thread-1",
    },
    actor: {
      isSelf: false,
    },
    occurredAt: "2026-03-13T12:30:00.000Z",
    receivedAt: "2026-03-13T12:30:05.000Z",
    text: "Persist edge coverage",
    attachments: [],
    raw: {},
    ...overrides,
  };
}

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("findStoredCaptureSnapshot returns null when no canonical inbox-capture record exists", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-missing-canonical-record");
  const input = createCapture({
    source: "telegram",
    accountId: "telegram-bot",
  });
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const snapshot = await findStoredCaptureSnapshot({
    vaultRoot,
    inbound: input,
  });

  assert.equal(snapshot, null);
});

test("persistCanonicalInboxCapture keeps unresolved attachments unstored instead of failing the capture", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-unstored-attachments");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const inbound = createCapture({
    externalId: "msg-unstored-attachments",
    attachments: [
      {
        externalId: "att-empty",
        kind: "document",
        mime: "text/plain",
      },
      {
        externalId: "att-missing-path",
        kind: "document",
        mime: "text/plain",
        originalPath: path.join(vaultRoot, "missing.txt"),
        fileName: "missing.txt",
      },
    ],
  });
  const stored = (
    await persistCanonicalInboxCapture({
      vaultRoot,
      captureId: createDeterministicInboxCaptureId(inbound),
      eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB01",
      input: inbound,
      storedAt: "2026-03-13T12:45:00.000Z",
    })
  ).stored;

  assert.equal(stored.attachments.length, 2);
  for (const attachment of stored.attachments) {
    assert.equal(attachment.storedPath, null);
    assert.equal(attachment.sha256, null);
    assert.equal(attachment.originalPath, null);
  }
});

test("findStoredCaptureSnapshot scans other canonical ledgers when the expected month has no record", async () => {
  const vaultRoot = await makeTempDirectory("murph-inbox-canonical-ledger-scan");
  await initializeVault({ vaultRoot, createdAt: "2026-03-12T12:00:00.000Z" });

  const archivedCapture = createCapture({
    externalId: "msg-canonical-ledger-scan",
    occurredAt: "2026-02-13T12:30:00.000Z",
  });
  const requestedCapture = createCapture({
    externalId: "msg-canonical-ledger-scan",
    occurredAt: "2026-03-13T12:30:00.000Z",
  });
  const requestedCaptureId = createDeterministicInboxCaptureId(requestedCapture);

  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_canonical_late",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB02",
    input: archivedCapture,
    storedAt: "2026-02-13T12:32:00.000Z",
  });
  await persistCanonicalInboxCapture({
    vaultRoot,
    captureId: "cap_canonical_early",
    eventId: "evt_01HQW7K0M9N8P7Q6R5S4T3VB03",
    input: archivedCapture,
    storedAt: "2026-02-13T12:31:00.000Z",
  });

  const snapshot = await findStoredCaptureSnapshot({
    vaultRoot,
    inbound: requestedCapture,
    captureId: requestedCaptureId,
  });

  assert.ok(snapshot);
  assert.equal(snapshot.captureId, "cap_canonical_early");
  assert.equal(snapshot.eventId, "evt_01HQW7K0M9N8P7Q6R5S4T3VB03");
});
