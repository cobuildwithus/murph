import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const releaseManifest = JSON.parse(
  readFileSync(new URL("./release-manifest.json", import.meta.url), "utf8"),
);
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseVerificationScript = fileURLToPath(
  new URL("./verify-release-target.mjs", import.meta.url),
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

function verifyReleaseTarget(expectedVersion: string) {
  const result = spawnSync(
    process.execPath,
    [releaseVerificationScript, "--expect-version", expectedVersion],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

describe("public package major-release boundary", () => {
  it("blocks patch and minor releases after the contracts root API removal", () => {
    for (const expectedVersion of ["1.2.5", "1.3.0"]) {
      const result = verifyReleaseTarget(expectedVersion);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("blocked by the public API boundary");
      expect(result.output).toContain("Use pnpm release:major");
    }
  });

  it("allows the next major release and records every removed root export", () => {
    for (const expectedVersion of ["2.0.0", "2.0.0-rc.0"]) {
      const result = verifyReleaseTarget(expectedVersion);
      expect(result.status).not.toBe(0);
      expect(result.output).not.toContain("public API boundary");
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
