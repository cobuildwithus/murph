import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { findFiles } = require("./scanner.mjs");

it("scans stable sources without entering Health Commons replacement trees", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "workspace-boundary-scanner-"));
  const nonce = "12345678-1234-4123-8123-123456789abc";
  const stable = ["src/owner.ts", "generated/web/page.ts", ".generated.notes.old/owner.ts"];
  const transient = [
    `.generated.123.${nonce}.tmp/web/page.ts`,
    `.generated.123.${nonce}.old/web/page.ts`,
  ];
  try {
    for (const file of [...stable, ...transient]) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "export const synthetic = true;\n");
    }

    const files: string[] = await findFiles([root], (file: string) => file.endsWith(".ts"));

    expect(files.map((file) => path.relative(root, file)).sort()).toEqual(stable.sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
