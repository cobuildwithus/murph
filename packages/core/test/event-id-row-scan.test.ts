import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { CONTRACT_SCHEMA_VERSION, type MealEventRecord } from "@murphai/contracts";
import { readEvent, readOwnedEvent } from "../src/event-read.ts";
import { readEventLedgerShardRecords } from "../src/event-ledger-storage.ts";
import { VaultError } from "../src/errors.ts";
import { deterministicContractId } from "../src/ids.ts";
import { compressShard } from "../src/shard-compression.ts";
import { initializeVault } from "../src/vault.ts";

type Encoding = "jsonl" | "gzip" | "brotli";

const ownerId = deterministicContractId("meal", "synthetic-scan-owner");
const otherOwnerId = deterministicContractId("meal", "synthetic-scan-other-owner");
const eventId = deterministicContractId("evt", "synthetic-scan-event");
const otherEventId = deterministicContractId("evt", "synthetic-scan-other-event");
const shard = (month: number) => `ledger/events/2026/2026-0${month}.jsonl`;

function meal(
  revision: number,
  overrides: Partial<MealEventRecord> = {},
): MealEventRecord {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION.event,
    id: eventId,
    kind: "meal",
    mealId: ownerId,
    occurredAt: "2026-01-10T12:00:00.000Z",
    recordedAt: `2026-04-0${revision}T00:00:00.000Z`,
    dayKey: "2026-01-10",
    timeZone: "UTC",
    source: "manual",
    title: `Revision ${revision}`,
    lifecycle: { revision },
    ...overrides,
  };
}

const otherMeal = meal(1, { id: otherEventId, mealId: otherOwnerId, title: "Other meal" });
// Names the target id outside `id`, so the scan parses it and the reader must still reject it.
const mention = meal(1, {
  id: deterministicContractId("evt", "synthetic-scan-mention"),
  mealId: deterministicContractId("meal", "synthetic-scan-mention-owner"),
  note: `See ${eventId} and ${ownerId}.`,
});

async function withVault(run: (vaultRoot: string) => Promise<void>) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-id-row-scan-"));
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-04-01T00:00:00.000Z", timezone: "UTC" });
    await run(vaultRoot);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

async function writeShardText(vaultRoot: string, month: number, text: string, encoding: Encoding) {
  const suffix = encoding === "jsonl" ? "" : encoding === "gzip" ? ".gz" : ".br";
  const destination = path.join(vaultRoot, `${shard(month)}${suffix}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, encoding === "jsonl" ? text : compressShard(text, encoding));
}

async function writeShard(vaultRoot: string, month: number, rows: unknown[], encoding: Encoding) {
  await writeShardText(vaultRoot, month, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, encoding);
}

test.each(["gzip", "brotli", "jsonl"] as const)(
  "an id lookup over %s shards returns what a full parse returns",
  async (encoding) => {
    await withVault(async (vaultRoot) => {
      await writeShard(vaultRoot, 1, [otherMeal, meal(1), mention], encoding);
      await writeShard(vaultRoot, 2, [mention, otherMeal, meal(3), meal(2)], encoding);
      await writeShard(vaultRoot, 3, [otherMeal], encoding);

      const expected = { eventId, ledgerFile: shard(2), event: meal(3) };
      assert.deepEqual(await readEvent({ vaultRoot, eventId }), expected);
      assert.deepEqual(await readOwnedEvent({ vaultRoot, kind: "meal", ownerId }), expected);

      const all = await readEventLedgerShardRecords({ vaultRoot, relativePath: shard(2) });
      assert.deepEqual(all, [mention, otherMeal, meal(3), meal(2)]);
      const scanned = await readEventLedgerShardRecords({
        vaultRoot,
        relativePath: shard(2),
        containing: [otherEventId, eventId],
      });
      // Every row of this shard holds one of the ids; file order is kept.
      assert.deepEqual(scanned, all);
      assert.deepEqual(
        await readEventLedgerShardRecords({ vaultRoot, relativePath: shard(2), containing: [otherEventId] }),
        encoding === "jsonl" ? all : [otherMeal],
      );
      assert.deepEqual(
        await readEventLedgerShardRecords({ vaultRoot, relativePath: shard(3), containing: [eventId] }),
        encoding === "jsonl" ? [otherMeal] : [],
      );
    });
  },
);

test("a later archived revision that drops the owner still decides the owner lookup", async () => {
  await withVault(async (vaultRoot) => {
    await writeShard(vaultRoot, 1, [meal(1)], "brotli");
    await writeShard(vaultRoot, 2, [otherMeal, meal(2, { mealId: otherOwnerId })], "brotli");
    await assert.rejects(readOwnedEvent({ vaultRoot, kind: "meal", ownerId }), { code: "EVENT_MISSING" });

    await writeShard(vaultRoot, 3, [meal(3, { lifecycle: { revision: 3, state: "deleted" } })], "gzip");
    await assert.rejects(readEvent({ vaultRoot, eventId }), { code: "EVENT_MISSING" });
  });
});

test("an escaped id in an archive is still found", async () => {
  await withVault(async (vaultRoot) => {
    const escaped = JSON.stringify(meal(2)).replace(`"${eventId}"`, `"\\u0065${eventId.slice(1)}"`);
    assert.equal(escaped.includes(eventId), false);
    assert.deepEqual(JSON.parse(escaped), meal(2));
    await writeShardText(vaultRoot, 1, `${JSON.stringify(otherMeal)}\n${escaped}\n`, "brotli");

    assert.deepEqual((await readEvent({ vaultRoot, eventId })).event, meal(2));
    assert.deepEqual((await readOwnedEvent({ vaultRoot, kind: "meal", ownerId })).event, meal(2));
  });
});

test("an id the byte search cannot match exactly falls back to a full parse", async () => {
  await withVault(async (vaultRoot) => {
    await writeShard(vaultRoot, 1, [otherMeal, meal(1)], "brotli");
    for (const containing of [["not plain"], [""], []]) {
      assert.deepEqual(
        await readEventLedgerShardRecords({ vaultRoot, relativePath: shard(1), containing }),
        [otherMeal, meal(1)],
      );
    }
  });
});

test("a malformed archived row that holds the id fails with its line number", async () => {
  await withVault(async (vaultRoot) => {
    const torn = JSON.stringify(meal(2)).slice(0, -1);
    await writeShardText(
      vaultRoot,
      1,
      `${JSON.stringify(otherMeal)}\n\n${JSON.stringify(meal(1))}\n${torn}`,
      "brotli",
    );
    const invalid = (error: unknown) =>
      error instanceof VaultError
      && error.code === "VAULT_INVALID_JSONL"
      && error.details.lineNumber === 4
      && error.details.relativePath === shard(1);
    await assert.rejects(readEvent({ vaultRoot, eventId }), invalid);
    await assert.rejects(readOwnedEvent({ vaultRoot, kind: "meal", ownerId }), invalid);
  });
});

test("only a plain shard is parsed past the rows that hold the id", async () => {
  await withVault(async (vaultRoot) => {
    await writeShardText(vaultRoot, 1, `{broken\n${JSON.stringify(meal(1))}\n`, "brotli");
    assert.deepEqual((await readEvent({ vaultRoot, eventId })).event, meal(1));
    assert.deepEqual((await readOwnedEvent({ vaultRoot, kind: "meal", ownerId })).event, meal(1));

    await writeShardText(vaultRoot, 2, `{broken\n${JSON.stringify(otherMeal)}\n`, "jsonl");
    await assert.rejects(readEvent({ vaultRoot, eventId }), { code: "VAULT_INVALID_JSONL" });
    await assert.rejects(
      readOwnedEvent({ vaultRoot, kind: "meal", ownerId }),
      { code: "VAULT_INVALID_JSONL" },
    );
  });
});
