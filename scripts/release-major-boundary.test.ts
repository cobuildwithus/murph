import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const releaseManifest = JSON.parse(
  readFileSync(new URL("./release-manifest.json", import.meta.url), "utf8"),
);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseVerificationScript = fileURLToPath(
  new URL("./verify-release-target.mjs", import.meta.url),
);
const publicPackageNames = new Set(
  releaseManifest.packages.map((entry: { name: string }) => entry.name),
);
const removedContractsRootExports = [
  "EXPERIMENT_PROGRESS_CARD_VERSION",
  "EXPERIMENT_PROGRESS_CARD_MAX_WEEKS",
  "EXPERIMENT_PROGRESS_CARD_MAX_MOVERS",
  "EXPERIMENT_PROGRESS_CARD_MAX_CONFOUNDERS",
  "EXPERIMENT_PROGRESS_CARD_MAX_ENCODED_LENGTH",
  "EXPERIMENT_PROGRESS_CARD_DAY_CODES",
  "ExperimentProgressCardDayCode",
  "experimentProgressCardSchema",
  "ExperimentProgressCardData",
  "ExperimentProgressCardWeek",
  "ExperimentProgressCardMover",
  "ExperimentProgressCardConfounder",
  "encodeExperimentProgressCard",
  "decodeExperimentProgressCard",
  "buildExperimentProgressCardPath",
] as const;

function verifyReleaseTarget(
  expectedVersion: string,
  input: {
    cwd?: string;
    scriptPath?: string;
  } = {},
) {
  const result = spawnSync(
    process.execPath,
    [
      input.scriptPath ?? releaseVerificationScript,
      "--expect-version",
      expectedVersion,
    ],
    {
      cwd: input.cwd ?? repoRoot,
      encoding: "utf8",
    },
  );

  return {
    stderr: result.stderr,
    status: result.status,
    stdout: result.stdout,
  };
}

function verifyVersionAccurateReleaseTarget(expectedVersion: string) {
  const fixtureRoot = mkdtempSync(
    path.join(tmpdir(), "murph-release-boundary-"),
  );

  try {
    const fixtureScriptsDir = path.join(fixtureRoot, "scripts");
    const fixturePackagesDir = path.join(fixtureRoot, "packages");
    mkdirSync(fixtureScriptsDir, { recursive: true });
    mkdirSync(fixturePackagesDir, { recursive: true });

    copyFileSync(
      path.join(repoRoot, "package.json"),
      path.join(fixtureRoot, "package.json"),
    );
    for (const scriptFilename of [
      "release-helpers.mjs",
      "release-manifest.json",
      "verify-release-target.mjs",
    ]) {
      copyFileSync(
        path.join(repoRoot, "scripts", scriptFilename),
        path.join(fixtureScriptsDir, scriptFilename),
      );
    }

    const sourcePackagesDir = path.join(repoRoot, "packages");
    for (const entry of readdirSync(sourcePackagesDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourcePackageJsonPath = path.join(
        sourcePackagesDir,
        entry.name,
        "package.json",
      );
      if (!existsSync(sourcePackageJsonPath)) {
        continue;
      }

      const packageJson = JSON.parse(
        readFileSync(sourcePackageJsonPath, "utf8"),
      );
      if (publicPackageNames.has(packageJson.name)) {
        packageJson.version = expectedVersion;
      }

      const fixturePackageDir = path.join(fixturePackagesDir, entry.name);
      mkdirSync(fixturePackageDir, { recursive: true });
      writeFileSync(
        path.join(fixturePackageDir, "package.json"),
        `${JSON.stringify(packageJson, null, 2)}\n`,
      );
    }

    return verifyReleaseTarget(expectedVersion, {
      cwd: fixtureRoot,
      scriptPath: path.join(
        fixtureScriptsDir,
        "verify-release-target.mjs",
      ),
    });
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
}

describe("public package major-release boundary", () => {
  it("blocks patch and minor releases after the contracts root API removal", () => {
    for (const expectedVersion of ["1.2.5", "1.3.0"]) {
      const result = verifyReleaseTarget(expectedVersion);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("blocked by the public API boundary");
      expect(result.stderr).toContain("Use pnpm release:major");
    }
  });

  it("allows the next major release and records every removed root export", () => {
    for (const expectedVersion of ["2.0.0", "2.0.0-rc.0"]) {
      const result = verifyVersionAccurateReleaseTarget(expectedVersion);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(
        `Verified 5 publishable packages at ${expectedVersion}.`,
      );
    }

    const contractsRemoval =
      releaseManifest.publicApiReleaseBoundary.removals.find(
        (removal: { package?: string }) =>
          removal.package === "@murphai/contracts",
      );
    expect(contractsRemoval?.rootExports).toEqual(
      removedContractsRootExports,
    );
  });
});
