import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  parseHostedPulseTrialExtensionScriptOptions,
} from "../scripts/extend-pulse-trials";
import {
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
} from "../src/lib/hosted-ops/pulse-trial-extension";

describe("Pulse Trial extension production script", () => {
  test("defaults to a dry run without a campaign confirmation", () => {
    assert.deepEqual(parseHostedPulseTrialExtensionScriptOptions([]), {
      help: false,
      mode: "dry-run",
    });
  });

  test("requires the exact campaign key before apply", () => {
    assert.throws(
      () => parseHostedPulseTrialExtensionScriptOptions(["--apply"]),
      /requires --campaign/u,
    );
    assert.throws(
      () => parseHostedPulseTrialExtensionScriptOptions([
        "--apply",
        "--campaign",
        "another-campaign",
      ]),
      /requires --campaign/u,
    );
  });

  test("accepts apply only with the fixed campaign confirmation", () => {
    assert.deepEqual(parseHostedPulseTrialExtensionScriptOptions([
      "--apply",
      "--campaign",
      HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    ]), {
      help: false,
      mode: "apply",
    });
  });
});
