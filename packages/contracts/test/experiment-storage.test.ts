import { describe, expect, it } from "vitest";

import {
  classifyExperimentStorageFile,
  experimentDocumentRelativePath,
  isExperimentDocumentRelativePath,
  isExperimentOutcomeRelativePath,
} from "../src/experiment-storage.ts";

describe("experiment storage paths", () => {
  it("allows only direct slugged Markdown documents and direct outcome JSON", () => {
    expect(experimentDocumentRelativePath("sleep-reset")).toBe(
      "bank/experiments/sleep-reset.md",
    );
    expect(classifyExperimentStorageFile("bank/experiments/sleep-reset.md")).toBe(
      "document",
    );
    expect(classifyExperimentStorageFile("bank/experiments/outcomes/sleep-reset.json")).toBe(
      "outcome",
    );
    expect(isExperimentDocumentRelativePath("bank/experiments/nested/sleep-reset.md")).toBe(
      false,
    );
    expect(isExperimentOutcomeRelativePath("bank/experiments/outcomes/nested/result.json")).toBe(
      false,
    );
    expect(classifyExperimentStorageFile("bank/experiments/sleep-reset/photo.jpg")).toBe(
      "unsupported",
    );
  });

  it("rejects non-canonical experiment slugs", () => {
    expect(() => experimentDocumentRelativePath("Sleep Reset")).toThrow(
      /lowercase kebab-case/u,
    );
    expect(isExperimentDocumentRelativePath("bank/experiments/outcomes.md")).toBe(true);
  });
});
