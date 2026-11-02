import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { listWriteOperationMetadataPaths, readStoredWriteOperation } from "@murphai/core";
import { persistCanonicalInboxCapture } from "../../src/indexing/persist.ts";

// Capture the actual on-disk committing state immediately before an append.
// Let the real write finish (including journal deletion), then restore only that
// recovery snapshot. The caller restores/removes canonical targets to match the
// interrupted instant. No committed journal is used to fabricate recovery state.
export async function persistInterruptedInboxCapture(input: Parameters<typeof persistCanonicalInboxCapture>[0]) {
  const appendPath = `ledger/inbox-captures/${input.input.occurredAt.slice(0, 4)}/${input.input.occurredAt.slice(0, 7)}.jsonl`;
  const files = new Map<string, Buffer>();
  const appendFile = fs.appendFile.bind(fs);
  const spy = vi.spyOn(fs, "appendFile").mockImplementation(async (...args) => {
    if (String(args[0]) === path.join(input.vaultRoot, appendPath)) {
      for (const relativePath of await listWriteOperationMetadataPaths(input.vaultRoot)) {
        const operation = await readStoredWriteOperation(input.vaultRoot, relativePath);
        if (operation.operationType !== "inbox_capture_persist" || operation.status !== "committing") continue;
        const action = operation.actions.find(action => action.kind === "jsonl_append"
          && action.targetRelativePath === appendPath && action.state === "staged");
        if (!action || action.kind !== "jsonl_append") continue;
        const payload = await fs.readFile(path.join(input.vaultRoot, action.stageRelativePath));
        if (!payload.equals(typeof args[1] === "string" ? Buffer.from(args[1]) : args[1])) continue;
        assert.equal(files.size, 0, "exactly one active operation must match the append");
        files.set(relativePath, await fs.readFile(path.join(input.vaultRoot, relativePath)));
        for (const action of operation.actions) {
          const artifacts = [
            "stageRelativePath" in action ? action.stageRelativePath : undefined,
            "backupRelativePath" in action ? action.backupRelativePath : undefined,
          ];
          for (const file of artifacts) {
            if (typeof file === "string") files.set(file, await fs.readFile(path.join(input.vaultRoot, file)));
          }
        }
      }
    }
    return appendFile(...args);
  });
  let result: Awaited<ReturnType<typeof persistCanonicalInboxCapture>>;
  try { result = await persistCanonicalInboxCapture(input); } finally { spy.mockRestore(); }
  assert.ok(files.size > 1, "captured a nonterminal journal and staged payload before append");
  for (const [relativePath, bytes] of files) {
    const absolutePath = path.join(input.vaultRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, bytes);
  }
  return result;
}
