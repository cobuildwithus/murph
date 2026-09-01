import { describe, expect, it, vi } from "vitest";

import {
  runHostedGoalCliSmoke,
} from "../src/hosted-goal-cli-smoke.js";
import {
  HOSTED_RUNNER_SMOKE_HEALTH_COMMONS_CLI_GOAL_PROOF_COUNT,
} from "../src/hosted-runner-smoke-contract.js";

const pageRevisionId = `sha256:${"a".repeat(64)}`;
const workflowSpecRevisionId = `sha256:${"b".repeat(64)}`;
const catalogHash = `sha256:${"c".repeat(64)}`;
const commonsGoalRef = {
  key: "goal_template:improve-deep-sleep",
  pageRevisionId,
  workflowSpecRevisionId,
};
const publicGoalCategories = [
  "biomarkers",
  "cardio",
  "life-stages",
  "mind",
  "nutrition",
  "sleep",
  "strength",
] as const;

describe("runHostedGoalCliSmoke", () => {
  it("proves public discovery plus legacy and lineage create/read/update round trips", async () => {
    const responses = createSmokeResponses();
    const runCommand = vi.fn(async (label: string, _args: readonly string[]) => {
      const response = responses.get(label);
      if (!response) {
        throw new Error(`Unexpected synthetic smoke command label: ${label}`);
      }
      return response;
    });

    await expect(runHostedGoalCliSmoke({ runCommand })).resolves.toEqual({
      proofCount: HOSTED_RUNNER_SMOKE_HEALTH_COMMONS_CLI_GOAL_PROOF_COUNT,
    });
    expect(runCommand.mock.calls.map(([label]) => label)).toEqual([
      "commons-goal-list-metadata",
      ...publicGoalCategories.map((category) => `commons-goal-list-${category}`),
      "commons-goal-list-deep-sleep",
      "commons-goal-show",
      "legacy-goal-create",
      "legacy-goal-create-read",
      "legacy-goal-update",
      "legacy-goal-update-read",
      "lineage-goal-create",
      "lineage-goal-create-read",
      "lineage-goal-update",
      "lineage-goal-update-read",
    ]);
    expect(runCommand.mock.calls[0]?.[1]).toEqual([
      "commons",
      "goal",
      "list",
      "--limit",
      "1",
      "--format",
      "json",
    ]);
    expect(runCommand.mock.calls[1]?.[1]).toEqual([
      "commons",
      "goal",
      "list",
      "--category",
      "biomarkers",
      "--limit",
      "1",
      "--format",
      "json",
    ]);
    expect(runCommand.mock.calls[8]?.[1]).toEqual([
      "commons",
      "goal",
      "list",
      "--query",
      commonsGoalRef.key,
      "--limit",
      "2",
      "--format",
      "json",
    ]);
    expect(runCommand.mock.calls[12]?.[1]).toEqual([
      "goal",
      "save",
      "--id",
      "goal_legacy_smoke",
      "--status",
      "paused",
      "--format",
      "json",
    ]);
    expect(runCommand.mock.calls[14]?.[1]).toEqual([
      "goal",
      "save",
      "Improve my deep sleep",
      "--slug",
      "hosted-runner-smoke-improve-deep-sleep",
      "--status",
      "active",
      "--domain",
      "sleep",
      "--commons-goal-key",
      commonsGoalRef.key,
      "--commons-page-revision-id",
      pageRevisionId,
      "--commons-workflow-revision-id",
      workflowSpecRevisionId,
      "--format",
      "json",
    ]);
    expect(runCommand.mock.calls[16]?.[1]).toEqual([
      "goal",
      "save",
      "--id",
      "goal_lineage_smoke",
      "--status",
      "paused",
      "--format",
      "json",
    ]);
  });

  it("fails when a status-only update drops public Goal lineage", async () => {
    const responses = createSmokeResponses();
    responses.set(
      "lineage-goal-update-read",
      success({
        entity: {
          data: {
            status: "paused",
            title: "Improve my deep sleep",
          },
        },
      }),
    );

    await expect(runHostedGoalCliSmoke({
      async runCommand(label) {
        const response = responses.get(label);
        if (!response) {
          throw new Error(`Unexpected synthetic smoke command label: ${label}`);
        }
        return response;
      },
    })).rejects.toThrow("did not preserve exact Goal lineage");
  });

  it("rejects unbounded or article-bearing Commons payloads", async () => {
    const oversized = createSmokeResponses();
    oversized.set("commons-goal-list-metadata", success({
      catalogHash,
      goals: createGoalSummaries(2),
      total: 250,
    }));
    await expect(runHostedGoalCliSmoke({
      runCommand: responseRunner(oversized),
    })).rejects.toThrow("did not return one bounded sample");

    for (const field of ["body", "sourceSnippets"] as const) {
      const articleBearing = createSmokeResponses();
      articleBearing.set("commons-goal-show", success({
        catalogHash,
        goal: {
          [field]: "private-article-sentinel",
          key: commonsGoalRef.key,
          revision: {
            pageRevisionId,
            workflowSpecRevisionId,
          },
        },
      }));
      await expect(runHostedGoalCliSmoke({
        runCommand: responseRunner(articleBearing),
      })).rejects.toThrow("received a non-compact public goal payload");
    }
  });

  it("validates catalogs larger than the CLI per-query limit", async () => {
    const goals = createCatalogWithLargeCategory();

    await expect(runHostedGoalCliSmoke({
      runCommand: responseRunner(createSmokeResponses(goals)),
    })).resolves.toEqual({
      proofCount: HOSTED_RUNNER_SMOKE_HEALTH_COMMONS_CLI_GOAL_PROOF_COUNT,
    });
  });

  it("reconciles category partition counts to the current catalog total", async () => {
    const goals = createCatalogWithLargeCategory();
    const responses = createSmokeResponses(goals);
    responses.set("commons-goal-list-metadata", success({
      catalogHash,
      goals: goals.slice(0, 1),
      total: goals.length + 1,
    }));

    await expect(runHostedGoalCliSmoke({
      runCommand: responseRunner(responses),
    })).rejects.toThrow("found an incomplete or invalid public goal catalog");
  });

  it("requires at least 250 goals across exactly seven public categories", async () => {
    const tooSmall = createSmokeResponses(createGoalSummaries(249));
    await expect(runHostedGoalCliSmoke({
      runCommand: responseRunner(tooSmall),
    })).rejects.toThrow("found too few public goals");

    const missingCategory = createSmokeResponses(
      createGoalSummaries(250, publicGoalCategories.slice(0, -1)),
    );
    await expect(runHostedGoalCliSmoke({
      runCommand: responseRunner(missingCategory),
    })).rejects.toThrow("found an incomplete or invalid public goal catalog");

    const extraCategory = createSmokeResponses(
      createGoalSummaries(250, [...publicGoalCategories, "unexpected"]),
    );
    await expect(runHostedGoalCliSmoke({
      runCommand: responseRunner(extraCategory),
    })).rejects.toThrow("found an incomplete or invalid public goal catalog");
  });

  it("does not echo malformed command output in smoke failures", async () => {
    const privateSentinel = "private-goal-output-sentinel";
    let error: Error | null = null;
    try {
      await runHostedGoalCliSmoke({
        async runCommand() {
          return privateSentinel;
        },
      });
    } catch (caught) {
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    expect(error?.message).toContain("was not valid JSON");
    expect(error?.message).not.toContain(privateSentinel);
  });
});

function createSmokeResponses(
  goals: Record<string, unknown>[] = createGoalSummaries(250),
): Map<string, string> {
  const responses = new Map<string, string>([
    [
      "commons-goal-list-metadata",
      success({
        catalogHash,
        goals: goals.slice(0, 1),
        total: goals.length,
      }),
    ],
    [
      "commons-goal-list-deep-sleep",
      success({
        catalogHash,
        goals: goals.filter((goal) => goal.key === commonsGoalRef.key).slice(0, 2),
        total: goals.filter((goal) => goal.key === commonsGoalRef.key).length,
      }),
    ],
    [
      "commons-goal-show",
      success({
        catalogHash,
        goal: {
          key: commonsGoalRef.key,
          revision: {
            pageRevisionId,
            workflowSpecRevisionId,
          },
        },
      }),
    ],
    [
      "legacy-goal-create",
      success({ created: true, goalId: "goal_legacy_smoke" }),
    ],
    [
      "legacy-goal-create-read",
      success({
        entity: {
          data: {
            status: "active",
            title: "Hosted runner smoke legacy goal",
          },
        },
      }),
    ],
    [
      "legacy-goal-update",
      success({ created: false, goalId: "goal_legacy_smoke" }),
    ],
    [
      "legacy-goal-update-read",
      success({
        entity: {
          data: {
            status: "paused",
            title: "Hosted runner smoke legacy goal",
          },
        },
      }),
    ],
    [
      "lineage-goal-create",
      success({ created: true, goalId: "goal_lineage_smoke" }),
    ],
    [
      "lineage-goal-create-read",
      success({
        entity: {
          data: {
            commonsGoalRef,
            status: "active",
            title: "Improve my deep sleep",
          },
        },
      }),
    ],
    [
      "lineage-goal-update",
      success({ created: false, goalId: "goal_lineage_smoke" }),
    ],
    [
      "lineage-goal-update-read",
      success({
        entity: {
          data: {
            commonsGoalRef,
            status: "paused",
            title: "Improve my deep sleep",
          },
        },
      }),
    ],
  ]);
  for (const category of publicGoalCategories) {
    const categoryGoals = goals.filter((goal) => goal.category === category);
    responses.set(`commons-goal-list-${category}`, success({
      catalogHash,
      goals: categoryGoals.slice(0, 1),
      total: categoryGoals.length,
    }));
  }
  return responses;
}

function createGoalSummaries(
  count: number,
  categories: readonly string[] = publicGoalCategories,
): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => {
    const routeId = index === 0 ? "improve-deep-sleep" : `synthetic-${index}`;
    const goalPhrase = index === 0
      ? "improve my deep sleep"
      : `complete synthetic goal ${index}`;

    return {
      aliases: [],
      category: index === 0 ? "sleep" : categories[(index - 1) % categories.length],
      goalPhrase,
      indexable: true,
      key: index === 0 ? commonsGoalRef.key : `goal_template:${routeId}`,
      outcomeKind: "behavior",
      parentGoalKey: null,
      quality: "usable",
      revision: {
        pageRevisionId,
        workflowSpecRevisionId,
      },
      routeId,
      safetyTier: "low",
      slug: routeId,
      sources: [
        {
          label: "Synthetic source one",
          url: "https://example.com/source-one",
        },
        {
          label: "Synthetic source two",
          url: "https://example.org/source-two",
        },
      ],
      startPrompt: index === 0
        ? "Hey Murph, help me improve my deep sleep."
        : `Hey Murph, help me ${goalPhrase}.`,
      status: "field-testing",
      successSignals: [],
      summary: `Synthetic goal ${index} summary.`,
      title: index === 0 ? "Improve My Deep Sleep" : `Synthetic Goal ${index}`,
      workflow: {
        kind: "habit_plan",
        ownerSkillIds: ["behavior-followthrough"],
      },
    };
  });
}

function createCatalogWithLargeCategory(): Record<string, unknown>[] {
  const goals = createGoalSummaries(508, ["biomarkers"]);
  const missingCategories = [
    "cardio",
    "life-stages",
    "mind",
    "nutrition",
    "strength",
  ] as const;
  const categoryGoals = createGoalSummaries(
    goals.length + missingCategories.length,
  ).slice(goals.length).map((goal, index) => ({
    ...goal,
    category: missingCategories[index],
  }));
  return [...goals, ...categoryGoals];
}

function responseRunner(responses: ReadonlyMap<string, string>) {
  return async (label: string): Promise<string> => {
    const response = responses.get(label);
    if (!response) {
      throw new Error(`Unexpected synthetic smoke command label: ${label}`);
    }
    return response;
  };
}

function success(data: Record<string, unknown>): string {
  return JSON.stringify({
    data,
    ok: true,
  });
}
