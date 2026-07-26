import { describe, expect, it } from "vitest";

import * as contracts from "../src/index.ts";

const removedProgressCardRootExports = [
  "EXPERIMENT_PROGRESS_CARD_VERSION",
  "buildExperimentProgressCardPath",
  "decodeExperimentProgressCard",
  "encodeExperimentProgressCard",
  "experimentProgressCardSchema",
] as const;

describe("@murphai/contracts 2.0 progress-card API removal", () => {
  it("keeps the retired public URL codec absent from the root runtime API", () => {
    for (const exportName of removedProgressCardRootExports) {
      expect(contracts).not.toHaveProperty(exportName);
    }
  });
});
