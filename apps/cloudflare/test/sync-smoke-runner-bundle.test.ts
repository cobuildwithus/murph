import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { syncSmokeRunnerBundle } from "../scripts/sync-smoke-runner-bundle.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      await rm(tempDir, {
        force: true,
        recursive: true,
      });
    }),
  );
});

describe("syncSmokeRunnerBundle", () => {
  it("copies the generated smoke dist into the prepared bundle and removes the temporary build output", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "sync-smoke-runner-bundle-"));
    tempDirs.push(tempDir);

    const preparedBundleDir = path.join(tempDir, "runner-bundle");
    const builtSmokeDistDir = path.join(tempDir, "smoke-dist");
    const preparedDistDir = path.join(preparedBundleDir, "dist");
    const copiedSmokeScriptPath = path.join(preparedDistDir, "hosted-runner-smoke.js");

    await mkdir(path.join(preparedBundleDir, "node_modules"), {
      recursive: true,
    });
    await writeFile(path.join(preparedBundleDir, "package.json"), "{}\n");
    await mkdir(builtSmokeDistDir, {
      recursive: true,
    });
    await writeFile(copiedSmokeScriptPath.replace(preparedDistDir, builtSmokeDistDir), "smoke\n");

    await syncSmokeRunnerBundle({
      builtSmokeDistDir,
      preparedBundleDir,
    });

    await expect(readFile(copiedSmokeScriptPath, "utf8")).resolves.toBe("smoke\n");
    await expect(readFile(path.join(builtSmokeDistDir, "hosted-runner-smoke.js"), "utf8")).rejects
      .toThrow();
  });
});
