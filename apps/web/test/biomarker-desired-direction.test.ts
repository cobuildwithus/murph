import { describe, expect, it } from "vitest";

import { resolveBiomarkerDesiredDirection } from "@/src/lib/health-commons/biomarker-desired-direction";

describe("resolveBiomarkerDesiredDirection", () => {
  it("canonicalizes the legacy HRV key without conflating SDNN", () => {
    expect(resolveBiomarkerDesiredDirection("biomarker:hrv")).toBe(
      "higher_or_stable",
    );
    expect(resolveBiomarkerDesiredDirection("biomarker:hrv-rmssd")).toBe(
      "higher_or_stable",
    );
    expect(resolveBiomarkerDesiredDirection("biomarker:hrv-sdnn")).toBeNull();
  });
});
