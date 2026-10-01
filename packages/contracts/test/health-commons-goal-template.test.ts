import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  healthCommonsPageFrontmatterSchema,
} from "../src/health-commons.ts";
import {
  commonsGoalRefSchema,
  goalFrontmatterSchema,
} from "../src/zod.ts";

const revision = `sha256:${"a".repeat(64)}`;

const validGoalTemplate = {
  schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  entityType: "goal_template",
  key: "goal_template:lower-resting-heart-rate",
  slug: "lower-resting-heart-rate",
  title: "Lower My Resting Heart Rate",
  summary: "Build the habits and aerobic fitness that can support a lower resting-heart-rate trend.",
  status: "field-testing",
  quality: "usable",
  goal: {
    category: "cardio",
    outcomeKind: "biomarker",
    goalPhrase: "lower my resting heart rate",
    successSignals: [
      {
        id: "resting-heart-rate-trend",
        kind: "biomarker",
        label: "A lower resting heart rate trend",
      },
    ],
    evidenceSourceKeys: ["source_artifact:resting-heart-rate-guidance"],
    workflow: {
      kind: "training_plan",
      ownerSkillIds: ["aerobic-fitness", "hrv-resting-heart-rate"],
    },
    startPrompt: "Hey Murph, help me lower my resting heart rate.",
    indexable: true,
  },
  safety: {
    cautionLevel: "low",
  },
} as const;

describe("Health Commons goal templates", () => {
  it("accepts a short outcome title and composable workflow hints", () => {
    expect(healthCommonsPageFrontmatterSchema.parse(validGoalTemplate)).toMatchObject({
      goal: {
        category: "cardio",
        goalPhrase: "lower my resting heart rate",
        workflow: {
          kind: "training_plan",
        },
      },
    });
  });

  it("keeps the human-readable start prompt synchronized with the goal phrase", () => {
    const result = healthCommonsPageFrontmatterSchema.safeParse({
      ...validGoalTemplate,
      goal: {
        ...validGoalTemplate.goal,
        startPrompt: "Start a resting heart rate workflow.",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ["goal", "startPrompt"],
        }),
      ]));
    }
  });

  it("does not publish hidden or draft goals as indexable", () => {
    expect(healthCommonsPageFrontmatterSchema.safeParse({
      ...validGoalTemplate,
      status: "draft",
    }).success).toBe(false);
    expect(healthCommonsPageFrontmatterSchema.safeParse({
      ...validGoalTemplate,
      hidden: true,
    }).success).toBe(false);
  });

  it("keeps public slugs flat and parent references scoped to goals", () => {
    expect(healthCommonsPageFrontmatterSchema.safeParse({
      ...validGoalTemplate,
      slug: "cardio/lower-resting-heart-rate",
    }).success).toBe(false);
    expect(healthCommonsPageFrontmatterSchema.safeParse({
      ...validGoalTemplate,
      goal: {
        ...validGoalTemplate.goal,
        parentGoalKey: "protocol_variant:zone-2",
      },
    }).success).toBe(false);
  });
});

describe("private Goal commons lineage", () => {
  const commonsGoalRef = {
    key: "goal_template:lower-resting-heart-rate",
    pageRevisionId: revision,
    workflowSpecRevisionId: revision,
  } as const;

  it("accepts the exact public goal and workflow revisions", () => {
    expect(commonsGoalRefSchema.parse(commonsGoalRef)).toEqual(commonsGoalRef);
    expect(goalFrontmatterSchema.parse({
      schemaVersion: "murph.frontmatter.goal.v1",
      docType: "goal",
      goalId: "goal_01JNV43AK9SK58T6GX3DWRZH9Q",
      slug: "lower-resting-heart-rate",
      title: "Lower my resting heart rate",
      status: "active",
      horizon: "long_term",
      priority: 1,
      window: {
        startAt: "2026-08-30",
      },
      commonsGoalRef,
    })).toMatchObject({ commonsGoalRef });
  });

  it("rejects a non-goal Commons key", () => {
    expect(commonsGoalRefSchema.safeParse({
      ...commonsGoalRef,
      key: "protocol_variant:resting-heart-rate",
    }).success).toBe(false);
  });
});
