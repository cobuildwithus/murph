import { describe, expect, test } from "vitest";

import {
  memoryDocumentRelativePath,
  MemoryDocumentParseError,
} from "../src/memory.ts";

describe("MemoryDocumentParseError source path privacy", () => {
  test.each([
    ["Unix absolute", "/private/unix-marker/memory.md", "unix-marker"],
    ["Windows drive", "C:\\private\\windows-marker\\memory.md", "windows-marker"],
    ["Windows drive with slashes", "C:/private/windows-slash-marker/memory.md", "windows-slash-marker"],
    ["UNC", "\\\\server-marker\\share\\memory.md", "server-marker"],
    ["traversal", "bank/../traversal-marker.md", "traversal-marker"],
    ["control character", "bank/control-marker\u0000.md", "control-marker"],
  ])("rejects %s paths before model-facing normalization", (_label, sourcePath, marker) => {
    const error = new MemoryDocumentParseError({
      issue: "record_metadata_invalid",
      lineNumber: 9,
      sourcePath,
    });

    expect(error.details.sourcePath).toBe(memoryDocumentRelativePath);
    expect(error.message).toBe(
      `Canonical memory document ${memoryDocumentRelativePath}:9 is invalid.`,
    );
    expect(JSON.stringify(error)).not.toContain(marker);
    expect(error.message).not.toContain(marker);
  });

  test("retains the proven canonical memory-relative path", () => {
    const error = new MemoryDocumentParseError({
      issue: "record_metadata_missing",
      lineNumber: 11,
      sourcePath: memoryDocumentRelativePath,
    });

    expect(error.details.sourcePath).toBe(memoryDocumentRelativePath);
    expect(error.message).toContain(`${memoryDocumentRelativePath}:11`);
  });
});
