import { VaultError } from "./errors.ts";
import { readUtf8File } from "./fs.ts";
import { normalizeRelativeVaultPath } from "./path-safety.ts";
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

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as UnknownRecord;
    } catch (error) {
      throw new VaultError("VAULT_INVALID_JSONL", `Invalid JSON on line ${index + 1}.`, {
        relativePath: normalizedRelativePath,
        lineNumber: index + 1,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
