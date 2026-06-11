import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bundleInstalledVaultCliBinary } from "../scripts/runner-bundle/bundle-cli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

// A miniature installed CLI that exercises the two bundle hazards the real
// vault-cli has: createRequire(import.meta.url) + require('../package.json'),
// and a deterministic response for every parity probe.
const FAKE_CLI_SOURCE = [
  "import { createRequire } from 'node:module';",
  "const require = createRequire(import.meta.url);",
  "const packageJson = require('../package.json');",
  "console.log(JSON.stringify({ args: process.argv.slice(2), version: packageJson.version }));",
  "",
].join("\n");

// Output that depends on the executing file's location diverges between the
// bundled and unbundled binaries, which the parity battery must reject.
const DIVERGENT_CLI_SOURCE = [
  "import { createRequire } from 'node:module';",
  "const require = createRequire(import.meta.url);",
  "require('../package.json');",
  "console.log(import.meta.url);",
  "",
].join("\n");

async function stageFakeInstalledCli(cliSource: string): Promise<string> {
  const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-runner-cli-bundle-"));
  temporaryDirectories.push(bundleDir);

  const cliPackageDir = path.join(bundleDir, "node_modules", "@murphai", "murph");
  await mkdir(path.join(cliPackageDir, "dist"), { recursive: true });
  await mkdir(path.join(bundleDir, "node_modules", ".bin"), { recursive: true });
  await writeFile(
    path.join(cliPackageDir, "package.json"),
    JSON.stringify({ name: "@murphai/murph", type: "module", version: "9.9.9" }),
    "utf8",
  );
  await writeFile(path.join(cliPackageDir, "dist", "bin.js"), cliSource, "utf8");

  return bundleDir;
}

describe("runner bundle vault-cli esbuild step", () => {
  it("bundles the installed CLI, passes parity, and retargets both bin wrappers", async () => {
    const bundleDir = await stageFakeInstalledCli(FAKE_CLI_SOURCE);

    await bundleInstalledVaultCliBinary(bundleDir);

    const bundledEntry = path.join(
      bundleDir,
      "node_modules",
      "@murphai",
      "murph",
      ".bundle",
      "bin.js",
    );
    await access(bundledEntry);

    for (const binName of ["vault-cli", "murph"]) {
      const wrapper = await readFile(
        path.join(bundleDir, "node_modules", ".bin", binName),
        "utf8",
      );
      expect(wrapper).toContain("../@murphai/murph/.bundle/bin.js");
    }

    // The bundled binary must resolve ../package.json from its on-disk
    // location exactly like the unbundled one.
    const output = execFileSync(process.execPath, [bundledEntry, "--help"], {
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual({ args: ["--help"], version: "9.9.9" });
  });

  it("fails the assembly when bundled output diverges from the unbundled binary", async () => {
    const bundleDir = await stageFakeInstalledCli(DIVERGENT_CLI_SOURCE);

    await expect(bundleInstalledVaultCliBinary(bundleDir)).rejects.toThrow(
      /Bundled vault-cli output diverged/,
    );
  });

  it("fails fast when the installed CLI entry is missing", async () => {
    const bundleDir = await mkdtemp(path.join(tmpdir(), "murph-runner-cli-bundle-"));
    temporaryDirectories.push(bundleDir);

    await expect(bundleInstalledVaultCliBinary(bundleDir)).rejects.toThrow();
  });
});
