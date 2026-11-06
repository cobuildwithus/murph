import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { test, vi } from "vitest";
import * as contracts from "@murphai/contracts";
import { initializeVault, upsertEvent, VaultError } from "@murphai/core";
import {
  publishHostedWorkspaceMediaReferencesForSnapshot,
  readHostedMediaReferenceCatalogue,
} from "../src/hosted-runtime/media-references.ts";
import { createMealMediaStore } from "./hosted-meal-media.harness.ts";

async function withVault(run: (vaultRoot: string) => Promise<void>) {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "murph-media-scan-"));
  try {
    await initializeVault({ vaultRoot, createdAt: "2026-01-01T00:00:00.000Z" });
    await run(vaultRoot);
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

for (const format of [
  { name: "plain", suffix: "", encode: (bytes: Buffer) => bytes },
  { name: "gzip", suffix: ".gz", encode: gzipSync },
  { name: "brotli", suffix: ".br", encode: brotliCompressSync },
]) {
  test(`${format.name} media inventory yields without a signal and preserves references`, async () => {
    await withVault(async (vaultRoot) => {
      const rawRef = "raw/captures/synthetic/image.png";
      await fs.mkdir(path.dirname(path.join(vaultRoot, rawRef)), { recursive: true });
      await fs.writeFile(path.join(vaultRoot, rawRef), "synthetic image bytes");
      const seed = await upsertEvent({ vaultRoot, payload: {
        kind: "note", title: "Synthetic media", note: "Synthetic media reference.",
        occurredAt: "2026-01-01T00:00:00.000Z", rawRefs: [rawRef],
      } });
      const { mediaStore } = createMealMediaStore();
      await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
      const expected = await readHostedMediaReferenceCatalogue({ vaultRoot });
      assert.equal(expected.entries.length, 1);
      const shardPath = path.join(vaultRoot, seed.ledgerFile);
      const row = await fs.readFile(shardPath, "utf8");
      // Schema-invalid objects are ignored; valid repeated revisions retain the same winner.
      const bytes = Buffer.from((row + '{"invalidEvent":true}\n').repeat(512));
      await fs.writeFile(shardPath + format.suffix, format.encode(bytes));
      if (format.suffix) await fs.unlink(shardPath);
      const parse = contracts.safeParseContract;
      let parsed = 0;
      let observedAt = 0;
      let observer: ReturnType<typeof setImmediate> | undefined;
      const spy = vi.spyOn(contracts, "safeParseContract").mockImplementation((schema, value) => {
        if (schema === contracts.eventRecordSchema) {
          parsed += 1;
          if (parsed === 1) observer = setImmediate(() => { observedAt = parsed; });
        }
        return parse(schema, value);
      });
      try {
        const result = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore });
        assert.ok(observedAt > 0 && observedAt <= 256, `observer ran after ${observedAt} validated rows`);
        assert.equal(parsed, 1_024);
        assert.equal(result.uploadedMediaCount, 0);
        assert.deepEqual(await readHostedMediaReferenceCatalogue({ vaultRoot }), expected);
      } finally {
        spy.mockRestore();
        if (observer) clearImmediate(observer);
      }
    });
  });
}

test("media inventory validates all JSON before inspecting malformed event values", async () => {
  await withVault(async (vaultRoot) => {
    const relativePath = "ledger/events/2026-01.jsonl";
    await fs.mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, relativePath), '{}\n'.repeat(256) + 'null\n\ninvalid JSON\n');
    const { mediaStore, calls } = createMealMediaStore();
    await assert.rejects(
      publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore }),
      (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_JSONL"
        && error.details.lineNumber === 259 && error.details.relativePath === relativePath,
    );
    assert.deepEqual(calls, []);
    await fs.writeFile(path.join(vaultRoot, relativePath), "null\n");
    await assert.rejects(publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore }), TypeError);
  });
});

test("media inventory preserves non-Error abort normalization", async () => {
  await withVault(async (vaultRoot) => {
    const relativePath = "ledger/events/2026-01.jsonl";
    await fs.mkdir(path.dirname(path.join(vaultRoot, relativePath)), { recursive: true });
    await fs.writeFile(path.join(vaultRoot, relativePath), "{}\n");
    const controller = new AbortController();
    controller.abort("synthetic cancellation");
    const { mediaStore, calls } = createMealMediaStore();
    await assert.rejects(
      publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore, signal: controller.signal }),
      { message: "Hosted media reference publication was interrupted." },
    );
    assert.deepEqual(calls, []);
  });
});
