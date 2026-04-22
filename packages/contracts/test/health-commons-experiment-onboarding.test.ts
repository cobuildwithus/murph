import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
  healthCommonsExperimentOnboardingSchema,
} from "../src/health-commons.ts";

interface TestOnboarding {
  schemaVersion: string;
  startIntent: {
    displayPrompt: string;
    intentSummary: string;
  };
  contextReview: {
    vaultChecks: Array<{
      id: string;
      reason: string;
      readHints: string[];
    }>;
  };
  setupSlots: Array<{
    id: string;
    label: string;
    purpose: "logistics";
    valueType: "enum";
    askPolicy: "ask_if_unknown";
    required: boolean;
    options?: string[];
  }>;
  logging: {
    sessionFields: string[];
  };
  assistantPolicy: {
    askBeforeCreatingAutomations: boolean;
    missedLogFollowup: "opt_in_only";
  };
}

function createBaseOnboarding(): TestOnboarding {
  return {
    schemaVersion: HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
    startIntent: {
      displayPrompt: "Hey Murph, I want to explore doing Norwegian 4x4 intervals.",
      intentSummary: "Explore Norwegian 4x4 Intervals",
    },
    contextReview: {
      vaultChecks: [
        {
          id: "active_experiments",
          reason: "Preserve the one-meaningful-experiment default.",
          readHints: ["experiment list --status active --format json"],
        },
      ],
    },
    setupSlots: [
      {
        id: "modality",
        label: "Modality",
        purpose: "logistics",
        valueType: "enum",
        askPolicy: "ask_if_unknown",
        required: true,
        options: ["bike", "rower"],
      },
    ],
    logging: {
      sessionFields: ["modality"],
    },
    assistantPolicy: {
      askBeforeCreatingAutomations: true,
      missedLogFollowup: "opt_in_only",
    },
  };
}

describe("healthCommonsExperimentOnboardingSchema", () => {
  it("accepts reusable onboarding blocks with command read hints", () => {
    const parsed = healthCommonsExperimentOnboardingSchema.parse(createBaseOnboarding());

    expect(parsed.contextReview?.vaultChecks?.[0]?.readHints).toEqual([
      "experiment list --status active --format json",
    ]);
  });

  it("rejects duplicate setup slot ids", () => {
    const onboarding = createBaseOnboarding();
    onboarding.setupSlots = [
      ...onboarding.setupSlots,
      {
        ...onboarding.setupSlots[0],
      },
    ];

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /Duplicate onboarding id modality/,
    );
  });

  it("requires enum setup slots to declare options", () => {
    const onboarding = createBaseOnboarding();
    onboarding.setupSlots = [
      {
        ...onboarding.setupSlots[0],
        options: undefined,
      },
    ];

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /Enum setup slots must declare options/,
    );
  });
});
