import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  createEmptyMemoryDocument,
  memoryDocumentRelativePath,
  renderMemoryDocument,
  upsertMemoryRecord,
} from "@murphai/contracts";

export const VAULT_CLI_MEMORY_SHOW_ARGS = [
  "memory",
  "show",
  "--format",
  "json",
] as const;

const FIXTURE_TIMESTAMP = "2026-08-01T00:00:00.000Z";
const FIXTURE_VAULT_ID = "vault_0123456789ABCDEFGHJKMNPQRS";
const FIXTURE_MEMORY_ID = "mem_0123456789ABCDEFGHJKMNPQRS";

export async function createInitializedVaultCliMemoryFixture(input: {
  includeMemory: boolean;
  vaultRoot: string;
}): Promise<void> {
  const bankRoot = path.join(input.vaultRoot, "bank");
  await mkdir(bankRoot, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(input.vaultRoot, 0o700);
  await chmod(bankRoot, 0o700);

  await writePrivateFile(
    path.join(input.vaultRoot, "vault.json"),
    `${JSON.stringify({
      createdAt: FIXTURE_TIMESTAMP,
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC",
      title: "Runner Memory Parity Fixture",
      vaultId: FIXTURE_VAULT_ID,
    }, null, 2)}\n`,
  );
  await writePrivateFile(
    path.join(input.vaultRoot, "CORE.md"),
    [
      "---",
      "schemaVersion: hv/core@v1",
      `vaultId: ${FIXTURE_VAULT_ID}`,
      "title: Runner Memory Parity Fixture",
      "---",
      "# Runner Memory Parity Fixture",
      "",
    ].join("\n"),
  );

  if (input.includeMemory) {
    await writeCanonicalMemoryDocument(input.vaultRoot);
  } else {
    await rm(path.join(input.vaultRoot, memoryDocumentRelativePath), {
      force: true,
    });
  }
}

async function writeCanonicalMemoryDocument(vaultRoot: string): Promise<void> {
  const now = new Date(FIXTURE_TIMESTAMP);
  const fixture = upsertMemoryRecord(createEmptyMemoryDocument(now), {
    now,
    recordId: FIXTURE_MEMORY_ID,
    section: "Context",
    text: "Synthetic runner memory parity record.",
  });
  const bankRoot = path.join(vaultRoot, "bank");
  await mkdir(bankRoot, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(bankRoot, 0o700);
  await writePrivateFile(
    path.join(vaultRoot, memoryDocumentRelativePath),
    renderMemoryDocument({ document: fixture.document }),
  );
}

async function writePrivateFile(
  filePath: string,
  contents: string,
): Promise<void> {
  await writeFile(filePath, contents, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
}
