import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { test } from "vitest";

const execFileAsync = promisify(execFile);

test("linq subpath import stays free of sqlite warnings", async () => {
  const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const modulePath = pathToFileURL(path.join(packageDir, "src/linq.ts")).href;
  const result = await execFileAsync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    `import(${JSON.stringify(modulePath)})`,
  ], {
    cwd: packageDir,
  });

  assert.equal(result.stdout.trim(), "");
  assert.doesNotMatch(result.stderr, /SQLite is an experimental feature/u);
});
