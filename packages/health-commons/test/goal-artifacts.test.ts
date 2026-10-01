import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  type HealthCommonsPageFrontmatter,
} from "@murphai/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { buildHealthCommonsCatalogFromContent } from "../src/catalog.ts";
import { loadGeneratedHealthCommonsWebGoalIndex } from "../src/goal-index-runtime.ts";
import { extractHealthCommonsGoalSources } from "../src/goal-sources.ts";
import type { HealthCommonsContentSet, HealthCommonsSourcePage } from "../src/load.ts";
import {
  loadGeneratedHealthCommonsWebGoalPage,
} from "../src/goal-runtime.ts";
import {
  buildHealthCommonsWebGeneratedArtifacts,
  HEALTH_COMMONS_WEB_GOAL_INDEX_SCHEMA_VERSION,
  HEALTH_COMMONS_WEB_GOAL_PAGE_SCHEMA_VERSION,
  type HealthCommonsWebGoalIndex,
  type HealthCommonsWebGoalPage,
} from "../src/web-artifacts.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function sourcePage(): HealthCommonsSourcePage {
  return {
    body: "A reviewed public guideline source.",
    frontmatter: {
      schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
      entityType: "source_artifact",
      key: "source_artifact:resting-heart-rate-guidance",
      slug: "sources/resting-heart-rate-guidance",
      title: "Resting Heart Rate Guidance",
      source: {
        kind: "guideline",
        title: "Resting Heart Rate Guidance",
        url: "https://example.com/resting-heart-rate-guidance",
        year: 2026,
      },
    },
    rawFrontmatter: null,
    relativePath: "sources/resting-heart-rate-guidance.md",
  };
}

function goalPage(overrides: {
  aliases?: string[];
  body?: string;
  goalPhrase?: string;
  indexable?: boolean;
  key?: string;
  parentGoalKey?: string;
  slug?: string;
  startPrompt?: string;
  title?: string;
} = {}): HealthCommonsSourcePage {
  const goalPhrase = overrides.goalPhrase ?? "lower my resting heart rate";
  const key = overrides.key ?? "goal_template:lower-resting-heart-rate";
  const slug = overrides.slug ?? "lower-resting-heart-rate";
  const frontmatter = {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "goal_template",
    key,
    slug,
    title: overrides.title ?? "Lower My Resting Heart Rate",
    summary: "Build the habits and aerobic fitness that can support a lower resting-heart-rate trend.",
    status: "field-testing",
    quality: "usable",
    aliases: overrides.aliases ?? ["Lower RHR"],
    goal: {
      category: "cardio",
      ...(overrides.parentGoalKey ? { parentGoalKey: overrides.parentGoalKey } : {}),
      outcomeKind: "biomarker",
      goalPhrase,
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
      startPrompt: overrides.startPrompt ?? `Hey Murph, help me ${goalPhrase}.`,
      indexable: overrides.indexable ?? true,
    },
    safety: {
      cautionLevel: "low",
      stopIf: ["Stop and seek care for chest pain, fainting, or severe shortness of breath."],
    },
  } satisfies HealthCommonsPageFrontmatter;

  return {
    body: overrides.body ?? validGoalBody(),
    frontmatter,
    rawFrontmatter: null,
    relativePath: `goals/cardio/${slug}.md`,
  };
}

function validGoalBody(): string {
  const practicalContext = [
    "Use a personal baseline and make one sustainable change at a time. Keep the plan simple enough to repeat during busy weeks, and progress only when the current dose feels manageable.",
    "Compare trends under similar conditions instead of reacting to a single reading. Illness, heat, travel, hydration, medicines, stress, and device changes can all move the result without representing a durable change in fitness.",
    "Recovery is part of the work: protect sleep, eat enough to support training, and leave room for easier days. The useful outcome is better health and day-to-day function, not forcing one number lower at any cost.",
  ].join(" ");

  return [
    "# How to Lower Your Resting Heart Rate",
    "",
    "Resting heart rate usually changes gradually. Regular aerobic exercise, adequate recovery, and sleep are useful places to start.",
    "",
    "## What to do",
    "",
    practicalContext,
    "",
    "## A simple plan",
    "",
    practicalContext,
    "",
    "## How to know it is working",
    "",
    practicalContext,
    "",
    "## If you get stuck",
    "",
    practicalContext,
    "",
    "## A quick note",
    "",
    `${practicalContext} Talk with a clinician about a persistent unexplained change, troublesome symptoms, or limits that make ordinary exercise unsafe.`,
    "",
    "## Sources",
    "",
    "- [Resting heart rate guidance](https://example.com/resting-heart-rate-guidance)",
    "- [Aerobic activity review](https://example.org/aerobic-activity-review)",
  ].join("\n");
}

function content(goal = goalPage()): HealthCommonsContentSet {
  return {
    artifactManifests: [],
    changes: [],
    evidenceAppraisals: [],
    pages: [goal, sourcePage()],
    redirects: [],
  };
}

describe("Health Commons goal artifacts", () => {
  it("builds a compact browse index and one independently useful scoped page", () => {
    const catalog = buildHealthCommonsCatalogFromContent(content());
    const artifacts = buildHealthCommonsWebGeneratedArtifacts(catalog);

    expect(artifacts.goalIndex).toMatchObject({
      schemaVersion: HEALTH_COMMONS_WEB_GOAL_INDEX_SCHEMA_VERSION,
      goals: [
        {
          category: "cardio",
          pagePath: "pages/goals/lower-resting-heart-rate.json",
          routeId: "lower-resting-heart-rate",
          sources: [
            {
              label: "Resting heart rate guidance",
              url: "https://example.com/resting-heart-rate-guidance",
            },
            {
              label: "Aerobic activity review",
              url: "https://example.org/aerobic-activity-review",
            },
          ],
          startPrompt: "Hey Murph, help me lower my resting heart rate.",
        },
      ],
    });

    expect(artifacts.projectionArtifacts.get("pages/goals/lower-resting-heart-rate.json"))
      .toMatchObject({
        schemaVersion: HEALTH_COMMONS_WEB_GOAL_PAGE_SCHEMA_VERSION,
        aliases: ["Lower RHR"],
        body: expect.stringContaining("## What to do"),
        goal: {
          category: "cardio",
        },
        sources: [
          {
            label: "Resting heart rate guidance",
            url: "https://example.com/resting-heart-rate-guidance",
          },
          {
            label: "Aerobic activity review",
            url: "https://example.org/aerobic-activity-review",
          },
        ],
      });
    expect(artifacts.goalIndex.goals[0]).not.toHaveProperty("evidenceSourceKeys");
    expect(artifacts.projectionArtifacts.get("pages/goals/lower-resting-heart-rate.json"))
      .not.toHaveProperty("goal.evidenceSourceKeys");
    expect(artifacts.projectionArtifacts.get("pages/goals/lower-resting-heart-rate.json"))
      .not.toHaveProperty("sourceSnippets");
    expect(artifacts.routeIndex.routes).toContainEqual(expect.objectContaining({
      entityType: "goal_template",
      projections: {
        "goal.page": "pages/goals/lower-resting-heart-rate.json",
      },
      routeId: "lower-resting-heart-rate",
    }));
  });

  it("keeps narrative and workflow revisions separate", () => {
    const first = buildHealthCommonsCatalogFromContent(content());
    const narrativeEdit = buildHealthCommonsCatalogFromContent(content(goalPage({
      body: `${goalPage().body}\n\nA clearer closing paragraph for the reader.`,
    })));
    const workflowEdit = buildHealthCommonsCatalogFromContent(content(goalPage({
      goalPhrase: "improve my resting heart rate",
    })));

    expect(narrativeEdit.entities[0]?.revision.pageRevisionId)
      .not.toBe(first.entities[0]?.revision.pageRevisionId);
    expect(narrativeEdit.entities[0]?.revision.workflowSpecRevisionId)
      .toBe(first.entities[0]?.revision.workflowSpecRevisionId);
    expect(workflowEdit.entities[0]?.revision.workflowSpecRevisionId)
      .not.toBe(first.entities[0]?.revision.workflowSpecRevisionId);
  });

  it("loads generated goal artifacts by the static route id", async () => {
    const catalog = buildHealthCommonsCatalogFromContent({
      ...content(),
      redirects: [
        {
          from: "goal_template:lower-rhr",
          to: "goal_template:lower-resting-heart-rate",
        },
      ],
    });
    const artifacts = buildHealthCommonsWebGeneratedArtifacts(catalog);
    const generatedWebRoot = await mkdtemp(path.join(os.tmpdir(), "murph-health-commons-goal-"));
    temporaryRoots.push(generatedWebRoot);

    await Promise.all([
      writeJson(generatedWebRoot, "routes/index.json", artifacts.routeIndex),
      writeJson(generatedWebRoot, "browse/goals.json", artifacts.goalIndex),
      ...[...artifacts.projectionArtifacts.entries()].map(([relativePath, artifact]) =>
        writeJson(generatedWebRoot, relativePath, artifact)
      ),
    ]);

    expect(loadGeneratedHealthCommonsWebGoalIndex({ generatedWebRoot }).goals).toHaveLength(1);
    expect(loadGeneratedHealthCommonsWebGoalPage({
      generatedWebRoot,
      routeId: "lower-resting-heart-rate",
    })).toMatchObject({
      key: "goal_template:lower-resting-heart-rate",
      revision: {
        workflowSpecRevisionId: expect.stringMatching(/^sha256:/u),
      },
    });
    expect(loadGeneratedHealthCommonsWebGoalPage({
      generatedWebRoot,
      routeId: "lower-rhr",
    })).toMatchObject({
      key: "goal_template:lower-resting-heart-rate",
      route: {
        routeId: "lower-resting-heart-rate",
      },
    });
    expect(loadGeneratedHealthCommonsWebGoalPage({
      generatedWebRoot,
      routeId: "not-a-goal",
    })).toBeNull();
  });

  it("requires an independently useful body for an indexable goal", () => {
    expect(() => buildHealthCommonsCatalogFromContent(content(goalPage({
      body: "A short goal article.",
    })))).toThrow("at least 1,800 characters");

    expect(() => buildHealthCommonsCatalogFromContent(content(goalPage({
      body: validGoalBody().replace("## A quick note", "## Another note"),
    })))).toThrow("missing required goal article headings: ## A quick note");

    expect(() => buildHealthCommonsCatalogFromContent(content(goalPage({
      body: validGoalBody().replace(
        "\n- [Aerobic activity review](https://example.org/aerobic-activity-review)",
        "",
      ),
    })))).toThrow("at least two visible Markdown source links under ## Sources");

    const oneDirectSourceThenFurtherReading = validGoalBody()
      .replace(
        "\n- [Aerobic activity review](https://example.org/aerobic-activity-review)",
        "\n\n## Further reading\n\n- [Not a direct source](https://example.net/further-reading)",
      );
    expect(() => buildHealthCommonsCatalogFromContent(content(goalPage({
      body: oneDirectSourceThenFurtherReading,
    })))).toThrow("at least two visible Markdown source links under ## Sources");
  });

  it("keeps balanced parentheses in direct source URLs", () => {
    const parenthesizedUrl =
      "https://example.org/article/S1933-2874(24)00240-9/fulltext";
    const body = validGoalBody().replace(
      "https://example.org/aerobic-activity-review",
      parenthesizedUrl,
    );

    expect(extractHealthCommonsGoalSources(body)).toContainEqual({
      label: "Aerobic activity review",
      url: parenthesizedUrl,
    });
  });

  it("ignores source links inside HTML comments and fenced code", () => {
    const hiddenLinks = [
      "~~~markdown",
      "<!-- This is code, not a comment delimiter.",
      "- [Hidden fenced source](https://example.net/hidden-fenced-source)",
      "~~~",
      "<!--",
      "- [Hidden commented source](https://example.net/hidden-commented-source)",
      "-->",
    ].join("\n");
    const body = [validGoalBody(), "", hiddenLinks].join("\n");
    const catalog = buildHealthCommonsCatalogFromContent(content(goalPage({ body })));
    const artifacts = buildHealthCommonsWebGeneratedArtifacts(catalog);

    expect(extractHealthCommonsGoalSources(body)).toEqual([
      {
        label: "Resting heart rate guidance",
        url: "https://example.com/resting-heart-rate-guidance",
      },
      {
        label: "Aerobic activity review",
        url: "https://example.org/aerobic-activity-review",
      },
    ]);
    expect(artifacts.goalIndex.goals[0]?.sources).toEqual(
      extractHealthCommonsGoalSources(validGoalBody()),
    );

    const onlyHiddenSecondSources = body.replace(
      "\n- [Aerobic activity review](https://example.org/aerobic-activity-review)",
      "",
    );
    expect(() => buildHealthCommonsCatalogFromContent(
      content(goalPage({ body: onlyHiddenSecondSources })),
    )).toThrow("at least two visible Markdown source links under ## Sources");
  });

  it.each([
    "https://[invalid.example/source",
    "https://user:password@example.org/source",
    "https://0.0.0.1/source",
    "https://10.0.0.1/source",
    "https://100.64.0.1/source",
    "https://127.0.0.1/source",
    "https://169.254.0.1/source",
    "https://172.16.0.1/source",
    "https://192.0.2.1/source",
    "https://192.168.0.1/source",
    "https://198.18.0.1/source",
    "https://198.51.100.1/source",
    "https://203.0.113.1/source",
    "https://224.0.0.1/source",
    "https://example.org/source?token=placeholder",
    "https://example.org/source?api_key=placeholder",
    "http://example.org/source",
  ])("rejects an unsafe direct source URL during authoring", (unsafeUrl) => {
    const body = validGoalBody().replace(
      "https://example.org/aerobic-activity-review",
      unsafeUrl,
    );

    expect(() => buildHealthCommonsCatalogFromContent(content(goalPage({ body })))).toThrow(
      "Goal source URL must be a valid public HTTPS URL without credentials or sensitive query parameters.",
    );
  });

  it.each([
    "https://[invalid.example/source",
    "https://user:password@example.org/source",
    "https://0.0.0.1/source",
    "https://10.0.0.1/source",
    "https://100.64.0.1/source",
    "https://127.0.0.1/source",
    "https://169.254.0.1/source",
    "https://172.16.0.1/source",
    "https://192.0.2.1/source",
    "https://192.168.0.1/source",
    "https://198.18.0.1/source",
    "https://198.51.100.1/source",
    "https://203.0.113.1/source",
    "https://224.0.0.1/source",
    "https://example.org/source?token=placeholder",
    "https://example.org/source?api_key=placeholder",
    "http://example.org/source",
  ])("rejects an unsafe direct source URL in a generated goal page", async (unsafeUrl) => {
    const catalog = buildHealthCommonsCatalogFromContent(content());
    const artifacts = buildHealthCommonsWebGeneratedArtifacts(catalog);
    const generatedWebRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-goal-source-"),
    );
    temporaryRoots.push(generatedWebRoot);
    const pageArtifact = artifacts.projectionArtifacts.get(
      "pages/goals/lower-resting-heart-rate.json",
    ) as HealthCommonsWebGoalPage;
    const unsafePageArtifact: HealthCommonsWebGoalPage = {
      ...pageArtifact,
      sources: pageArtifact.sources.map((source, index) => (
        index === 0 ? { ...source, url: unsafeUrl } : source
      )),
    };

    await Promise.all([
      writeJson(generatedWebRoot, "routes/index.json", artifacts.routeIndex),
      writeJson(
        generatedWebRoot,
        "pages/goals/lower-resting-heart-rate.json",
        unsafePageArtifact,
      ),
    ]);

    expect(() => loadGeneratedHealthCommonsWebGoalPage({
      generatedWebRoot,
      routeId: "lower-resting-heart-rate",
    })).toThrow("Health Commons generated web goal page is invalid");
  });

  it("rejects a credential-bearing source URL in the compact generated index", async () => {
    const catalog = buildHealthCommonsCatalogFromContent(content());
    const artifacts = buildHealthCommonsWebGeneratedArtifacts(catalog);
    const generatedWebRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-goal-index-source-"),
    );
    temporaryRoots.push(generatedWebRoot);
    const unsafeGoalIndex: HealthCommonsWebGoalIndex = {
      ...artifacts.goalIndex,
      goals: artifacts.goalIndex.goals.map((goal, goalIndex) => ({
        ...goal,
        sources: goal.sources.map((source, sourceIndex) => (
          goalIndex === 0 && sourceIndex === 0
            ? { ...source, url: "https://user:password@example.org/source" }
            : source
        )),
      })),
    };

    await writeJson(generatedWebRoot, "browse/goals.json", unsafeGoalIndex);

    expect(() => loadGeneratedHealthCommonsWebGoalIndex({
      generatedWebRoot,
    })).toThrow("Health Commons generated goal index is invalid");
  });

  it("validates compact goal entries with the canonical goal schemas", async () => {
    const artifacts = buildHealthCommonsWebGeneratedArtifacts(
      buildHealthCommonsCatalogFromContent(content()),
    );
    const generatedWebRoot = await mkdtemp(
      path.join(os.tmpdir(), "murph-health-commons-goal-index-schema-"),
    );
    temporaryRoots.push(generatedWebRoot);
    const goal = artifacts.goalIndex.goals[0];
    if (!goal) {
      throw new Error("Expected the goal fixture to generate one compact index entry.");
    }

    const invalidGoalIndexes = [
      {
        ...artifacts.goalIndex,
        goals: [{ ...goal, outcomeKind: "tracker_score" }],
      },
      {
        ...artifacts.goalIndex,
        goals: [{ ...goal, startPrompt: "Help with this goal." }],
      },
      {
        ...artifacts.goalIndex,
        goals: [{
          ...goal,
          revision: { ...goal.revision, pageRevisionId: "sha256:" },
        }],
      },
      {
        ...artifacts.goalIndex,
        goals: [{ ...goal, pagePath: "pages/goals/a-different-goal.json" }],
      },
    ];

    for (const invalidGoalIndex of invalidGoalIndexes) {
      await writeJson(generatedWebRoot, "browse/goals.json", invalidGoalIndex);
      expect(() => loadGeneratedHealthCommonsWebGoalIndex({ generatedWebRoot }))
        .toThrow("Health Commons generated goal index is invalid");
    }
  });

  it("rejects parentGoalKey cycles", () => {
    const first = goalPage({
      aliases: ["First cardio goal"],
      parentGoalKey: "goal_template:improve-aerobic-fitness",
    });
    const second = goalPage({
      aliases: ["Second cardio goal"],
      goalPhrase: "improve my aerobic fitness",
      key: "goal_template:improve-aerobic-fitness",
      parentGoalKey: "goal_template:lower-resting-heart-rate",
      slug: "improve-aerobic-fitness",
      title: "Improve My Aerobic Fitness",
    });

    expect(() => buildHealthCommonsCatalogFromContent({
      ...content(first),
      pages: [first, second, sourcePage()],
    })).toThrow(
      "Goal parentGoalKey cycle detected: goal_template:improve-aerobic-fitness -> goal_template:lower-resting-heart-rate -> goal_template:improve-aerobic-fitness.",
    );
  });

  it("resolves internal goal links through canonical routes or declared redirects", () => {
    const linkedBody = `${validGoalBody()}\n\n## Related goals\n\n[Improve My Aerobic Fitness](/goals/improve-aerobic-fitness) · [Old Aerobic Fitness Link](/goals/aerobic-fitness)`;
    const first = goalPage({ body: linkedBody });
    const second = goalPage({
      aliases: ["Aerobic fitness goal"],
      goalPhrase: "improve my aerobic fitness",
      key: "goal_template:improve-aerobic-fitness",
      slug: "improve-aerobic-fitness",
      title: "Improve My Aerobic Fitness",
    });

    expect(() => buildHealthCommonsCatalogFromContent({
      ...content(first),
      pages: [first, second, sourcePage()],
      redirects: [
        {
          from: "goal_template:aerobic-fitness",
          to: "goal_template:improve-aerobic-fitness",
        },
      ],
    })).not.toThrow();

    expect(() => buildHealthCommonsCatalogFromContent(content(goalPage({
      body: `${validGoalBody()}\n\n## Related goals\n\n[Missing Goal](/goals/not-a-real-goal)`,
    })))).toThrow(
      "goal_template:lower-resting-heart-rate links to missing public goal route /goals/not-a-real-goal.",
    );
  });
});

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  const outputPath = path.join(root, relativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value)}\n`, "utf8");
}
