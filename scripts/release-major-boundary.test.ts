import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validatePublicApiReleaseBoundary } from "./release-helpers.mjs";

const releaseManifest = JSON.parse(
  readFileSync(new URL("./release-manifest.json", import.meta.url), "utf8"),
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

describe("public package major-release boundary", () => {
  it("blocks patch and minor releases after the contracts root API removal", () => {
    expect(
      validatePublicApiReleaseBoundary(releaseManifest, "1.2.5"),
    ).toEqual([
      expect.stringContaining("Use pnpm release:major"),
    ]);
    expect(
      validatePublicApiReleaseBoundary(releaseManifest, "1.3.0"),
    ).toEqual([
      expect.stringContaining("Use pnpm release:major"),
    ]);
  });

  it("allows the next major release and records every removed root export", () => {
    expect(
      validatePublicApiReleaseBoundary(releaseManifest, "2.0.0"),
    ).toEqual([]);
    expect(
      validatePublicApiReleaseBoundary(releaseManifest, "2.0.0-rc.0"),
    ).toEqual([]);

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
