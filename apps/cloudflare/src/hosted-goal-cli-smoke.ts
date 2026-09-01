import {
  HOSTED_RUNNER_SMOKE_HEALTH_COMMONS_CLI_GOAL_PROOF_COUNT,
} from "./hosted-runner-smoke-contract.js";
import {
  PUBLIC_HEALTH_GOAL_CATEGORIES,
  PUBLIC_HEALTH_GOAL_MINIMUM_COUNT,
} from "./public-health-goal-catalog-contract.js";

const IMPROVE_DEEP_SLEEP_GOAL_KEY = "goal_template:improve-deep-sleep";
const IMPROVE_DEEP_SLEEP_GOAL_PROMPT =
  "Hey Murph, help me improve my deep sleep.";
const PUBLIC_GOAL_SMOKE_SAMPLE_LIMIT = 1;
const PUBLIC_GOAL_SMOKE_EXACT_LOOKUP_LIMIT = 2;
const REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export interface HostedGoalCliSmokeResult {
  proofCount: number;
}

type HostedGoalCliSmokeCommandRunner = (
  label: string,
  args: readonly string[],
) => Promise<string>;

interface CommonsGoalRevision {
  pageRevisionId: string;
  workflowSpecRevisionId: string;
}

interface SmokeGoal {
  data: Record<string, unknown>;
  goalId: string;
}

interface PublicGoalCatalogProbe {
  catalogHash: string;
  deepSleepSummary: Record<string, unknown>;
}

export async function runHostedGoalCliSmoke(input: {
  runCommand: HostedGoalCliSmokeCommandRunner;
}): Promise<HostedGoalCliSmokeResult> {
  let proofCount = 0;
  const catalogProbe = await probePublicGoalCatalog(input.runCommand);
  const deepSleepSummary = catalogProbe.deepSleepSummary;
  const listRevision = readCommonsGoalRevision(
    deepSleepSummary.revision,
    "commons goal list revision",
  );
  proofCount += 1;

  const showData = readCliSuccessData(
    await input.runCommand("commons-goal-show", [
      "commons",
      "goal",
      "show",
      "improve-deep-sleep",
      "--format",
      "json",
    ]),
    "commons goal show",
  );
  if (
    readNonEmptyString(showData.catalogHash, "commons goal show catalog hash")
      !== catalogProbe.catalogHash
  ) {
    throw new Error("Hosted Goal CLI smoke observed a changing public goal catalog.");
  }
  const shownGoal = readRecord(showData.goal, "commons goal show goal");
  if (shownGoal.key !== IMPROVE_DEEP_SLEEP_GOAL_KEY) {
    throw new Error("Hosted Goal CLI smoke resolved an unexpected public goal.");
  }
  assertCompactCommonsGoal(shownGoal);
  const shownRevision = readCommonsGoalRevision(
    shownGoal.revision,
    "commons goal show revision",
  );
  assertRevisionMatches(shownRevision, listRevision);
  proofCount += 1;

  const legacyGoal = await createAndReadSmokeGoal({
    createArgs: [
      "goal",
      "save",
      "Hosted runner smoke legacy goal",
      "--slug",
      "hosted-runner-smoke-legacy-goal",
      "--status",
      "active",
      "--format",
      "json",
    ],
    label: "legacy",
    runCommand: input.runCommand,
  });
  assertSmokeGoalState(legacyGoal.data, {
    expectedCommonsGoalRef: null,
    expectedStatus: "active",
    expectedTitle: "Hosted runner smoke legacy goal",
  });
  proofCount += 1;

  const updatedLegacyGoal = await updateAndReadSmokeGoal({
    goalId: legacyGoal.goalId,
    label: "legacy",
    runCommand: input.runCommand,
  });
  assertSmokeGoalState(updatedLegacyGoal, {
    expectedCommonsGoalRef: null,
    expectedStatus: "paused",
    expectedTitle: "Hosted runner smoke legacy goal",
  });
  proofCount += 1;

  const expectedCommonsGoalRef = {
    key: IMPROVE_DEEP_SLEEP_GOAL_KEY,
    ...shownRevision,
  };
  const lineageGoal = await createAndReadSmokeGoal({
    createArgs: [
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
      IMPROVE_DEEP_SLEEP_GOAL_KEY,
      "--commons-page-revision-id",
      shownRevision.pageRevisionId,
      "--commons-workflow-revision-id",
      shownRevision.workflowSpecRevisionId,
      "--format",
      "json",
    ],
    label: "lineage",
    runCommand: input.runCommand,
  });
  assertSmokeGoalState(lineageGoal.data, {
    expectedCommonsGoalRef,
    expectedStatus: "active",
    expectedTitle: "Improve my deep sleep",
  });
  proofCount += 1;

  const updatedLineageGoal = await updateAndReadSmokeGoal({
    goalId: lineageGoal.goalId,
    label: "lineage",
    runCommand: input.runCommand,
  });
  assertSmokeGoalState(updatedLineageGoal, {
    expectedCommonsGoalRef,
    expectedStatus: "paused",
    expectedTitle: "Improve my deep sleep",
  });
  proofCount += 1;

  if (proofCount !== HOSTED_RUNNER_SMOKE_HEALTH_COMMONS_CLI_GOAL_PROOF_COUNT) {
    throw new Error(
      `Hosted Goal CLI smoke was incomplete. proofCount=${proofCount}`,
    );
  }

  return { proofCount };
}

async function probePublicGoalCatalog(
  runCommand: HostedGoalCliSmokeCommandRunner,
): Promise<PublicGoalCatalogProbe> {
  const metadataLabel = "commons goal list metadata";
  const metadata = readCliSuccessData(
    await runCommand("commons-goal-list-metadata", [
      "commons",
      "goal",
      "list",
      "--limit",
      String(PUBLIC_GOAL_SMOKE_SAMPLE_LIMIT),
      "--format",
      "json",
    ]),
    metadataLabel,
  );
  const catalogHash = readNonEmptyString(
    metadata.catalogHash,
    `${metadataLabel} catalog hash`,
  );
  const total = readNonNegativeInteger(metadata.total, `${metadataLabel} total`);
  if (total < PUBLIC_HEALTH_GOAL_MINIMUM_COUNT) {
    throw new Error("Hosted Goal CLI smoke found too few public goals.");
  }
  const metadataGoals = readArray(metadata.goals, `${metadataLabel} goals`)
    .map((value) => readRecord(value, `${metadataLabel} item`));
  assertSinglePublicGoalSample(metadataGoals, metadataLabel);

  const partitions = await Promise.all(PUBLIC_HEALTH_GOAL_CATEGORIES.map(
    async (category) => {
      const commandLabel = `commons-goal-list-${category}`;
      const outputLabel = `commons goal list ${category}`;
      const partition = readCliSuccessData(
        await runCommand(commandLabel, [
          "commons",
          "goal",
          "list",
          "--category",
          category,
          "--limit",
          String(PUBLIC_GOAL_SMOKE_SAMPLE_LIMIT),
          "--format",
          "json",
        ]),
        outputLabel,
      );
      if (
        readNonEmptyString(partition.catalogHash, `${outputLabel} catalog hash`)
          !== catalogHash
      ) {
        throw new Error("Hosted Goal CLI smoke observed a changing public goal catalog.");
      }

      const categoryTotal = readNonNegativeInteger(
        partition.total,
        `${outputLabel} total`,
      );
      if (categoryTotal === 0) {
        throw new Error(
          "Hosted Goal CLI smoke found an incomplete or invalid public goal catalog.",
        );
      }
      const categoryGoals = readArray(partition.goals, `${outputLabel} goals`)
        .map((value) => readRecord(value, `${outputLabel} item`));
      const categoryGoal = assertSinglePublicGoalSample(categoryGoals, outputLabel);
      if (categoryGoal.category !== category) {
        throw new Error(
          "Hosted Goal CLI smoke received a goal outside its category sample.",
        );
      }
      return categoryTotal;
    },
  ));

  const partitionTotal = partitions.reduce((sum, categoryTotal) =>
    sum + categoryTotal, 0);
  if (partitionTotal !== total) {
    throw new Error(
      "Hosted Goal CLI smoke found an incomplete or invalid public goal catalog.",
    );
  }

  const lookupLabel = "commons goal list deep sleep";
  const lookup = readCliSuccessData(
    await runCommand("commons-goal-list-deep-sleep", [
      "commons",
      "goal",
      "list",
      "--query",
      IMPROVE_DEEP_SLEEP_GOAL_KEY,
      "--limit",
      String(PUBLIC_GOAL_SMOKE_EXACT_LOOKUP_LIMIT),
      "--format",
      "json",
    ]),
    lookupLabel,
  );
  if (
    readNonEmptyString(lookup.catalogHash, `${lookupLabel} catalog hash`)
      !== catalogHash
  ) {
    throw new Error("Hosted Goal CLI smoke observed a changing public goal catalog.");
  }
  const lookupTotal = readNonNegativeInteger(lookup.total, `${lookupLabel} total`);
  const lookupGoals = readArray(lookup.goals, `${lookupLabel} goals`)
    .map((value) => readRecord(value, `${lookupLabel} item`));
  if (lookupTotal !== 1 || lookupGoals.length !== 1) {
    throw new Error("Hosted Goal CLI smoke did not find one exact expected public goal.");
  }
  const deepSleepSummary = lookupGoals[0];
  assertCompactCommonsGoal(deepSleepSummary);
  if (deepSleepSummary.key !== IMPROVE_DEEP_SLEEP_GOAL_KEY) {
    throw new Error("Hosted Goal CLI smoke did not find the expected public goal.");
  }
  if (deepSleepSummary.startPrompt !== IMPROVE_DEEP_SLEEP_GOAL_PROMPT) {
    throw new Error("Hosted Goal CLI smoke found an unexpected public goal prompt.");
  }
  return { catalogHash, deepSleepSummary };
}

function assertSinglePublicGoalSample(
  goals: readonly Record<string, unknown>[],
  label: string,
): Record<string, unknown> {
  if (goals.length !== PUBLIC_GOAL_SMOKE_SAMPLE_LIMIT) {
    throw new Error(`Hosted Goal CLI smoke ${label} did not return one bounded sample.`);
  }
  const goal = goals[0];
  assertCompactCommonsGoal(goal);
  return goal;
}

async function createAndReadSmokeGoal(input: {
  createArgs: readonly string[];
  label: "legacy" | "lineage";
  runCommand: HostedGoalCliSmokeCommandRunner;
}): Promise<SmokeGoal> {
  const saved = readCliSuccessData(
    await input.runCommand(`${input.label}-goal-create`, input.createArgs),
    `${input.label} goal create`,
  );
  if (saved.created !== true) {
    throw new Error("Hosted Goal CLI smoke did not create a disposable Goal.");
  }
  const goalId = readNonEmptyString(saved.goalId, `${input.label} goal id`);

  return {
    data: await readSmokeGoal({
      goalId,
      label: `${input.label}-goal-create-read`,
      runCommand: input.runCommand,
    }),
    goalId,
  };
}

async function updateAndReadSmokeGoal(input: {
  goalId: string;
  label: "legacy" | "lineage";
  runCommand: HostedGoalCliSmokeCommandRunner;
}): Promise<Record<string, unknown>> {
  const saved = readCliSuccessData(
    await input.runCommand(`${input.label}-goal-update`, [
      "goal",
      "save",
      "--id",
      input.goalId,
      "--status",
      "paused",
      "--format",
      "json",
    ]),
    `${input.label} goal update`,
  );
  if (saved.created !== false || saved.goalId !== input.goalId) {
    throw new Error("Hosted Goal CLI smoke did not update the disposable Goal in place.");
  }

  return await readSmokeGoal({
    goalId: input.goalId,
    label: `${input.label}-goal-update-read`,
    runCommand: input.runCommand,
  });
}

async function readSmokeGoal(input: {
  goalId: string;
  label: string;
  runCommand: HostedGoalCliSmokeCommandRunner;
}): Promise<Record<string, unknown>> {
  const shown = readCliSuccessData(
    await input.runCommand(input.label, [
      "goal",
      "show",
      input.goalId,
      "--format",
      "json",
    ]),
    input.label,
  );
  const entity = readRecord(shown.entity, `${input.label} entity`);
  return readRecord(entity.data, `${input.label} data`);
}

function assertSmokeGoalState(
  data: Record<string, unknown>,
  expected: {
    expectedCommonsGoalRef: ({ key: string } & CommonsGoalRevision) | null;
    expectedStatus: "active" | "paused";
    expectedTitle: string;
  },
): void {
  if (data.status !== expected.expectedStatus) {
    throw new Error("Hosted Goal CLI smoke read an unexpected Goal status.");
  }
  if (data.title !== expected.expectedTitle) {
    throw new Error("Hosted Goal CLI smoke did not preserve the Goal title.");
  }
  if (expected.expectedCommonsGoalRef === null) {
    if (data.commonsGoalRef !== undefined && data.commonsGoalRef !== null) {
      throw new Error("Hosted Goal CLI smoke added lineage to a legacy Goal.");
    }
    return;
  }
  const rawReference = data.commonsGoalRef;
  if (!rawReference || typeof rawReference !== "object" || Array.isArray(rawReference)) {
    throw new Error("Hosted Goal CLI smoke did not preserve exact Goal lineage.");
  }
  const reference = rawReference as Record<string, unknown>;
  if (
    Object.keys(reference).length !== 3
    || reference.key !== expected.expectedCommonsGoalRef.key
    || reference.pageRevisionId !== expected.expectedCommonsGoalRef.pageRevisionId
    || reference.workflowSpecRevisionId
      !== expected.expectedCommonsGoalRef.workflowSpecRevisionId
  ) {
    throw new Error("Hosted Goal CLI smoke did not preserve exact Goal lineage.");
  }
}

function assertCompactCommonsGoal(goal: Record<string, unknown>): void {
  const forbiddenFields = [
    "body",
    "content",
    "markdown",
    "pageBody",
    "sourceSnippets",
    "evidenceSourceKeys",
    "workflowSpec",
  ];
  if (forbiddenFields.some((field) => field in goal)) {
    throw new Error("Hosted Goal CLI smoke received a non-compact public goal payload.");
  }
}

function assertRevisionMatches(
  actual: CommonsGoalRevision,
  expected: CommonsGoalRevision,
): void {
  if (
    actual.pageRevisionId !== expected.pageRevisionId
    || actual.workflowSpecRevisionId !== expected.workflowSpecRevisionId
  ) {
    throw new Error("Hosted Goal CLI smoke found mismatched public goal revisions.");
  }
}

function readCliSuccessData(output: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new SyntaxError(`Hosted Goal CLI smoke ${label} output was not valid JSON.`);
  }
  const envelope = readRecord(parsed, `${label} envelope`);
  if (envelope.ok !== true) {
    throw new Error(`Hosted Goal CLI smoke ${label} did not succeed.`);
  }
  return readRecord(envelope.data, `${label} data`);
}

function readCommonsGoalRevision(
  value: unknown,
  label: string,
): CommonsGoalRevision {
  const revision = readRecord(value, label);
  const pageRevisionId = readNonEmptyString(
    revision.pageRevisionId,
    `${label} page revision`,
  );
  const workflowSpecRevisionId = readNonEmptyString(
    revision.workflowSpecRevisionId,
    `${label} workflow revision`,
  );
  if (
    !REVISION_PATTERN.test(pageRevisionId)
    || !REVISION_PATTERN.test(workflowSpecRevisionId)
  ) {
    throw new Error("Hosted Goal CLI smoke expected exact sha256 revisions.");
  }
  return {
    pageRevisionId,
    workflowSpecRevisionId,
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Hosted Goal CLI smoke ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Hosted Goal CLI smoke ${label} must be an array.`);
  }
  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Hosted Goal CLI smoke ${label} must be a non-empty string.`);
  }
  return value.trim();
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`Hosted Goal CLI smoke ${label} must be a non-negative integer.`);
  }
  return value;
}
