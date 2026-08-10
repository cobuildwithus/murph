import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, test } from "vitest";

import { parseFrontmatterDocument } from "../src/frontmatter.ts";
import {
  ASSESSMENT_RESPONSE_SCHEMA_VERSION,
  buildAutomationMarkdownPreview,
  importAssessmentResponse,
  listAssessmentResponses,
  listAutomations,
  projectAssessmentResponse,
  readAutomation,
  readAssessmentResponse,
  scaffoldAutomationPayload,
  showAutomation,
  upsertAutomation,
  initializeVault,
  VaultError,
} from "../src/index.ts";
import type { AssessmentResponseRecord } from "../src/index.ts";

const tempRoots: string[] = [];

type AutomationPayload = ReturnType<typeof scaffoldAutomationPayload>;

interface AutomationPreviewCase {
  input: AutomationPayload;
  schedule: AutomationPayload["schedule"];
  route: AutomationPayload["route"];
  body: string;
  summary?: string;
  tags?: string[];
  automationId?: string;
  slug?: string;
  status?: AutomationPayload["status"];
  continuityPolicy?: AutomationPayload["continuityPolicy"];
}

async function makeTempDirectory(name: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  tempRoots.push(directory);
  return directory;
}

function createAutomationPayload(
  overrides: Partial<AutomationPayload> = {},
): AutomationPayload {
  return {
    ...scaffoldAutomationPayload(),
    ...overrides,
  };
}

function createUnsafeAutomationPayload(
  overrides: Record<string, unknown>,
): AutomationPayload {
  return {
    ...scaffoldAutomationPayload(),
    ...overrides,
  } as AutomationPayload;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((directory) =>
      fs.rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

test("automation previews normalize each schedule shape and route selector field", () => {
  const previews: AutomationPreviewCase[] = [
    {
      input: createAutomationPayload({
        automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
        slug: "run-once",
        title: "Run once",
        instructions: "Plan one run.\n",
        schedule: {
          kind: "at",
          at: "2026-04-08T09:00:00.000Z",
        },
        route: {
          channel: "sms",
          deliverySource: null,
          deliveryTarget: "phone-thread",
          identityId: null,
          participantId: "participant-01",
          threadId: null,
        },
      }),
      schedule: {
        kind: "at",
        at: "2026-04-08T09:00:00.000Z",
      },
      route: {
        channel: "sms",
        deliverySource: null,
        deliveryTarget: "phone-thread",
        identityId: null,
        participantId: "participant-01",
        threadId: null,
      },
      summary: undefined,
      tags: undefined,
      body: "Plan one run.",
    },
    {
      input: createAutomationPayload({
        automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
        slug: "heartbeat",
        title: "Heartbeat",
        instructions: "Ping the assistant.\n",
        schedule: {
          kind: "every",
          everyMs: 60_000,
        },
      }),
      schedule: {
        kind: "every",
        everyMs: 60_000,
      },
      route: {
        channel: "telegram",
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: null,
      },
      summary: undefined,
      tags: undefined,
      body: "Ping the assistant.",
    },
    {
      input: createAutomationPayload({
        automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FA",
        slug: "cron-check",
        title: "Cron check",
        instructions: "Summarize the cron status.\n",
        schedule: {
          kind: "cron",
          expression: "0 9 * * 1",
        },
        route: {
          channel: "telegram",
          deliverySource: null,
          deliveryTarget: "telegram-thread",
          identityId: "identity-01",
          participantId: null,
          threadId: "thread-01",
        },
        summary: "  Trimmed summary  ",
        tags: ["assistant", "assistant", "scheduled"],
      }),
      schedule: {
        kind: "cron",
        expression: "0 9 * * 1",
      },
      route: {
        channel: "telegram",
        deliverySource: null,
        deliveryTarget: "telegram-thread",
        identityId: "identity-01",
        participantId: null,
        threadId: "thread-01",
      },
      body: "Summarize the cron status.",
      summary: "Trimmed summary",
      tags: ["assistant", "scheduled"],
    },
    {
      input: createAutomationPayload({
        automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FB",
        slug: "daily-check",
        title: "Daily check",
        instructions: "Send the daily checkpoint.\n",
        schedule: {
          kind: "dailyLocal",
          localTime: "07:30",
        },
      }),
      schedule: {
        kind: "dailyLocal",
        localTime: "07:30",
      },
      route: {
        channel: "telegram",
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: null,
      },
      summary: undefined,
      tags: undefined,
      body: "Send the daily checkpoint.",
    },
    {
      input: createUnsafeAutomationPayload({
        automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FC",
        slug: "after-strength-training",
        title: "After strength training",
        instructions: "Ask how the lift felt.\n",
        schedule: {
          kind: "deviceActivity",
          after: "2026-06-07T12:00:00.000Z",
          source: "whoop_v2",
          activityKind: "Strength Training",
        },
      }),
      schedule: {
        kind: "deviceActivity",
        after: "2026-06-07T12:00:00.000Z",
        source: "whoop_v2",
        activityKind: "strength-training",
      },
      route: {
        channel: "telegram",
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: null,
      },
      summary: undefined,
      tags: undefined,
      body: "Ask how the lift felt.",
    },
    {
      input: createUnsafeAutomationPayload({
        automationId: undefined,
        slug: undefined,
        title: "Fallback preview",
        status: undefined,
        continuityPolicy: undefined,
        summary: undefined,
        tags: undefined,
        instructions: "Check the defaulted preview fields.\n",
        schedule: {
          kind: "cron",
          expression: "0 9 * * 1",
        },
        route: {
          channel: "telegram",
          deliverySource: null,
          deliveryTarget: null,
          identityId: null,
          participantId: null,
          threadId: null,
        },
      }),
      schedule: {
        kind: "cron",
        expression: "0 9 * * 1",
      },
      route: {
        channel: "telegram",
        deliverySource: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: null,
      },
      automationId: "automation_preview",
      slug: "fallback-preview",
      status: "active",
      continuityPolicy: "preserve",
      body: "Check the defaulted preview fields.",
    },
  ] as const;

  for (const { input, schedule, route, body, summary, tags, automationId, slug, status, continuityPolicy } of previews) {
    const document = parseFrontmatterDocument(buildAutomationMarkdownPreview(input));

    assert.equal(document.body, body);
    if (automationId !== undefined) {
      assert.equal(document.attributes.automationId, automationId);
    }
    if (slug !== undefined) {
      assert.equal(document.attributes.slug, slug);
    }
    if (status !== undefined) {
      assert.equal(document.attributes.status, status);
    }
    if (continuityPolicy !== undefined) {
      assert.equal(document.attributes.continuityPolicy, continuityPolicy);
    }
    assert.deepEqual(document.attributes.schedule, schedule);
    assert.deepEqual(document.attributes.route, route);
    if (summary !== undefined) {
      assert.equal(document.attributes.summary, summary);
    }
    if (tags !== undefined) {
      assert.deepEqual(document.attributes.tags, tags);
    }
  }
});

test("automation schedule normalization rejects malformed schedule shapes", async () => {
  const cases = [
    {
      schedule: {
        kind: "future",
      },
      message: "schedule.kind must match a supported automation schedule.",
    },
    {
      schedule: {
        kind: "every",
        everyMs: 0,
      },
      message: "schedule.everyMs must be a positive integer.",
    },
    {
      schedule: {
        kind: "every",
        everyMs: 59_999,
      },
      message: "schedule.everyMs must be at least 60000 ms.",
    },
    {
      schedule: {
        kind: "cron",
        expression: "0 9 * * 1",
        timeZone: "Invalid/Timezone",
      },
      message: "schedule.timeZone must be a valid IANA timezone.",
    },
    {
      schedule: {
        kind: "dailyLocal",
        localTime: "7:30",
      },
      message: "schedule.localTime must use HH:MM format.",
    },
    {
      schedule: {
        kind: "deviceActivity",
        after: "2026-06-07T12:00:00.000Z",
        activityKind: "!!!",
      },
      message: "schedule.activityKind must be a lowercase kebab-case device activity kind.",
    },
  ] as const;

  const vaultRoot = await makeTempDirectory("murph-core-automation-invalid-schedule");
  await initializeVault({ vaultRoot });

  for (const { schedule, message } of cases) {
    await assert.rejects(
      () =>
        upsertAutomation({
          vaultRoot,
          now: new Date("2026-04-08T00:00:00.000Z"),
          ...createUnsafeAutomationPayload({
            automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FG",
            slug: "bad-schedule",
            title: "Bad schedule",
            instructions: "Check the schedule branch.",
            schedule,
          }),
        }),
      (error: unknown) =>
        error instanceof VaultError &&
        error.code === "VAULT_INVALID_INPUT" &&
        error.message === message,
    );
  }
});

test("automation rejects legacy schema names and accepts recurring schedule timezones", async () => {
  const legacySchemaVaultRoot = await makeTempDirectory("murph-core-automation-legacy-schema");
  await initializeVault({ vaultRoot: legacySchemaVaultRoot });

  const legacySchemaRelativePath = path.join("bank", "automations", "legacy-weekly-check.md");
  await fs.writeFile(
    path.join(legacySchemaVaultRoot, legacySchemaRelativePath),
    [
      "---",
      "schemaVersion: vault-automation.v1",
      "docType: automation",
      "automationId: automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FH",
      "slug: legacy-weekly-check",
      "title: Legacy weekly check",
      "status: active",
      "schedule:",
      "  kind: cron",
      "  expression: 0 9 * * 1",
      "route:",
      "  channel: telegram",
      "  deliveryTarget: null",
      "  identityId: null",
      "  participantId: null",
      "  threadId: null",
      "continuityPolicy: preserve",
      "createdAt: 2026-04-08T00:00:00.000Z",
      "updatedAt: 2026-04-08T00:00:00.000Z",
      "---",
      "",
      "Write the weekly check.",
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(
    () =>
      readAutomation({
        vaultRoot: legacySchemaVaultRoot,
        automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FH",
      }),
    (error: unknown) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_AUTOMATION" &&
      error.message === "Automation registry document has an unexpected shape.",
  );

  const vaultRoot = await makeTempDirectory("murph-core-automation-legacy-timezone");
  await initializeVault({ vaultRoot });

  const relativePath = path.join("bank", "automations", "legacy-weekly-check.md");
  await fs.writeFile(
    path.join(vaultRoot, relativePath),
    [
      "---",
      "schemaVersion: murph.frontmatter.automation.v1",
      "docType: automation",
      "automationId: automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FH",
      "slug: legacy-weekly-check",
      "title: Legacy weekly check",
      "status: active",
      "schedule:",
      "  kind: cron",
      "  expression: 0 9 * * 1",
      "  timeZone: Australia/Sydney",
      "route:",
      "  channel: telegram",
      "  deliveryTarget: null",
      "  identityId: null",
      "  participantId: null",
      "  threadId: null",
      "continuityPolicy: preserve",
      "createdAt: 2026-04-08T00:00:00.000Z",
      "updatedAt: 2026-04-08T00:00:00.000Z",
      "---",
      "",
      "Write the weekly check.",
      "",
    ].join("\n"),
    "utf8",
  );

  const automation = await readAutomation({
    vaultRoot,
    automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FH",
  });
  assert.deepEqual(automation?.schedule, {
    kind: "cron",
    expression: "0 9 * * 1",
    timeZone: "Australia/Sydney",
  });
});

test("automation list and read lookups keep filters, blanks, and misses deterministic", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-automation");
  await initializeVault({ vaultRoot });

  const alpha = await upsertAutomation({
    vaultRoot,
    automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FC",
    now: new Date("2026-04-08T00:00:00.000Z"),
    ...createAutomationPayload({
      title: "Alpha Check In",
      slug: "alpha-check-in",
      status: "active",
      summary: "Alpha digest.",
      instructions: "Write the alpha digest.",
      tags: ["alpha", "digest"],
    }),
  });

  const beta = await upsertAutomation({
    vaultRoot,
    automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FD",
    now: new Date("2026-04-08T00:00:00.000Z"),
    ...createAutomationPayload({
      title: "Beta Hand-off",
      slug: "beta-hand-off",
      status: "paused",
      summary: "Beta handoff tracker.",
      instructions: "Track the beta handoff blockers.",
      tags: ["beta", "handoff"],
    }),
  });

  const statusMatches = await listAutomations({
    vaultRoot,
    status: ["paused", "active"],
    limit: 1,
  });
  assert.equal(statusMatches.count, 2);
  assert.equal(statusMatches.items.length, 1);
  assert.equal(statusMatches.items[0]?.automationId, alpha.record.automationId);

  const textMatches = await listAutomations({
    vaultRoot,
    text: "HANDOFF",
  });
  assert.equal(textMatches.count, 1);
  assert.equal(textMatches.items[0]?.automationId, beta.record.automationId);

  const blankFiltered = await listAutomations({
    vaultRoot,
    status: "   ",
    text: "  ",
    limit: 0,
  });
  assert.equal(blankFiltered.count, 2);
  assert.equal(blankFiltered.items.length, 2);

  const readById = await readAutomation({
    vaultRoot,
    automationId: alpha.record.automationId,
  });
  assert.equal(readById.slug, alpha.record.slug);

  const shownBySlug = await showAutomation({
    vaultRoot,
    slug: beta.record.slug,
  });
  assert.equal(shownBySlug?.automationId, beta.record.automationId);

  const missingShown = await showAutomation({
    vaultRoot,
    slug: "missing-automation",
  });
  assert.equal(missingShown, null);

  await assert.rejects(
    () =>
      showAutomation({
        vaultRoot,
        automationId: alpha.record.automationId,
        slug: beta.record.slug,
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_AUTOMATION_CONFLICT",
  );

  await assert.rejects(
    () =>
      readAutomation({
        vaultRoot,
        automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FZ",
      }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_AUTOMATION_MISSING",
  );
});

test("automation upserts normalize route strings, generated ids, preserve fallback fields, and clear tags explicitly", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-automation-upsert");
  await initializeVault({ vaultRoot });

  const created = await upsertAutomation({
    vaultRoot,
    now: new Date("2026-04-08T00:00:00.000Z"),
    ...createUnsafeAutomationPayload({
      automationId: undefined,
      slug: undefined,
      title: "Route normalization",
      status: undefined,
      continuityPolicy: undefined,
      summary: "Seed summary.",
      tags: undefined,
      instructions: "Create the route normalization record.\n",
      schedule: {
        kind: "cron",
        expression: "0 9 * * 1",
      },
      route: {
        channel: " iMessage ",
        deliveryTarget: 123,
        identityId: "  identity-01  ",
        participantId: "participant-01",
        threadId: 456,
      },
    }),
  });

  assert.equal(created.created, true);
  assert.equal(created.record.slug, "route-normalization");
  assert.equal(created.record.status, "active");
  assert.equal(created.record.continuityPolicy, "preserve");
  assert.deepEqual(created.record.route, {
    channel: "linq",
    deliverySource: null,
    deliveryTarget: "123",
    identityId: "identity-01",
    participantId: "participant-01",
    threadId: "456",
  });

  const updated = await upsertAutomation({
    vaultRoot,
    automationId: created.record.automationId,
    slug: created.record.slug,
    allowSlugRename: false,
    now: new Date("2026-04-08T00:10:00.000Z"),
    ...createUnsafeAutomationPayload({
      automationId: created.record.automationId,
      slug: created.record.slug,
      title: "Route normalization",
      status: undefined,
      continuityPolicy: undefined,
      summary: undefined,
      tags: [],
      instructions: "Update the route normalization record.\n",
      schedule: undefined,
      route: undefined,
    }),
  });

  assert.equal(updated.created, false);
  assert.equal(updated.record.automationId, created.record.automationId);
  assert.equal(updated.record.slug, created.record.slug);
  assert.equal(updated.record.createdAt, created.record.createdAt);
  assert.equal(updated.record.status, created.record.status);
  assert.equal(updated.record.continuityPolicy, created.record.continuityPolicy);
  assert.deepEqual(updated.record.schedule, created.record.schedule);
  assert.deepEqual(updated.record.route, created.record.route);
  assert.equal(updated.record.summary, "Seed summary.");
  assert.deepEqual(updated.record.tags, []);
});

test("automation concurrent creates resolve through the public registry lock", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-automation-concurrent-upsert");
  await initializeVault({ vaultRoot });

  const [first, second] = await Promise.all([
    upsertAutomation({
      vaultRoot,
      ...createUnsafeAutomationPayload({
        title: "Morning Check",
        slug: "morning-check",
        instructions: "First caller instructions.",
      }),
    }),
    upsertAutomation({
      vaultRoot,
      ...createUnsafeAutomationPayload({
        title: "Morning Check",
        slug: "morning-check",
        instructions: "Second caller instructions.",
      }),
    }),
  ]);

  assert.equal(first.record.automationId, second.record.automationId);
  assert.equal(first.record.slug, "morning-check");
  assert.deepEqual([first.created, second.created].sort(), [false, true]);

  const files = await fs.readdir(path.join(vaultRoot, "bank", "automations"));
  assert.deepEqual(files.filter((file) => file === "morning-check.md"), ["morning-check.md"]);
});

test("automation loading rejects malformed registry documents", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-automation-invalid-record");
  await initializeVault({ vaultRoot });

  const brokenAutomationPath = path.join(vaultRoot, "bank", "automations", "broken.md");
  const brokenAutomationMarkdown = buildAutomationMarkdownPreview(
    createAutomationPayload({
      automationId: "automation_01JNW7YJ7MNE7M9Q2QWQK4Z3FZ",
      slug: "broken",
      title: "Broken automation",
      instructions: "This record should fail schema validation.\n",
    }),
  ).replace(/^docType: .*$/m, "docType: note");

  await fs.writeFile(brokenAutomationPath, brokenAutomationMarkdown, "utf8");

  await assert.rejects(
    () => listAutomations({ vaultRoot }),
    (error: unknown) => error instanceof VaultError && error.code === "VAULT_INVALID_AUTOMATION",
  );
});

test("assessment projections normalize alternate field names and source modes", async () => {
  const goalId = "goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8";
  const baseAssessmentResponse: AssessmentResponseRecord = {
    schemaVersion: ASSESSMENT_RESPONSE_SCHEMA_VERSION,
    id: "asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
    assessmentType: "intake",
    recordedAt: "2026-04-08T00:00:00.000Z",
    source: "derived",
    rawPath: "raw/assessments/asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8/source.json",
    title: "Assessment",
    questionnaireSlug: "baseline",
    responses: {
      response: {
        proposal: {
          structured: {
            data: {
              goals: [
                "Morning cadence",
                {
                  goal: "Build pace",
                  note: "Keep steady.",
                  tags: ["steady"],
                },
              ],
              conditions: [
                {
                  label: "Hypertension",
                  onsetAt: "2024-01-01T00:00:00.000Z",
                },
              ],
              allergy: {
                name: "Penicillin",
                reaction: "rash",
              },
              supplements: [
                {
                  supplementName: "Vitamin D",
                  dose: "2000",
                  unit: "IU",
                  instructions: "Take with breakfast.",
                },
              ],
              historyEvent: {
                label: "Bike crash",
                date: "2024-02-03T04:05:06.000Z",
              },
              familyMember: [
                {
                  relative: "Sister",
                  relation: "sibling",
                  description: "Asthma.",
                },
              ],
              geneticVariant: {
                label: "APOE e4",
                classification: "risk",
              },
            },
          },
        },
      },
    },
  };

  const derivedProjection = await projectAssessmentResponse({
    assessmentResponse: baseAssessmentResponse,
  });
  const manualAssessmentResponse = { ...baseAssessmentResponse };
  delete (manualAssessmentResponse as { id?: string }).id;
  manualAssessmentResponse.source = "import";
  const manualProjection = await projectAssessmentResponse({
    assessmentResponse: manualAssessmentResponse as never,
  });

  assert.equal(derivedProjection.assessmentId, baseAssessmentResponse.id);
  assert.deepEqual(
    derivedProjection.goals.map((goal) => goal.title),
    ["Morning cadence", "Build pace"],
  );
  assert.equal(derivedProjection.goals[1]?.source.assessmentPointer, "/response/proposal/structured/data/goals/1");
  assert.equal(derivedProjection.conditions[0]?.name, "Hypertension");
  assert.equal(derivedProjection.conditions[0]?.source.assessmentPointer, "/response/proposal/structured/data/conditions/0");
  assert.equal(derivedProjection.allergies[0]?.substance, "Penicillin");
  assert.equal(derivedProjection.protocols[0]?.name, "Vitamin D");
  assert.equal(derivedProjection.protocols[0]?.dose, "2000 IU");
  assert.equal(derivedProjection.historyEvents[0]?.kind, "note");
  assert.equal(derivedProjection.historyEvents[0]?.occurredAt, "2024-02-03T04:05:06.000Z");
  assert.equal(derivedProjection.familyMembers[0]?.name, "Sister");
  assert.equal(derivedProjection.geneticVariants[0]?.variant, "APOE e4");
  assert.equal(manualProjection.assessmentId, undefined);
});

test("assessment import rejects invalid JSON and non-object roots", async () => {
  const cases = [
    {
      name: "invalid-json",
      contents: "{",
      message: "Assessment response must be valid JSON.",
    },
    {
      name: "non-object-root",
      contents: "[]",
      message: "Assessment response root must be a plain object.",
    },
  ] as const;

  for (const { name, contents, message } of cases) {
    const vaultRoot = await makeTempDirectory(`murph-core-assessment-import-${name}`);
    await initializeVault({ vaultRoot });

    const sourcePath = path.join(vaultRoot, `${name}.json`);
    await fs.writeFile(sourcePath, contents, "utf8");

    await assert.rejects(
      () =>
        importAssessmentResponse({
          vaultRoot,
          sourcePath,
        }),
      (error: unknown) =>
        error instanceof VaultError &&
        error.code === "ASSESSMENT_INVALID_JSON" &&
        error.message === message,
    );
  }
});

test("assessment storage rejects invalid rawPath and relatedIds rows", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-assessment-storage-invalid");
  await initializeVault({ vaultRoot });

  const shardPath = path.join(vaultRoot, "ledger/assessments/2026/2026-04.jsonl");
  await fs.mkdir(path.dirname(shardPath), { recursive: true });
  await fs.writeFile(
    shardPath,
    `${JSON.stringify({
      schemaVersion: ASSESSMENT_RESPONSE_SCHEMA_VERSION,
      id: "asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3F8",
      assessmentType: "intake",
      recordedAt: "2026-04-08T00:00:00.000Z",
      source: "import",
      rawPath: 42,
      responses: {},
    })}\n`,
    "utf8",
  );

  await assert.rejects(
    () => listAssessmentResponses({ vaultRoot }),
    (error: unknown) => error instanceof VaultError && error.code === "ASSESSMENT_RESPONSE_INVALID",
  );
});

test("assessment storage rejects invalid records and missing reads", async () => {
  const cases = [
    {
      name: "non-object-row",
      record: [],
    },
    {
      name: "invalid-contract-row",
      record: {
        schemaVersion: ASSESSMENT_RESPONSE_SCHEMA_VERSION,
        id: "bad-id",
        assessmentType: "intake",
        recordedAt: "2026-04-08T00:00:00.000Z",
        source: "import",
        rawPath: "raw/assessments/asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3FA/source.json",
        responses: {},
      },
    },
  ] as const;

  for (const { name, record } of cases) {
    const vaultRoot = await makeTempDirectory(`murph-core-assessment-storage-${name}`);
    await initializeVault({ vaultRoot });

    const shardPath = path.join(vaultRoot, "ledger/assessments/2026/2026-04.jsonl");
    await fs.mkdir(path.dirname(shardPath), { recursive: true });
    await fs.writeFile(shardPath, `${JSON.stringify(record)}\n`, "utf8");

    await assert.rejects(
      () => listAssessmentResponses({ vaultRoot }),
      (error: unknown) => error instanceof VaultError && error.code === "ASSESSMENT_RESPONSE_INVALID",
    );
  }

  const vaultRoot = await makeTempDirectory("murph-core-assessment-storage-missing-read");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      readAssessmentResponse({
        vaultRoot,
        assessmentId: "asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3FZ",
      }),
    (error: unknown) =>
      error instanceof VaultError && error.code === "ASSESSMENT_RESPONSE_NOT_FOUND",
  );
});

test("assessment storage rejects relatedIds values that are not string arrays", async () => {
  const vaultRoot = await makeTempDirectory("murph-core-assessment-storage-related-ids");
  await initializeVault({ vaultRoot });

  const shardPath = path.join(vaultRoot, "ledger/assessments/2026/2026-04.jsonl");
  await fs.mkdir(path.dirname(shardPath), { recursive: true });
  await fs.writeFile(
    shardPath,
    `${JSON.stringify({
      schemaVersion: ASSESSMENT_RESPONSE_SCHEMA_VERSION,
      id: "asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3F9",
      assessmentType: "intake",
      recordedAt: "2026-04-08T00:00:00.000Z",
      source: "import",
      rawPath: "raw/assessments/asmt_01JNW7YJ7MNE7M9Q2QWQK4Z3F9/source.json",
      responses: {},
      relatedIds: ["goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8", 42],
    })}\n`,
    "utf8",
  );

  await assert.rejects(
    () => listAssessmentResponses({ vaultRoot }),
    (error: unknown) => error instanceof VaultError && error.code === "ASSESSMENT_RESPONSE_INVALID",
  );
});
