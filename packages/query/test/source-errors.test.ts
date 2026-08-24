import { describe, expect, test } from "vitest";

import { QueryVaultSourceError } from "../src/source-errors.ts";

describe("QueryVaultSourceError source path privacy", () => {
  test.each([
    ["Unix absolute", "/private/unix-marker/vault.md", "unix-marker"],
    ["Windows drive", "C:\\private\\windows-marker\\vault.md", "windows-marker"],
    ["Windows drive with slashes", "C:/private/windows-slash-marker/vault.md", "windows-slash-marker"],
    ["UNC", "\\\\server-marker\\share\\vault.md", "server-marker"],
    ["traversal", "bank/../traversal-marker.md", "traversal-marker"],
    ["control character", "bank/control-marker\u0000.md", "control-marker"],
  ])("rejects %s paths before model-facing normalization", (_label, relativePath, marker) => {
    const error = new QueryVaultSourceError({
      issue: "frontmatter_invalid",
      lineNumber: 7,
      relativePath,
    });

    expect(error.details.relativePath).toBe("<vault-source>");
    expect(error.message).toBe("Canonical vault source <vault-source>:7 is invalid.");
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(error.message).not.toContain(marker);
  });

  test("retains a proven canonical vault-relative path", () => {
    const error = new QueryVaultSourceError({
      issue: "malformed_json",
      lineNumber: 3,
      relativePath: "ledger/events/2026/2026-08.jsonl",
    });

    expect(error.details.relativePath).toBe("ledger/events/2026/2026-08.jsonl");
    expect(error.message).toContain("ledger/events/2026/2026-08.jsonl:3");
  });
});
