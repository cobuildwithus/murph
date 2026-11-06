import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { test, vi } from "vitest";

import {
  MAX_EVENT_LEDGER_SHARD_BYTES,
  readEventLedgerShardRows,
  visitEventLedgerShardRecordsInterruptible,
} from "../src/event-ledger-storage.ts";
import { VaultError } from "../src/errors.ts";

const formats = [
  { name: "plain", suffix: "", encode: (bytes: Buffer) => bytes },
  { name: "gzip", suffix: ".gz", encode: gzipSync },
  { name: "brotli", suffix: ".br", encode: brotliCompressSync },
] as const;
const relativePath = "ledger/events/2026-01.jsonl";

async function withShard(
  bytes: Buffer,
  format: (typeof formats)[number],
  run: (vaultRoot: string) => Promise<void>,
): Promise<void> {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-event-visitor-"));
  try {
    const absolutePath = path.join(vaultRoot, `${relativePath}${format.suffix}`);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, format.encode(bytes));
    await run(vaultRoot);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

for (const format of formats) {
  for (const reader of ["visitor", "rows"] as const) {
    test(`${format.name} event ${reader} yields without a signal and preserves rows`, async () => {
      const expected = Array.from({ length: 1_024 }, (_, index) => ({
        lineNumber: index * 2 + 1,
        value: { index, text: "café 🌱" },
      }));
      const bytes = Buffer.from(expected.map(({ value }) => JSON.stringify(value)).join("\n\n") + "\n");
      await withShard(bytes, format, async (vaultRoot) => {
        let parsed = 0;
        let observedAt = 0;
        let observer: ReturnType<typeof setImmediate> | undefined;
        const parse = JSON.parse;
        const spy = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
          const value = parse(text, reviver);
          if (text.startsWith('{"index":')) {
            parsed += 1;
            if (parsed === 1) observer = setImmediate(() => { observedAt = parsed; });
          }
          return value;
        });
        try {
          const rows: Array<{ lineNumber: number; value: unknown }> = [];
          if (reader === "rows") {
            assert.deepEqual(await readEventLedgerShardRows({ vaultRoot, relativePath }), expected);
          } else {
            const result = await visitEventLedgerShardRecordsInterruptible({
              vaultRoot, relativePath,
              visit(value, lineNumber) { rows.push({ lineNumber, value }); },
            });
            assert.deepEqual(result, { interrupted: false, visitedCount: expected.length });
            assert.deepEqual(rows, expected);
          }
          assert.ok(observedAt > 0 && observedAt <= 256, `observer ran after ${observedAt} parsed rows`);
        } finally {
          spy.mockRestore();
          if (observer) clearImmediate(observer);
        }
      });
    });
  }

  test(`${format.name} event visitor preserves physical lines and UTF-8 decoding`, async () => {
    const bytes = Buffer.concat([
      Buffer.from('{"value":"café 🌱"}\r\n\n{"value":"'),
      Buffer.from([0xe2, 0x82]),
      Buffer.from('"}\n{"value":"last"}\n'),
    ]);
    await withShard(bytes, format, async (vaultRoot) => {
      const visited: Array<{ lineNumber: number; value: unknown }> = [];
      let checks = 0;
      const result = await visitEventLedgerShardRecordsInterruptible({
        vaultRoot,
        relativePath,
        shouldContinue: () => { checks += 1; return true; },
        visit: async (value, lineNumber) => {
          await Promise.resolve();
          visited.push({ lineNumber, value });
        },
      });
      assert.deepEqual(result, { interrupted: false, visitedCount: 3 });
      assert.deepEqual(visited, [
        { lineNumber: 1, value: { value: "café 🌱" } },
        { lineNumber: 3, value: { value: "�" } },
        { lineNumber: 4, value: { value: "last" } },
      ]);
      assert.equal(checks, 6);
      assert.deepEqual(await readEventLedgerShardRows({ vaultRoot, relativePath }), visited);
    });
  });

  for (const tail of ["", "invalid later JSON\n"]) {
    test(`${format.name} event visitor can stop before ${tail ? "invalid" : "trailing empty"} line`, async () => {
      await withShard(Buffer.from(`{"value":"first"}\n${tail}`), format, async (vaultRoot) => {
        let checks = 0;
        const visited: unknown[] = [];
        const result = await visitEventLedgerShardRecordsInterruptible({
          vaultRoot,
          relativePath,
          shouldContinue: () => { checks += 1; return checks <= 2; },
          visit: (value) => { visited.push(value); },
        });
        assert.deepEqual(result, { interrupted: true, visitedCount: 1 });
        assert.deepEqual(visited, [{ value: "first" }]);
        assert.equal(checks, 3);
      });
    });
  }

  test(`${format.name} event visitor reports the original invalid physical line`, async () => {
    await withShard(Buffer.from('{}\n\n{}\r\ninvalid JSON\n'), format, async (vaultRoot) => {
      let visitedCount = 0;
      await assert.rejects(
        visitEventLedgerShardRecordsInterruptible({
          vaultRoot,
          relativePath,
          visit: () => { visitedCount += 1; },
        }),
        (error: unknown) => error instanceof VaultError
          && error.code === "VAULT_INVALID_JSONL"
          && error.details.lineNumber === 4,
      );
      assert.equal(visitedCount, 2);
      await assert.rejects(
        readEventLedgerShardRows({ vaultRoot, relativePath }),
        (error: unknown) => error instanceof VaultError
          && error.code === "VAULT_INVALID_JSONL"
          && error.details.lineNumber === 4,
      );
    });
  });
}

for (const format of formats.filter((format) => format.suffix)) {
  test(`${format.name} event visitor verifies the entire archive before callbacks`, async () => {
    await withShard(Buffer.from('{"value":"first"}\n{"value":"last"}\n'), format, async (vaultRoot) => {
      const absolutePath = path.join(vaultRoot, `${relativePath}${format.suffix}`);
      const bytes = await fs.readFile(absolutePath);
      await fs.writeFile(absolutePath, bytes.subarray(0, bytes.length - 2));
      let visits = 0;
      await assert.rejects(
        visitEventLedgerShardRecordsInterruptible({
          vaultRoot,
          relativePath,
          shouldContinue: () => visits === 0,
          visit: () => { visits += 1; },
        }),
        (error: unknown) => error instanceof VaultError
          && error.code === "EVENT_LEDGER_ARCHIVE_INVALID",
      );
      assert.equal(visits, 0);
    });
  });
}

test("event visitor rejects an oversized plain shard before callbacks", async () => {
  await withShard(Buffer.from('{}\n'), formats[0], async (vaultRoot) => {
    await fs.truncate(path.join(vaultRoot, relativePath), MAX_EVENT_LEDGER_SHARD_BYTES + 1);
    let visits = 0;
    await assert.rejects(
      visitEventLedgerShardRecordsInterruptible({
        vaultRoot,
        relativePath,
        visit: () => { visits += 1; },
      }),
      (error: unknown) => error instanceof VaultError
        && error.code === "EVENT_LEDGER_SHARD_TOO_LARGE",
    );
    assert.equal(visits, 0);
  });
});

test("event visitor preserves an abort reason before reading or visiting", async () => {
  await withShard(Buffer.from('{}\n'), formats[0], async (vaultRoot) => {
    const controller = new AbortController();
    const reason = new Error("synthetic cancellation");
    controller.abort(reason);
    let visits = 0;
    await assert.rejects(
      visitEventLedgerShardRecordsInterruptible({
        vaultRoot,
        relativePath,
        signal: controller.signal,
        visit: () => { visits += 1; },
      }),
      (error: unknown) => error === reason,
    );
    assert.equal(visits, 0);
  });
});

for (const format of formats) {
  for (const mode of ["signal", "continuation"] as const) {
    test(`${format.name} event visitor services a foreground ${mode} timer during scanning`, async () => {
      const recordCount = 20_000;
      await withShard(Buffer.from('{"value":"synthetic"}\n'.repeat(recordCount)), format, async (vaultRoot) => {
        const controller = new AbortController();
        const reason = new Error("synthetic foreground wake");
        let stopped = false;
        let visits = 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          const pending = visitEventLedgerShardRecordsInterruptible({
            vaultRoot,
            relativePath,
            signal: mode === "signal" ? controller.signal : undefined,
            shouldContinue: mode === "continuation" ? () => !stopped : undefined,
            visit: () => {
              visits += 1;
              if (visits === 1) {
                timer = setTimeout(() => {
                  stopped = true;
                  controller.abort(reason);
                }, 0);
              }
            },
          });
          if (mode === "signal") {
            await assert.rejects(pending, (error: unknown) => error === reason);
          } else {
            const result = await pending;
            assert.deepEqual(result, { interrupted: true, visitedCount: visits });
          }
          assert.ok(stopped);
          assert.ok(visits > 0 && visits < recordCount);
        } finally {
          if (timer) clearTimeout(timer);
        }
      });
    });
  }
}

for (const format of formats) {
  for (const corrupted of format.suffix ? [false, true] : [false]) {
    test(`${format.name} event visitor preserves ${corrupted ? "archive validation" : "abort reason"} after an arriving read-boundary abort`, async () => {
      await withShard(Buffer.from('{}\n'), format, async (vaultRoot) => {
        if (corrupted) {
          const absolutePath = path.join(vaultRoot, `${relativePath}${format.suffix}`);
          const bytes = await fs.readFile(absolutePath);
          await fs.writeFile(absolutePath, bytes.subarray(0, bytes.length - 2));
        }
        const controller = new AbortController();
        const reason = new Error("synthetic read-boundary wake");
        const readFile = fs.readFile.bind(fs);
        const read = vi.spyOn(fs, "readFile").mockImplementationOnce(async (file, options) => {
          const bytes = await readFile(file, options);
          controller.abort(reason);
          return bytes;
        });
        let visits = 0;
        try {
          await assert.rejects(
            visitEventLedgerShardRecordsInterruptible({
              vaultRoot,
              relativePath,
              signal: controller.signal,
              visit: () => { visits += 1; },
            }),
            (error: unknown) => corrupted
              ? error instanceof VaultError && error.code === "EVENT_LEDGER_ARCHIVE_INVALID"
              : error === reason,
          );
          assert.ok(controller.signal.aborted);
          assert.equal(visits, 0);
        } finally {
          read.mockRestore();
        }
      });
    });
  }
}
