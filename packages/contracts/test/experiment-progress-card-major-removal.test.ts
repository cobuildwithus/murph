import { describe, expect, it } from "vitest";

import * as contracts from "../src/index.ts";

const removedProgressCardUrlExports = [
  "EXPERIMENT_PROGRESS_CARD_MAX_ENCODED_LENGTH",
  "buildExperimentProgressCardPath",
  "decodeExperimentProgressCard",
  "encodeExperimentProgressCard",
] as const;

describe("@murphai/contracts 2.0 progress-card URL API removal", () => {
  it("keeps the private card schema while removing every URL codec export", () => {
    expect(contracts).toHaveProperty("EXPERIMENT_PROGRESS_CARD_VERSION", 2);
    expect(contracts).toHaveProperty("experimentProgressCardSchema");
    for (const exportName of removedProgressCardUrlExports) {
      expect(contracts).not.toHaveProperty(exportName);
    }
  });
});
