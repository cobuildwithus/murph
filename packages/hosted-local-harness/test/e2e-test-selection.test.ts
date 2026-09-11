import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { assertHostedLocalVitestSelection } from "../src/e2e-test-selection.ts";

it("uses real Vitest collection to reject empty, overlapping and incomplete process selections before hooks run", async () => {
  const cwd = path.resolve(import.meta.dirname, "../../..");
  const directory = await mkdtemp(path.join(tmpdir(), "murph-selection-proof-"));
  const config = path.join(directory, "vitest.config.mts");
  const file = path.join(directory, "selection.test.mjs");
  const marker = path.join(directory, "stack-started");
  try {
    await writeFile(config, `export default { test: { include: [${JSON.stringify(file)}], maxWorkers: 1 } }`);
    await writeFile(file, [
      `import { beforeAll, describe, it } from ${JSON.stringify(import.meta.resolve("vitest"))};`,
      `import { writeFileSync } from 'node:fs';`,
      `beforeAll(() => writeFileSync(${JSON.stringify(marker)}, 'started'));`,
      "describe('alpha', () => it.each([1, 2])('dynamic %s', () => {}));",
      "describe('beta', () => it('recovers', () => {}));",
      "it.skip('intentionally unavailable', () => {});",
    ].join("\n"));
    const input = { config, cwd, env: process.env, files: [file] };
    await expect(assertHostedLocalVitestSelection({ ...input, patterns: ["^alpha", "^beta"] })).resolves.toBeUndefined();
    await expect(assertHostedLocalVitestSelection({ ...input, patterns: ["missing"] })).rejects.toThrow("zero runnable tests");
    await expect(assertHostedLocalVitestSelection({ ...input, patterns: ["^alpha", "dynamic"] })).rejects.toThrow("overlap");
    await expect(assertHostedLocalVitestSelection({ ...input, patterns: ["dynamic 1", "^beta"] })).rejects.toThrow("omit runnable tests");
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}, 120_000);
