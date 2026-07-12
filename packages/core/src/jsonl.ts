import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { VaultError } from "./errors.ts";
import { readUtf8File } from "./fs.ts";
import {
  assertPathWithinVaultOnDisk,
  normalizeRelativeVaultPath,
  resolveVaultPath,
} from "./path-safety.ts";
import { toIsoTimestamp } from "./time.ts";

import type { DateInput, UnknownRecord } from "./types.ts";

export function toMonthlyShardRelativePath(
  baseDirectory: string,
  value: DateInput | undefined,
  fieldName = "date",
): string {
  const basePath = normalizeRelativeVaultPath(baseDirectory);
  const timestamp = toIsoTimestamp(value, fieldName);
  const year = timestamp.slice(0, 4);
  const monthShard = timestamp.slice(0, 7);
  return `${basePath}/${year}/${monthShard}.jsonl`;
}

export async function readJsonlRecords({
  vaultRoot,
  relativePath,
}: {
  vaultRoot: string;
  relativePath: string;
}): Promise<UnknownRecord[]> {
  const normalizedRelativePath = normalizeRelativeVaultPath(relativePath);
  const content = await readUtf8File(vaultRoot, normalizedRelativePath);
  const lines = content.split("\n").filter(Boolean);

  return lines.map((line, index) =>
    parseJsonlRecord(line, index + 1, normalizedRelativePath));
}

export async function visitJsonlRecordsInterruptible({
  vaultRoot,
  relativePath,
  shouldContinue,
  signal,
  visit,
}: {
  vaultRoot: string;
  relativePath: string;
  shouldContinue?: () => boolean;
  signal?: AbortSignal | null;
  visit: (record: UnknownRecord, lineNumber: number) => Promise<void> | void;
}): Promise<{
  interrupted: boolean;
  visitedCount: number;
}> {
  const normalizedRelativePath = normalizeRelativeVaultPath(relativePath);
  if (shouldContinue?.() === false) {
    return { interrupted: true, visitedCount: 0 };
  }
  throwIfJsonlReadAborted(signal);

  const resolved = resolveVaultPath(vaultRoot, normalizedRelativePath);
  await assertPathWithinVaultOnDisk(resolved.vaultRoot, resolved.absolutePath);
  const input = createReadStream(resolved.absolutePath, {
    encoding: "utf8",
    signal: signal ?? undefined,
  });
  const lines = createInterface({
    crlfDelay: Infinity,
    input,
  });
  let interrupted = false;
  let lineNumber = 0;
  let visitedCount = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      throwIfJsonlReadAborted(signal);
      if (shouldContinue?.() === false) {
        interrupted = true;
        break;
      }
      if (!line) {
        continue;
      }
      await visit(
        parseJsonlRecord(line, lineNumber, normalizedRelativePath),
        lineNumber,
      );
      visitedCount += 1;
    }
  } finally {
    lines.close();
    input.destroy();
  }

  return { interrupted, visitedCount };
}

function parseJsonlRecord(
  line: string,
  lineNumber: number,
  relativePath: string,
): UnknownRecord {
  try {
    return JSON.parse(line) as UnknownRecord;
  } catch (error) {
    throw new VaultError("VAULT_INVALID_JSONL", `Invalid JSON on line ${lineNumber}.`, {
      relativePath,
      lineNumber,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function throwIfJsonlReadAborted(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("JSONL read aborted.", "AbortError");
}
