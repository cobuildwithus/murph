import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  it("copies the prepared production bundle, overlays smoke dist, and removes the temporary build output", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "sync-smoke-runner-bundle-"));
    tempDirs.push(tempDir);

    const productionBundleDir = path.join(tempDir, "runner-bundle");
    const smokeBundleDir = path.join(tempDir, "runner-smoke-bundle");
    const builtSmokeDistDir = path.join(tempDir, "smoke-dist");
    const productionDistDir = path.join(productionBundleDir, "dist");
    const smokeOnlyZodDir = path.join(tempDir, "smoke-only-zod");
    const productionPnpmPackageDir = path.join(
      productionBundleDir,
      "node_modules",
      ".pnpm",
      "example@1.0.0",
      "node_modules",
      "example",
    );
    const smokeDistDir = path.join(smokeBundleDir, "dist");
    const copiedProductionScriptPath = path.join(smokeDistDir, "container-entrypoint.js");
    const copiedSmokeScriptPath = path.join(smokeDistDir, "hosted-runner-smoke.js");
    const copiedSmokeZodPackageJsonPath = path.join(
      smokeBundleDir,
      "node_modules",
      "zod",
      "package.json",
    );

    await mkdir(path.join(productionBundleDir, "node_modules"), {
      recursive: true,
    });
    await writeFile(path.join(productionBundleDir, "package.json"), "{}\n");
    await mkdir(productionDistDir, {
      recursive: true,
    });
    await mkdir(productionPnpmPackageDir, {
      recursive: true,
    });
    await writeFile(path.join(productionDistDir, "container-entrypoint.js"), "entry\n");
    await symlink(
      ".pnpm/example@1.0.0/node_modules/example",
      path.join(productionBundleDir, "node_modules", "example"),
    );
    await mkdir(builtSmokeDistDir, {
      recursive: true,
    });
    await writeFile(path.join(builtSmokeDistDir, "hosted-runner-smoke.js"), "smoke\n");
    await mkdir(smokeOnlyZodDir, { recursive: true });
    await writeFile(
      path.join(smokeOnlyZodDir, "package.json"),
      JSON.stringify({ name: "zod", version: "4.4.3" }),
    );

    await syncSmokeRunnerBundle({
      builtSmokeDistDir,
      productionBundleDir,
      smokeBundleDir,
      smokeOnlyZodDir,
    });

    await expect(readFile(copiedProductionScriptPath, "utf8")).resolves.toBe("entry\n");
    await expect(readFile(copiedSmokeScriptPath, "utf8")).resolves.toBe("smoke\n");
    await expect(readFile(copiedSmokeZodPackageJsonPath, "utf8")).resolves.toContain(
      '"name":"zod"',
    );
    await expect(
      readFile(
        path.join(productionBundleDir, "node_modules", "zod", "package.json"),
        "utf8",
      ),
    ).rejects.toThrow();
    await expect(
      readlink(path.join(smokeBundleDir, "node_modules", "example")),
    ).resolves.toBe(".pnpm/example@1.0.0/node_modules/example");
    await expect(readFile(path.join(productionDistDir, "hosted-runner-smoke.js"), "utf8")).rejects
      .toThrow();
    await expect(readFile(path.join(builtSmokeDistDir, "hosted-runner-smoke.js"), "utf8")).rejects
      .toThrow();
  });
});
