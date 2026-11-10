import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { initializeVault, readStoredWriteOperation } from "../src/index.ts";
import { describe, expect, it } from "vitest";
import {
  HostedCanonicalWriteOutcomeUnknownError,
  WriteBatch,
  persistHostedRuntimeStateAtCanonicalBoundary,
  runCanonicalWrite,
  withHostedCanonicalWritePort,
} from "../src/operations/write-batch.ts";

describe("hosted runtime-state canonical persistence", () => {
  it("uses exactly one ambient checkpoint owner", async () => {
    let calls = 0;
    await withHostedCanonicalWritePort(
      {
        persistCanonicalWrite: async () => undefined,
        persistRuntimeState: async () => { calls += 1; },
      },
      async () => persistHostedRuntimeStateAtCanonicalBoundary(),
    );
    expect(calls).toBe(1);
  });

  it("fails closed outside the canonical workspace boundary", async () => {
    await expect(persistHostedRuntimeStateAtCanonicalBoundary()).rejects.toThrow(/canonical write boundary/);
  });
});

describe("hosted canonical publication evidence", () => {
  it("reports local write stages without changing the persisted result", async () => {
    const vaultRoot = await fs.mkdtemp(path.join(tmpdir(), "canonical-timing-"));
    const stages: string[] = [];
    try {
      await initializeVault({ vaultRoot });
      await withHostedCanonicalWritePort({
        persistCanonicalWrite: async () => undefined,
        recordDiagnosticTiming(stage, elapsedMs) {
          expect(elapsedMs).toBeGreaterThanOrEqual(0);
          stages.push(stage);
        },
      }, async () => runCanonicalWrite({
        vaultRoot,
        operationType: "timing_test",
        summary: "Write synthetic evidence.",
        mutate: async ({ batch }) => {
          await batch.stageTextWrite("bank/timing.md", "synthetic\n");
        },
      }));
      expect(stages).toEqual([
        "localLedgerWrite", "writeLockWait", "receiptBuild", "localLedgerWrite",
      ]);
      expect(await fs.readFile(path.join(vaultRoot, "bank/timing.md"), "utf8"))
        .toBe("synthetic\n");
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });

  it.each([true, false])("preserves evidence only for an unknown outcome: %s", async (unknown) => {
    const vaultRoot = await fs.mkdtemp(path.join(tmpdir(), "canonical-outcome-"));
    const cause = new Error("Synthetic publication failure.");
    const error = unknown ? new HostedCanonicalWriteOutcomeUnknownError({ cause }) : cause;
    try {
      await initializeVault({ vaultRoot });
      const receiptRoot = path.join(vaultRoot, ".runtime/receipts");
      const batch = await WriteBatch.create({
        vaultRoot,
        operationType: "publication_test",
        summary: "Preserve uncertain publication evidence.",
        hostedCanonicalWriteReceiptDirectory: receiptRoot,
        hostedCanonicalWritePort: { persistCanonicalWrite: async () => { throw error; } },
      });
      await batch.stageTextWrite("bank/publication.md", "applied once\n");
      await expect(batch.commit()).rejects.toBe(error);
      const receiptPath = path.join(receiptRoot, `${batch.operationId}.json`);
      if (unknown) {
        const record = await readStoredWriteOperation(vaultRoot, batch.metadataRelativePath);
        expect(await fs.readFile(path.join(vaultRoot, "bank/publication.md"), "utf8")).toBe("applied once\n");
        expect(JSON.parse(await fs.readFile(receiptPath, "utf8"))).toMatchObject({ operationId: batch.operationId });
        expect(record).toMatchObject({ status: "committed", error: { message: error.message } });
        expect(await fs.readdir(path.join(vaultRoot, batch.stageRootRelativePath))).not.toEqual([]);
      } else {
        await expect(fs.access(path.join(vaultRoot, "bank/publication.md"))).rejects.toMatchObject({ code: "ENOENT" });
        await expect(fs.access(receiptPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readStoredWriteOperation(vaultRoot, batch.metadataRelativePath)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  });
});
