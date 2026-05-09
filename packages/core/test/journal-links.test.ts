import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { test } from "vitest";

import {
  initializeVault,
  linkJournalEventIds,
  linkJournalStreams,
  VaultError,
} from "../src/index.ts";

async function makeTempVaultRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "murph-core-journal-links-"));
}

test("journal link validation fails before creating a journal day", async () => {
  const vaultRoot = await makeTempVaultRoot();
  try {
    await initializeVault({ vaultRoot });

    await assert.rejects(
      () =>
        linkJournalEventIds({
          vaultRoot,
          date: "2026-03-13",
          values: ["not-an-event-id"],
        }),
      (error) =>
        error instanceof VaultError &&
        error.code === "JOURNAL_LINK_INVALID",
    );

    await assert.rejects(
      () =>
        linkJournalStreams({
          vaultRoot,
          date: "2026-03-14",
          values: ["not_a_stream"],
        }),
      (error) =>
        error instanceof VaultError &&
        error.code === "JOURNAL_LINK_INVALID",
    );

    await assert.rejects(
      fs.access(path.join(vaultRoot, "journal/2026/2026-03-13.md")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      fs.access(path.join(vaultRoot, "journal/2026/2026-03-14.md")),
      { code: "ENOENT" },
    );
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
});
