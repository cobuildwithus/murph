import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import {
  listWriteOperationMetadataPaths,
  readStoredWriteOperation,
  type StoredWriteOperation,
  WRITE_OPERATION_DIRECTORY,
} from "../../src/operations/write-batch.ts";

// Action/receipt tests inspect the actual durable record just before retirement.
// This observer never suppresses deletion or changes production write behavior.
// Retention tests use the real disk APIs directly, without this observer.
export function observeWriteOperations() {
  const retired = new Map<string, StoredWriteOperation>();
  const unlink = fs.unlink.bind(fs);
  beforeEach(() => {
    retired.clear();
    vi.spyOn(fs, "unlink").mockImplementation(async file => {
      const absolutePath = String(file);
      const marker = `/${WRITE_OPERATION_DIRECTORY}/`;
      const split = absolutePath.lastIndexOf(marker);
      const record = split >= 0 && /^op_[^/]+\.json$/u.test(absolutePath.slice(split + marker.length))
        ? await readStoredWriteOperation(absolutePath.slice(0, split), absolutePath.slice(split + 1)).catch(() => null)
        : null;
      await unlink(file);
      if (record) retired.set(absolutePath, record);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  return {
    async listObservedWriteOperationPaths(vaultRoot: string): Promise<string[]> {
      const paths = await listWriteOperationMetadataPaths(vaultRoot);
      for (const absolutePath of retired.keys()) {
        if (absolutePath.startsWith(`${vaultRoot}/${WRITE_OPERATION_DIRECTORY}/`)) {
          paths.push(path.relative(vaultRoot, absolutePath));
        }
      }
      return [...new Set(paths)].sort();
    },
    async readObservedWriteOperation(vaultRoot: string, relativePath: string): Promise<StoredWriteOperation> {
      return retired.get(path.join(vaultRoot, relativePath))
        ?? await readStoredWriteOperation(vaultRoot, relativePath);
    },
  };
}
