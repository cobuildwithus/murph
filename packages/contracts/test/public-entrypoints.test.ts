import { describe, expect, it } from "vitest";

import * as contracts from "../src/index.ts";

describe("public preference selection", () => {
  it("normalizes supported wearable providers and removes duplicates", () => {
    expect(contracts.isWearablePreferenceProvider('oura')).toBe(true);
    expect(contracts.isWearablePreferenceProvider('fitbit')).toBe(false);
    expect(contracts.normalizeWearablePreferenceProviders(undefined)).toEqual([]);
    expect(
      contracts.normalizeWearablePreferenceProviders(['whoop', 'garmin', 'whoop']),
    ).toEqual(['garmin', 'whoop']);
  });

  it("resolves voice preferences with safe defaults for absent or retired ids", () => {
    expect(contracts.isAssistantVoiceOptionId("drill-sergeant")).toBe(true);
    expect(contracts.isAssistantVoiceOptionId("bright")).toBe(false);
    expect(contracts.defaultAssistantVoiceOptionId).toBe("upbeat");
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId("classic")).toBeNull();
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId("warm")).toBe(
      "EST9Ui6982FZPSi7gCHi",
    );
    // A retired roster id must fall back to the env voice rather than fail the
    // voice memo, so stale stored preferences stay harmless.
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId("retired-voice")).toBeNull();
    // No stored preference resolves to the shared default voice instead of the
    // env fallback.
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId(null)).toBe(
      "tnSpp4vdxKPjI9w0GnoV",
    );
    expect(contracts.resolveAssistantVoiceOptionElevenLabsVoiceId(undefined)).toBe(
      "tnSpp4vdxKPjI9w0GnoV",
    );
  });
});
