import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cli } from "incur";
import { localParallelCliTest as test } from "./local-parallel-test.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import { registerCommonsCommands } from "../src/commands/commons.js";
import {
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

test("deleted generic Commons commands are no longer registered", async () => {
  const cli = createCommonsSliceCli();

  for (const command of [
    ["commons", "search", "sauna"],
    ["commons", "get", "finnish-sauna"],
    ["commons", "source", "list", "--protocol", "finnish-sauna"],
    ["commons", "protocol", "list", "--query", "sauna"],
    ["commons", "protocol", "show", "finnish-sauna"],
    ["commons", "protocol", "explore", "sauna"],
  ] as const) {
    const result = await runInProcessJsonCli(cli, [...command]);

    assert.equal(result.exitCode, 1, command.join(" "));
    assert.equal(result.envelope.ok, false, command.join(" "));
  }
});

test("commons knowledge search returns a bounded source-backed biomarker packet", async () => {
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
    "How should I track deep sleep minutes?",
    "--limit",
    "3",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.available, true);
  assert.equal(data.topic?.key, "biomarker:deep-sleep-minutes");
  assert.deepEqual(data.candidates, []);
  assert.ok(data.items.length > 0 && data.items.length <= 3);
  assert.ok(data.items.some((item) =>
    item.sources.some((source) => source.pmid !== null || source.url !== null)
  ));
});

test("commons knowledge search rejects a result limit larger than three items", async () => {
  const result = await runInProcessJsonCli(createCommonsSliceCli(), [
    "commons",
    "knowledge",
    "search",
    "How should I track deep sleep minutes?",
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
      key: string;
      revision: {
        pageRevisionId: string;
        workflowSpecRevisionId: string;
      };
      sources: Array<{ label: string; url: string }>;
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
      indexable: true;
      key: string;
      revision: {
        pageRevisionId: string;
        workflowSpecRevisionId: string;
      };
      safetyTier: string;
      sources: Array<{ label: string; url: string }>;
    };
  }>(cli, ["commons", "goal", "show", "improve-deep-sleep"]);

  assert.equal(showResult.envelope.ok, true);
  const shown = requireData(showResult.envelope).goal;
  assert.equal(shown.key, "goal_template:improve-deep-sleep");
  assert.equal(shown.indexable, true);
  assert.ok(shown.sources.length >= 2);
  assert.ok(shown.sources.every((source) => source.label.length > 0));
  assert.ok(shown.sources.every((source) => /^https:\/\//u.test(source.url)));
  assert.ok(shown.safetyTier.length > 0);
  assert.deepEqual(shown.revision, summary?.revision);
  assert.equal(Object.hasOwn(shown, "body"), false);
  assert.equal(Object.hasOwn(shown, "evidenceSourceKeys"), false);
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

  const collisionListResult = await runInProcessJsonCli<{
    goals: Array<{ key: string }>;
    total: number;
  }>(cli, ["commons", "goal", "list", "--query", "ironman", "--limit", "20"]);
  assert.equal(collisionListResult.envelope.ok, true);
  const collisionList = requireData(collisionListResult.envelope);
  assert.ok(collisionList.total > 1);
  assert.ok(
    collisionList.goals.some((goal) => goal.key === "goal_template:complete-half-ironman"),
  );
  assert.ok(
    collisionList.goals.some((goal) => goal.key === "goal_template:run-ironman"),
  );

  const ambiguousShow = await runInProcessJsonCli(cli, [
    "commons",
    "goal",
    "show",
    "ironman",
  ]);
  assert.equal(ambiguousShow.exitCode, 1);
  assert.equal(ambiguousShow.envelope.ok, false);
  if (!ambiguousShow.envelope.ok) {
    assert.equal(ambiguousShow.envelope.error.code, "commons_goal_not_found");
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
