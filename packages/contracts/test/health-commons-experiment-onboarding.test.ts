import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
  healthCommonsExperimentOnboardingSchema,
} from "../src/health-commons.ts";

type SetupTargetObject =
  | "protocol"
  | "experimentRun"
  | "onboardingCapture"
  | "assistantSupport"
  | "analysisPlan";

interface SetupTarget {
  object: SetupTargetObject;
  field: string;
}

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
    target: SetupTarget;
  }>;
  adaptationPolicy?: {
    fields: Array<{
      id: string;
      label: string;
      target: SetupTarget;
      sourceSlotIds?: string[];
      requiredForRunSpec?: boolean;
      protocolReusable?: boolean;
      guidance?: string;
    }>;
    measurementPlan?: {
      testPlanId?: string;
      requiredSignals?: string[];
      optionalSignals?: string[];
      notes?: string[];
    };
    reusableSetup?: {
      enabled: boolean;
      target?: SetupTarget;
      sourceSlotIds?: string[];
      notes?: string[];
    };
  };
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
        target: {
          object: "experimentRun",
          field: "modality",
        },
      },
    ],
    adaptationPolicy: {
      fields: [
        {
          id: "modality",
          label: "Modality",
          target: {
            object: "protocol",
            field: "effectiveSpec.modality",
          },
          sourceSlotIds: ["modality"],
          requiredForRunSpec: true,
          protocolReusable: true,
          guidance: "Store the selected modality on the reusable protocol and run snapshot.",
        },
        {
          id: "measurement_plan",
          label: "Measurement plan",
          target: {
            object: "analysisPlan",
            field: "testPlanId",
          },
          requiredForRunSpec: true,
        },
      ],
      measurementPlan: {
        testPlanId: "wearable-cardio-fitness-49d",
        requiredSignals: ["biomarker:estimated-vo2max"],
        notes: ["Keep the same measurement plan for protocol-derived runs."],
      },
      reusableSetup: {
        enabled: true,
        target: {
          object: "protocol",
          field: "setupSnapshot",
        },
        sourceSlotIds: ["modality"],
        notes: ["Reuse the protocol only when the modality still matches."],
      },
    },
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
    expect(parsed.setupSlots?.[0]?.target).toEqual({
      object: "experimentRun",
      field: "modality",
    });
    expect(parsed.adaptationPolicy?.fields.map((field) => field.id)).toEqual([
      "modality",
      "measurement_plan",
    ]);
    expect(parsed.adaptationPolicy?.measurementPlan?.requiredSignals).toEqual([
      "biomarker:estimated-vo2max",
    ]);
    expect(parsed.adaptationPolicy?.reusableSetup?.target).toEqual({
      object: "protocol",
      field: "setupSnapshot",
    });
  });

  it("rejects setup slots without typed targets", () => {
    const base = createBaseOnboarding();
    const { target: _target, ...slotWithoutTarget } = base.setupSlots[0];
    const onboarding = {
      ...base,
      setupSlots: [slotWithoutTarget],
    };

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /target/u,
    );
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
    const slotWithoutOptions = { ...onboarding.setupSlots[0] };
    delete slotWithoutOptions.options;
    onboarding.setupSlots = [
      slotWithoutOptions,
    ];

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /Enum setup slots must declare options/,
    );
  });

  it("rejects unknown typed setup slot target objects", () => {
    const base = createBaseOnboarding();
    const onboarding = {
      ...base,
      setupSlots: [
        {
          ...base.setupSlots[0],
          target: {
            object: "privateProfile",
            field: "effectiveSpec.modality",
          },
        },
      ],
    };

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /Invalid option/u,
    );
  });

  it("rejects unsafe setup slot target fields", () => {
    const base = createBaseOnboarding();
    const onboarding = {
      ...base,
      setupSlots: [
        {
          ...base.setupSlots[0],
          target: {
            object: "experimentRun",
            field: "constructor",
          },
        },
      ],
    };

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /reserved/u,
    );
  });

  it("rejects typed target fields that include object prefixes", () => {
    const base = createBaseOnboarding();
    const baseAdaptationPolicy = base.adaptationPolicy;
    const baseAdaptationField = baseAdaptationPolicy?.fields[0];
    if (!baseAdaptationPolicy || !baseAdaptationField) {
      throw new Error("Base onboarding must include an adaptation policy field.");
    }
    const onboarding = {
      ...base,
      adaptationPolicy: {
        ...baseAdaptationPolicy,
        fields: [
          {
            ...baseAdaptationField,
            id: "timing_context",
            label: "Timing context",
            target: {
              object: "experimentRun",
              field: "runPlan.timingContext",
            },
          },
        ],
      },
    };

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /relative/u,
    );
  });
});
