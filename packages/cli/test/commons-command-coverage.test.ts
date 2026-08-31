import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cli } from "incur";
import { localParallelCliTest as test } from "./local-parallel-test.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import { registerCommonsCommands } from "../src/commands/commons.js";
import {
  type InProcessCliJsonResult,
  requireData,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

function createCommonsSliceCli() {
  const cli = Cli.create("vault-cli", {
    description: "commons coverage cli",
    version: "0.0.0-test",
  });

  cli.use(incurErrorBridge);
  registerCommonsCommands(cli);

  return cli;
}

const protocolArtifactFailureScenarios = [
  {
    args: ["commons", "protocol", "list", "--query", "private-list-lookup"],
    artifact: "protocol-index.json",
    lookup: "private-list-lookup",
    stage: "protocol_index",
  },
  {
    args: ["commons", "protocol", "show", "private-show-lookup"],
    artifact: "protocol-run-specs.json",
    lookup: "private-show-lookup",
    stage: "protocol_run_specs",
  },
  {
    args: ["commons", "protocol", "explore", "private-explore-lookup"],
    artifact: "protocol-family-graph.json",
    lookup: "private-explore-lookup",
    stage: "protocol_family_graph",
  },
] as const;

const protocolArtifactFailureHint =
  "Stop protocol discovery, onboarding, planning, and starting a protocol until the packaged artifacts are restored or regenerated; then rerun the command. No protocol-backed run was created.";

function assertProtocolArtifactFailure(
  result: InProcessCliJsonResult,
  input: {
    code: "commons_protocol_artifact_invalid" | "commons_protocol_artifact_unavailable";
    privateValues: readonly string[];
    stage: string;
  },
): void {
  assert.equal(result.exitCode, 1, input.stage);
  assert.equal(result.envelope.ok, false, input.stage);
  if (result.envelope.ok) {
    throw new Error(`Expected ${input.stage} artifact failure.`);
  }
  assert.equal(result.envelope.error.code, input.code);
  assert.equal(result.envelope.error.retryable, false);
  assert.equal(result.envelope.error.stage, input.stage);
  assert.equal(result.envelope.error.hint, protocolArtifactFailureHint);
  assert.equal("data" in result.envelope, false);
  const serialized = JSON.stringify(result.envelope);
  assert.doesNotMatch(serialized, /"(?:protocols|protocol|groups|starterCandidate)"\s*:/u);
  for (const value of input.privateValues) {
    assert.doesNotMatch(
      serialized,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  }
}

test("deleted generic Commons commands are no longer registered", async () => {
  const cli = createCommonsSliceCli();

  for (const command of [
    ["commons", "search", "sauna"],
    ["commons", "get", "finnish-sauna"],
    ["commons", "source", "list", "--protocol", "finnish-sauna"],
  ] as const) {
    const result = await runInProcessJsonCli(cli, [...command]);

    assert.equal(result.exitCode, 1, command.join(" "));
    assert.equal(result.envelope.ok, false, command.join(" "));
  }
});

test("commons knowledge search returns a bounded source-backed sauna packet", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    available: boolean;
    candidates: Array<{ key: string; title: string }>;
    items: Array<{
      entityKey: string;
      sources: Array<{ pmid: string | null; url: string | null }>;
    }>;
    safety: { kind: string } | null;
    topic: { key: string; title: string } | null;
  }>(cli, [
    "commons",
    "knowledge",
    "search",
    "What does the evidence say about Finnish dry sauna?",
    "--limit",
    "3",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.available, true);
  assert.equal(data.topic?.title, "Finnish Dry Sauna");
  assert.deepEqual(data.candidates, []);
  assert.ok(data.items.length > 0 && data.items.length <= 3);
  assert.ok(data.items.some((item) =>
    item.sources.some((source) => source.pmid === "29849692")
  ));
});

test("commons knowledge search returns a safety-only sauna hard stop", async () => {
  const result = await runInProcessJsonCli<{
    available: boolean;
    items: unknown[];
    safety: {
      sources: Array<{ pmid: string | null; title: string }>;
      text: string;
    } | null;
  }>(createCommonsSliceCli(), [
    "commons",
    "knowledge",
    "search",
    "Is Finnish dry sauna safe while wearing a fentanyl patch?",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.available, true);
  assert.deepEqual(data.items, []);
  assert.match(data.safety?.text ?? "", /opioid|fentanyl|life-threatening/iu);
  assert.ok(data.safety?.sources.some((source) =>
    source.pmid === "32740103" || /opioid patch|fentanyl patch/iu.test(source.title)
  ));
});

test("commons knowledge search returns evidence and safety from one compound question", async () => {
  const result = await runInProcessJsonCli<{
    available: boolean;
    items: Array<{ text: string }>;
    safety: { text: string } | null;
    topic: { title: string } | null;
  }>(createCommonsSliceCli(), [
    "commons",
    "knowledge",
    "search",
    "Does Finnish dry sauna improve immunity, and is it safe after I fainted recently?",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.available, true);
  assert.equal(data.topic?.title, "Finnish Dry Sauna");
  assert.ok(data.items.some((item) => /immun/iu.test(item.text)));
  assert.match(data.safety?.text ?? "", /faint|cardiovascular/iu);
});

test("commons knowledge search rejects a result limit larger than three items", async () => {
  const result = await runInProcessJsonCli(createCommonsSliceCli(), [
    "commons",
    "knowledge",
    "search",
    "What does the evidence say about Finnish dry sauna?",
    "--limit",
    "4",
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.envelope.ok, false);
});

test("commons knowledge search requires one complete question", async () => {
  for (const query of ["x", "--"] as const) {
    const result = await runInProcessJsonCli(createCommonsSliceCli(), [
      "commons",
      "knowledge",
      "search",
      query,
    ]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.envelope.ok, false);
  }
});

test("commons knowledge search stays non-blocking when its generated index is missing", async () => {
  const previousRoot = process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
  process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = path.join(
    tmpdir(),
    `missing-health-commons-${process.pid}`,
  );
  try {
    const result = await runInProcessJsonCli<{
      available: boolean;
      candidates: unknown[];
      items: unknown[];
      topic: unknown;
      warning: string | null;
    }>(createCommonsSliceCli(), [
      "commons",
      "knowledge",
      "search",
      "Is Finnish dry sauna safe after recent fainting?",
    ]);

    assert.equal(result.envelope.ok, true);
    const data = requireData(result.envelope);
    assert.equal(data.available, false);
    assert.deepEqual(data.candidates, []);
    assert.deepEqual(data.items, []);
    assert.equal(data.topic, null);
    assert.match(data.warning ?? "", /continue without corpus context/u);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
    } else {
      process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = previousRoot;
    }
  }
});

test("commons protocol commands fail closed when their artifacts are unavailable", async () => {
  const previousRoot = process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
  const missingRoot = path.join(tmpdir(), `missing-health-commons-protocol-${process.pid}`);
  process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = missingRoot;
  try {
    for (const scenario of protocolArtifactFailureScenarios) {
      const result = await runInProcessJsonCli(createCommonsSliceCli(), [...scenario.args]);
      assertProtocolArtifactFailure(result, {
        code: "commons_protocol_artifact_unavailable",
        privateValues: [scenario.lookup, missingRoot],
        stage: scenario.stage,
      });
    }
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
    } else {
      process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = previousRoot;
    }
  }
});

test("commons protocol commands fail closed when their artifacts are invalid", async () => {
  const previousRoot = process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
  try {
    for (const scenario of protocolArtifactFailureScenarios) {
      const packageRoot = await mkdtemp(path.join(tmpdir(), "invalid-health-commons-protocol-"));
      const privateArtifactValue = `private-artifact-${scenario.stage}`;
      try {
        await mkdir(path.join(packageRoot, "generated"), { recursive: true });
        await writeFile(
          path.join(packageRoot, "generated", scenario.artifact),
          `${privateArtifactValue} {not-json}`,
          "utf8",
        );
        process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = packageRoot;

        const result = await runInProcessJsonCli(createCommonsSliceCli(), [...scenario.args]);
        assertProtocolArtifactFailure(result, {
          code: "commons_protocol_artifact_invalid",
          privateValues: [scenario.lookup, privateArtifactValue, packageRoot],
          stage: scenario.stage,
        });
      } finally {
        await rm(packageRoot, { force: true, recursive: true });
      }
    }
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
    } else {
      process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = previousRoot;
    }
  }
});

test("commons goal commands fail closed when their compact index is unavailable", async () => {
  const previousRoot = process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
  const missingRoot = path.join(tmpdir(), `missing-health-commons-goals-${process.pid}`);
  process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = missingRoot;
  try {
    for (const args of [
      ["commons", "goal", "list"],
      ["commons", "goal", "show", "private-goal-lookup"],
    ] as const) {
      const result = await runInProcessJsonCli(createCommonsSliceCli(), [...args]);

      assert.equal(result.exitCode, 1);
      assert.equal(result.envelope.ok, false);
      if (result.envelope.ok) {
        throw new Error("Expected compact goal index failure.");
      }
      assert.equal(result.envelope.error.code, "commons_goal_artifact_unavailable");
      assert.equal("data" in result.envelope, false);
      assert.doesNotMatch(JSON.stringify(result.envelope), /private-goal-lookup/u);
      assert.doesNotMatch(JSON.stringify(result.envelope), new RegExp(missingRoot, "u"));
    }
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
    } else {
      process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = previousRoot;
    }
  }
});

test("commons goal list and show expose an outcome guide with exact lineage", async () => {
  const cli = createCommonsSliceCli();
  const listResult = await runInProcessJsonCli<{
    goals: Array<{
      category: string;
      evidenceSourceKeys: string[];
      key: string;
      revision: {
        pageRevisionId: string;
        workflowSpecRevisionId: string;
      };
      startPrompt: string;
    }>;
    total: number;
  }>(cli, [
    "commons",
    "goal",
    "list",
    "--query",
    "deep sleep",
    "--category",
    "sleep",
    "--limit",
    "5",
  ]);

  assert.equal(listResult.envelope.ok, true);
  const list = requireData(listResult.envelope);
  assert.ok(list.total > 0);
  const summary = list.goals.find((goal) =>
    goal.key === "goal_template:improve-deep-sleep"
  );
  assert.equal(summary?.category, "sleep");
  assert.match(summary?.revision.pageRevisionId ?? "", /^sha256:/u);
  assert.match(summary?.revision.workflowSpecRevisionId ?? "", /^sha256:/u);
  assert.equal(summary?.startPrompt, "Hey Murph, help me improve my deep sleep.");

  const showResult = await runInProcessJsonCli<{
    goal: {
      evidenceSourceKeys: string[];
      indexable: true;
      key: string;
      revision: {
        pageRevisionId: string;
        workflowSpecRevisionId: string;
      };
      safetyTier: string;
    };
  }>(cli, ["commons", "goal", "show", "improve-deep-sleep"]);

  assert.equal(showResult.envelope.ok, true);
  const shown = requireData(showResult.envelope).goal;
  assert.equal(shown.key, "goal_template:improve-deep-sleep");
  assert.equal(shown.indexable, true);
  assert.ok(shown.evidenceSourceKeys.length > 0);
  assert.ok(shown.safetyTier.length > 0);
  assert.deepEqual(shown.revision, summary?.revision);
  assert.equal(Object.hasOwn(shown, "body"), false);
  assert.equal(Object.hasOwn(shown, "sourceSnippets"), false);
});

test("commons goal search normalizes understandable goal phrases without fuzzy show matches", async () => {
  const cli = createCommonsSliceCli();
  const cases = [
    ["run an iron man", "goal_template:run-ironman"],
    ["lower RHR", "goal_template:lower-resting-heart-rate"],
    ["improve deep sleep", "goal_template:improve-deep-sleep"],
    ["improve my VO2 max", "goal_template:improve-vo2-max"],
  ] as const;

  for (const [query, expectedKey] of cases) {
    const listResult = await runInProcessJsonCli<{
      goals: Array<{ key: string }>;
      total: number;
    }>(cli, ["commons", "goal", "list", "--query", query, "--limit", "20"]);

    assert.equal(listResult.envelope.ok, true, query);
    const list = requireData(listResult.envelope);
    assert.ok(list.total > 0, query);
    assert.ok(list.goals.some((goal) => goal.key === expectedKey), query);

    const showResult = await runInProcessJsonCli<{
      goal: { key: string };
    }>(cli, ["commons", "goal", "show", query]);

    assert.equal(showResult.envelope.ok, true, query);
    assert.equal(requireData(showResult.envelope).goal.key, expectedKey, query);
  }

  const normalizedSurfaceCases = [
    ["RUN an Iron—Man?!", "goal_template:run-ironman"],
    ["lower R.H.R.!!!", "goal_template:lower-resting-heart-rate"],
    ["impróve—deep   sleep?!", "goal_template:improve-deep-sleep"],
    ["Improve My V.O.₂ Max.", "goal_template:improve-vo2-max"],
    ["get more deep-sleep!", "goal_template:improve-deep-sleep"],
    [
      "Hey Murph—help me improve my deep sleep!",
      "goal_template:improve-deep-sleep",
    ],
  ] as const;

  for (const [lookup, expectedKey] of normalizedSurfaceCases) {
    const listResult = await runInProcessJsonCli<{
      goals: Array<{ key: string }>;
    }>(cli, ["commons", "goal", "list", "--query", lookup, "--limit", "20"]);

    assert.equal(listResult.envelope.ok, true, lookup);
    assert.ok(
      requireData(listResult.envelope).goals.some((goal) => goal.key === expectedKey),
      lookup,
    );

    const showResult = await runInProcessJsonCli<{
      goal: { key: string };
    }>(cli, ["commons", "goal", "show", lookup]);

    assert.equal(showResult.envelope.ok, true, lookup);
    assert.equal(requireData(showResult.envelope).goal.key, expectedKey, lookup);
  }

  const partialShow = await runInProcessJsonCli(cli, [
    "commons",
    "goal",
    "show",
    "deep sleep",
  ]);
  assert.equal(partialShow.exitCode, 1);
  assert.equal(partialShow.envelope.ok, false);
  if (!partialShow.envelope.ok) {
    assert.equal(partialShow.envelope.error.code, "commons_goal_not_found");
  }

  const punctuationOnlyList = await runInProcessJsonCli<{
    goals: unknown[];
    total: number;
  }>(cli, ["commons", "goal", "list", "--query", "!!!"]);
  assert.equal(punctuationOnlyList.envelope.ok, true);
  assert.equal(requireData(punctuationOnlyList.envelope).total, 0);
  assert.deepEqual(requireData(punctuationOnlyList.envelope).goals, []);
});

test("commons protocol list and show expose protocol revisions distinctly from private protocol commands", async () => {
  const cli = createCommonsSliceCli();

  const listResult = await runInProcessJsonCli<{
    protocols: Array<{
      entityType: string;
      key: string;
      revision: {
        runSpecRevisionId: string | null;
      };
    }>;
    total: number;
  }>(cli, [
    "commons",
    "protocol",
    "list",
    "--query",
    "norwegian",
    "--limit",
    "10",
  ]);

  assert.equal(listResult.envelope.ok, true);
  const listData = requireData(listResult.envelope);
  assert.ok(listData.total > 0);
  assert.ok(listData.protocols.every((protocol) => protocol.entityType === "protocol_variant"));
  assert.ok(
    listData.protocols.some(
      (protocol) => protocol.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    ),
  );
  const bodyQueryResult = await runInProcessJsonCli<{
    protocols: Array<{
      key: string;
    }>;
  }>(cli, [
    "commons",
    "protocol",
    "list",
    "--query",
    "RPE",
    "--limit",
    "10",
  ]);
  assert.equal(bodyQueryResult.envelope.ok, true);
  assert.ok(
    requireData(bodyQueryResult.envelope).protocols.some(
      (protocol) => protocol.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    ),
  );

  const showResult = await runInProcessJsonCli<{
    lookup: string;
    protocol: {
      aliases?: unknown;
      attribution?: unknown;
      body?: unknown;
      entityType: string;
      experimentOnboarding: {
        adaptationPolicy?: unknown;
        assistantPolicy?: unknown;
        contextReview?: unknown;
        logging?: unknown;
        planDefaults?: unknown;
        safetyScreen?: unknown;
        setupSlots?: unknown;
        startIntent?: unknown;
        supportHints?: unknown;
        trackingHints?: unknown;
      } | null;
      key: string;
      lineage?: unknown;
      measurementPlan?: unknown;
      protocol: unknown | null;
      revision: {
        pageRevisionId: string;
        runSpecRevisionId: string | null;
      };
      safety: unknown | null;
      testPlans: unknown[];
    };
  }>(cli, [
    "commons",
    "protocol",
    "show",
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  ]);

  assert.equal(showResult.envelope.ok, true);
  const showData = requireData(showResult.envelope);
  assert.equal(showData.lookup, "protocol_variant:norwegian-4x4/norwegian-4x4");
  assert.equal(showData.protocol.key, "protocol_variant:norwegian-4x4/norwegian-4x4");
  assert.equal(showData.protocol.entityType, "protocol_variant");
  assert.match(showData.protocol.revision.pageRevisionId, /^sha256:/u);
  assert.match(showData.protocol.revision.runSpecRevisionId ?? "", /^sha256:/u);
  assert.ok(
    showData.protocol.experimentOnboarding &&
      typeof showData.protocol.experimentOnboarding === "object",
  );
  assert.equal("assistantPolicy" in showData.protocol.experimentOnboarding, false);
  assert.equal("contextReview" in showData.protocol.experimentOnboarding, false);
  assert.equal("logging" in showData.protocol.experimentOnboarding, false);
  assert.ok(showData.protocol.experimentOnboarding.startIntent);
  assert.ok(showData.protocol.experimentOnboarding.setupSlots);
  assert.ok(showData.protocol.experimentOnboarding.safetyScreen);
  assert.ok(showData.protocol.experimentOnboarding.supportHints);
  assert.ok(showData.protocol.experimentOnboarding.trackingHints);
  assert.ok(showData.protocol.protocol && typeof showData.protocol.protocol === "object");
  const shownProtocolSpec = showData.protocol.protocol as { sessionFieldIds?: unknown };
  assert.ok(Array.isArray(shownProtocolSpec.sessionFieldIds));
  assert.ok(shownProtocolSpec.sessionFieldIds.length > 0);
  assert.ok(showData.protocol.safety && typeof showData.protocol.safety === "object");
  assert.ok(showData.protocol.testPlans.length > 0);
  const saunaShowResult = await runInProcessJsonCli<{
    protocol: {
      experimentOnboarding: {
        adaptationPolicy?: unknown;
      } | null;
      key: string;
    };
  }>(cli, [
    "commons",
    "protocol",
    "show",
    "protocol_variant:sauna/finnish-dry/murph-standard-3x-week",
  ]);
  assert.equal(saunaShowResult.envelope.ok, true);
  const saunaShowData = requireData(saunaShowResult.envelope);
  assert.equal(
    saunaShowData.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  assert.ok(saunaShowData.protocol.experimentOnboarding?.adaptationPolicy);
  for (const omittedField of [
    "aliases",
    "attribution",
    "body",
    "lineage",
    "measurementPlan",
  ] as const) {
    assert.equal(omittedField in showData.protocol, false);
  }
});

test("commons protocol explore expands sauna matches into family variants and a starter candidate", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      query: string | null;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
      parentFamilies: Array<{
        key: string;
      }>;
      relatedProtocolVariants: Array<{
        protocol: {
          key: string;
          revision: {
            pageRevisionId: string;
            runSpecRevisionId: string | null;
          };
        };
        traits: {
          externalProtocol: boolean;
          murphCanonical: boolean;
          sourceAttributed: boolean;
        };
      }>;
      starterCandidate: {
        protocol: {
          key: string;
        };
      } | null;
      traits: {
        externalProtocol: boolean;
        highCaution: boolean;
        murphCanonical: boolean;
        sourceAttributed: boolean;
      };
    }>;
    starterCandidate: {
      protocol: {
        key: string;
        revision: {
          pageRevisionId: string;
          runSpecRevisionId: string | null;
        };
      };
      traits: {
        murphCanonical: boolean;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "sauna",
    "--limit",
    "5",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.query, null);
  assert.equal(
    data.starterCandidate?.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  assert.equal(data.starterCandidate?.traits.murphCanonical, true);
  assert.match(data.starterCandidate?.protocol.revision.pageRevisionId ?? "", /^sha256:/u);
  assert.match(data.starterCandidate?.protocol.revision.runSpecRevisionId ?? "", /^sha256:/u);

  const bryanGroup = data.groups.find(
    (group) => group.matchedProtocol.key === "protocol_variant:dry-sauna/bryan-johnson-blueprint",
  );
  assert.ok(bryanGroup);
  assert.equal(bryanGroup.traits.externalProtocol, true);
  assert.equal(bryanGroup.traits.sourceAttributed, true);
  assert.equal(bryanGroup.traits.highCaution, true);
  assert.ok(
    bryanGroup.parentFamilies.some(
      (family) => family.key === "experiment_family:dry-sauna",
    ),
  );
  assert.ok(
    bryanGroup.relatedProtocolVariants.some(
      (variant) =>
        variant.protocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week" &&
        variant.traits.murphCanonical,
    ),
  );
  assert.equal(
    bryanGroup.starterCandidate?.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
});

test("commons protocol explore accepts an experiment family and includes inverse parent-family variants", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      limit: number;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
    }>;
    matchedEntity: {
      entityType: string;
      key: string;
    } | null;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "dry-sauna",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.limit, 5);
  assert.equal(data.matchedEntity?.entityType, "experiment_family");
  assert.equal(data.matchedEntity?.key, "experiment_family:dry-sauna");
  assert.equal(
    data.starterCandidate?.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  assert.ok(data.groups.every((group) => group.matchReason === "direct_family"));
  assert.ok(
    data.groups.some(
      (group) => group.matchedProtocol.key === "protocol_variant:dry-sauna/bryan-johnson-blueprint",
    ),
  );
  assert.ok(
    data.groups.some(
      (group) =>
        group.matchedProtocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    ),
  );
});

test("commons protocol explore distinguishes direct protocol lookup from query fallback", async () => {
  const cli = createCommonsSliceCli();

  const directResult = await runInProcessJsonCli<{
    filters: {
      query: string | null;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
    }>;
    matchedEntity: {
      entityType: string;
      key: string;
    } | null;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  ]);

  assert.equal(directResult.envelope.ok, true);
  const directData = requireData(directResult.envelope);
  assert.equal(directData.filters.query, null);
  assert.equal(directData.matchedEntity?.entityType, "protocol_variant");
  assert.equal(
    directData.matchedEntity?.key,
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  );
  assert.deepEqual(
    directData.groups.map((group) => group.matchReason),
    ["direct_protocol"],
  );
  assert.equal(
    directData.starterCandidate?.protocol.key,
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  );

  const typedShorthandResult = await runInProcessJsonCli<{
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
    }>;
    matchedEntity: {
      entityType: string;
      key: string;
    } | null;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "PROTOCOL_VARIANT:DRY-SAUNA",
  ]);

  assert.equal(typedShorthandResult.envelope.ok, true);
  const typedShorthandData = requireData(typedShorthandResult.envelope);
  assert.equal(typedShorthandData.matchedEntity?.entityType, "protocol_variant");
  assert.equal(
    typedShorthandData.matchedEntity?.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  assert.deepEqual(
    typedShorthandData.groups.map((group) => group.matchReason),
    ["direct_protocol"],
  );
  assert.equal(
    typedShorthandData.starterCandidate?.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );

  const queryResult = await runInProcessJsonCli<{
    filters: {
      query: string | null;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
    }>;
    matchedEntity: unknown | null;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "norwegian",
    "--limit",
    "3",
  ]);

  assert.equal(queryResult.envelope.ok, true);
  const queryData = requireData(queryResult.envelope);
  assert.equal(queryData.filters.query, "norwegian");
  assert.equal(queryData.matchedEntity, null);
  assert.ok(queryData.groups.length > 0);
  assert.ok(queryData.groups.every((group) => group.matchReason === "query_match"));
  assert.ok(
    queryData.groups.some(
      (group) => group.matchedProtocol.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    ),
  );
  assert.equal(
    queryData.starterCandidate?.protocol.key,
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  );
});

test("commons protocol explore query fallback keeps the starter candidate on the top query match", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      query: string | null;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
      starterCandidate: {
        protocol: {
          key: string;
        };
      } | null;
    }>;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "physical therapy low back hip glute rehab",
    "--limit",
    "5",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.query, "physical therapy low back hip glute rehab");
  assert.equal(data.groups[0]?.matchReason, "query_match");
  assert.equal(typeof data.groups[0]?.matchedProtocol.key, "string");
  assert.equal(
    data.starterCandidate?.protocol.key,
    data.groups[0]?.starterCandidate?.protocol.key,
  );
  assert.notEqual(
    data.starterCandidate?.protocol.key,
    "protocol_variant:daily-step-floor/daily-step-floor",
  );
});

test("commons protocol list treats wildcard categories as unfiltered", async () => {
  const cli = createCommonsSliceCli();

  const result = await runInProcessJsonCli<{
    filters: {
      categories: string[];
      query: string | null;
      status: string | null;
    };
    protocols: Array<{
      entityType: string;
      key: string;
    }>;
    total: number;
  }>(cli, [
    "commons",
    "protocol",
    "list",
    "--query",
    "sauna",
    "--category",
    "*",
    "--status",
    "*",
    "--limit",
    "20",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.query, "sauna");
  assert.deepEqual(data.filters.categories, []);
  assert.equal(data.filters.status, null);
  assert.ok(data.total > 0);
  assert.ok(data.protocols.every((protocol) => protocol.entityType === "protocol_variant"));
  assert.ok(
    data.protocols.some(
      (protocol) =>
        protocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    ),
  );
});

test("commons protocol filters reject invalid public corpus status values", async () => {
  const cli = createCommonsSliceCli();
  const invalidStatus = await runInProcessJsonCli(cli, [
    "commons",
    "protocol",
    "list",
    "--status",
    "active",
  ]);

  assert.equal(invalidStatus.exitCode, 1);
  assert.equal(invalidStatus.envelope.ok, false);
  if (!invalidStatus.envelope.ok) {
    assert.equal(invalidStatus.envelope.error.code, "VALIDATION_ERROR");
    assert.equal(invalidStatus.envelope.error.stage, undefined);
    assert.equal(invalidStatus.envelope.error.fieldErrors?.[0]?.path, "status");
    assert.match(
      invalidStatus.envelope.error.message ?? "",
      /Invalid option: expected one of/u,
    );
    assert.doesNotMatch(invalidStatus.envelope.error.message ?? "", /active/u);
  }
});
