import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { test, vi } from "vitest";

import { copyFileAtomicExclusive, writeTextFileAtomicExclusive } from "../src/atomic-write.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("writeTextFileAtomicExclusive falls back to a direct create when linking is unavailable", async () => {
  const tempDirectory = await makeTempDirectory("murph-atomic-write-exclusive");
  const targetAbsolutePath = path.join(tempDirectory, "note.txt");
  const linkSpy = vi.spyOn(fs, "link").mockRejectedValueOnce(
    Object.assign(new Error("cross-device link"), {
      code: "EXDEV",
    }),
  );

  try {
    await writeTextFileAtomicExclusive(targetAbsolutePath, "hello\n");

    assert.equal(await fs.readFile(targetAbsolutePath, "utf8"), "hello\n");
    assert.deepEqual(await fs.readdir(tempDirectory), ["note.txt"]);
  } finally {
    linkSpy.mockRestore();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

test("copyFileAtomicExclusive falls back to a direct copy when linking is unavailable", async () => {
  const tempDirectory = await makeTempDirectory("murph-atomic-copy-exclusive");
  const sourceAbsolutePath = path.join(tempDirectory, "source.txt");
  const targetAbsolutePath = path.join(tempDirectory, "copy.txt");
  const linkSpy = vi.spyOn(fs, "link").mockRejectedValueOnce(
    Object.assign(new Error("operation not permitted"), {
      code: "EPERM",
    }),
  );

  try {
    await fs.writeFile(sourceAbsolutePath, "copied\n", "utf8");

    await copyFileAtomicExclusive(sourceAbsolutePath, targetAbsolutePath);

    assert.equal(await fs.readFile(targetAbsolutePath, "utf8"), "copied\n");
    assert.deepEqual((await fs.readdir(tempDirectory)).sort(), ["copy.txt", "source.txt"]);
  } finally {
    linkSpy.mockRestore();
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
