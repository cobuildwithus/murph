import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];

function createHarness() {
  const sharedTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
  if (!sharedTempRoot) throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
  const root = mkdtempSync(path.join(sharedTempRoot, "evaluate-dev-cli-"));
  roots.push(root);

  const scriptsDir = path.join(root, "scripts");
  const appDir = path.join(root, "apps", "web");
  const binDir = path.join(root, "bin");
  const capturePath = path.join(root, "pnpm-arguments");
  const cwdCapturePath = path.join(root, "pnpm-cwd");
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(appDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = path.join(scriptsDir, "evaluate-dev-cli");
  writeFileSync(
    scriptPath,
    readFileSync(path.join(repoRoot, "scripts", "evaluate-dev-cli"), "utf8"),
  );
  chmodSync(scriptPath, 0o755);

  const rootManifest = '{"name":"fixture-root","private":true}\n';
  const appManifest = '{"name":"fixture-web","private":true}\n';
  const lockfile = "lockfileVersion: '9.0'\n# committed peer snapshot sentinel\n";
  writeFileSync(path.join(root, "package.json"), rootManifest);
  writeFileSync(path.join(appDir, "package.json"), appManifest);
  writeFileSync(path.join(root, "pnpm-lock.yaml"), lockfile);

  const fakePnpmPath = path.join(binDir, "pnpm");
  writeFileSync(
    fakePnpmPath,
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "$@" > "\${MURPH_TEST_PNPM_CAPTURE:?}"\npwd -P > "\${MURPH_TEST_PNPM_CWD_CAPTURE:?}"\n`,
  );
  chmodSync(fakePnpmPath, 0o755);

  return {
    appDir,
    appManifest,
    capturePath,
    cwdCapturePath,
    environment: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      MURPH_TEST_PNPM_CAPTURE: capturePath,
      MURPH_TEST_PNPM_CWD_CAPTURE: cwdCapturePath,
    },
    lockfile,
    root,
    rootManifest,
    scriptPath,
  };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("temporary development CLI evaluation", () => {
  it("uses isolated scriptless public-registry dlx without touching workspace dependency files", () => {
    const harness = createHarness();
    const result = spawnSync(
      harness.scriptPath,
      ["@fixture/tool@1.2.3", "--", "inspect", "--format", "json"],
      {
        cwd: harness.appDir,
        encoding: "utf8",
        env: harness.environment,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(harness.capturePath, "utf8")).toBe(
      [
        "--config.ignore-scripts=true",
        "--config.registry=https://registry.npmjs.org/",
        "dlx",
        "@fixture/tool@1.2.3",
        "--",
        "inspect",
        "--format",
        "json",
        "",
      ].join("\n"),
    );
    expect(readFileSync(harness.cwdCapturePath, "utf8").trim()).toBe(
      realpathSync(harness.appDir),
    );
    expect(readFileSync(path.join(harness.root, "package.json"), "utf8")).toBe(
      harness.rootManifest,
    );
    expect(readFileSync(path.join(harness.appDir, "package.json"), "utf8")).toBe(
      harness.appManifest,
    );
    expect(readFileSync(path.join(harness.root, "pnpm-lock.yaml"), "utf8")).toBe(
      harness.lockfile,
    );
  });

  it.each([
    "@fixture/tool@latest",
    "@fixture/tool@^1.2.3",
    "@fixture/tool@workspace:*",
    "file:../tool@1.2.3",
    "https://example.invalid/tool.tgz@1.2.3",
  ])("rejects non-exact or non-registry package spec %s before pnpm runs", (packageSpec) => {
    const harness = createHarness();
    const result = spawnSync(harness.scriptPath, [packageSpec], {
      cwd: harness.appDir,
      encoding: "utf8",
      env: harness.environment,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("requires an exact public-registry package spec");
    expect(() => readFileSync(harness.capturePath, "utf8")).toThrow();
  });
});
