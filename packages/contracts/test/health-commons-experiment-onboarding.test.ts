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
  safetyScreen: {
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start";
    mustAsk: Array<{
      id: string;
      prompt: string;
      ifPositive?: "clinician_guidance_before_unsupervised_start" | "do_not_start_unsupervised";
    }>;
    stopIf?: {
      additionalConditions: string[];
    };
  };
  setupSlots: Array<{
    id: string;
    label: string;
    question: string;
    options?: string[];
    target?: SetupTarget;
    writePath?: string;
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
  planDefaults: {
    testPlanId: string;
    firstSessionGuidance: string;
    missedSessionGuidance?: string;
  };
  trackingHints: {
    confounderFields?: string[];
    confounders: string[];
    notes: string[];
  };
  supportHints: {
    missedLogFollowupCopy: string;
  };
}

function createBaseOnboarding(): TestOnboarding {
  return {
    schemaVersion: HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION,
    startIntent: {
      displayPrompt: "Hey Murph, I want to explore doing Norwegian 4x4 intervals.",
      intentSummary: "Explore Norwegian 4x4 Intervals",
    },
    safetyScreen: {
      dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start",
      mustAsk: [
        {
          id: "cardio_red_flags",
          prompt: "Any chest pain, fainting, or known unstable heart condition?",
          ifPositive: "clinician_guidance_before_unsupervised_start",
        },
      ],
      stopIf: {
        additionalConditions: ["new chest pain during exertion"],
      },
    },
    setupSlots: [
      {
        id: "modality",
        label: "Modality",
        question: "Which modality will you use?",
        options: ["bike", "rower"],
        target: {
          object: "experimentRun",
          field: "modality",
        },
      },
      {
        id: "reminder_policy",
        label: "Reminder preference",
        question: "Do you want a reminder?",
        options: ["none", "session_reminder"],
        writePath: "assistantSupport.reminderPolicy",
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
    planDefaults: {
      testPlanId: "wearable-cardio-fitness-49d",
      firstSessionGuidance: "Start with a conservative first interval session.",
      missedSessionGuidance: "If a session is missed, resume at the next planned slot.",
    },
    trackingHints: {
      confounderFields: ["recent_illness", "training_load_change"],
      confounders: ["recent_illness", "training_load_change"],
      notes: ["Treat wearable estimates as context."],
    },
    supportHints: {
      missedLogFollowupCopy: "Did the interval session happen today?",
    },
  };
}

describe("healthCommonsExperimentOnboardingSchema", () => {
  it("accepts compact onboarding deltas without duplicated plan or logging structure", () => {
    const parsed = healthCommonsExperimentOnboardingSchema.parse(createBaseOnboarding());

    expect(parsed.schemaVersion).toBe("murph.commons.experiment-onboarding.v2");
    expect(parsed.safetyScreen?.mustAsk[0]?.id).toBe("cardio_red_flags");
    expect(parsed.setupSlots?.map((slot) => slot.id)).toEqual([
      "modality",
      "reminder_policy",
    ]);
    expect(parsed.setupSlots?.[1]?.writePath).toBe("assistantSupport.reminderPolicy");
    expect(parsed.planDefaults).toEqual({
      testPlanId: "wearable-cardio-fitness-49d",
      firstSessionGuidance: "Start with a conservative first interval session.",
      missedSessionGuidance: "If a session is missed, resume at the next planned slot.",
    });
    expect(parsed.trackingHints?.confounderFields).toEqual([
      "recent_illness",
      "training_load_change",
    ]);
    expect(parsed.trackingHints?.confounders).toEqual([
      "recent_illness",
      "training_load_change",
    ]);
    expect(parsed.supportHints?.missedLogFollowupCopy).toBe(
      "Did the interval session happen today?",
    );
  });

  it("rejects legacy duplicated onboarding sections", () => {
    const onboarding = {
      ...createBaseOnboarding(),
      contextReview: {
        vaultChecks: [],
      },
      logging: {
        sessionFields: ["modality"],
      },
      assistantPolicy: {
        askBeforeCreatingAutomations: true,
        missedLogFollowup: "opt_in_only",
      },
    };

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /Unrecognized key/u,
    );
  });

  it("rejects duplicated plan defaults that canonical test plans own", () => {
    const onboarding = {
      ...createBaseOnboarding(),
      planDefaults: {
        ...createBaseOnboarding().planDefaults,
        baselineDays: 7,
        interventionDays: 42,
        sessionsPerWeek: 2,
        targetSessions: 12,
        minimumUsefulSessions: 8,
      },
    };

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /Unrecognized key/u,
    );
  });

  it("keeps runnable confounder field hints as stable ids", () => {
    const onboarding = createBaseOnboarding();
    onboarding.trackingHints.confounderFields = ["exact time since workout"];

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow();
  });

  it("rejects empty or duplicated runnable confounder field hints", () => {
    const emptyConfounderFields = createBaseOnboarding();
    emptyConfounderFields.trackingHints.confounderFields = [];

    expect(() => healthCommonsExperimentOnboardingSchema.parse(emptyConfounderFields)).toThrow();

    const duplicatedConfounderFields = createBaseOnboarding();
    duplicatedConfounderFields.trackingHints.confounderFields = [
      "recent_illness",
      "recent_illness",
    ];

    expect(() => healthCommonsExperimentOnboardingSchema.parse(duplicatedConfounderFields)).toThrow(
      /unique/u,
    );
  });

  it("rejects legacy setup slot metadata", () => {
    const base = createBaseOnboarding();
    const onboarding = {
      ...base,
      setupSlots: [
        {
          ...base.setupSlots[0],
          purpose: "logistics",
          valueType: "enum",
          askPolicy: "ask_if_unknown",
          required: true,
        },
      ],
    };

    expect(() => healthCommonsExperimentOnboardingSchema.parse(onboarding)).toThrow(
      /Unrecognized key/u,
    );
  });

  it("rejects setup slots without typed targets or write paths", () => {
    const base = createBaseOnboarding();
    const { target: _target, writePath: _writePath, ...slotWithoutTarget } = base.setupSlots[0];
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
