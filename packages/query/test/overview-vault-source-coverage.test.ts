import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, test, vi } from "vitest";

import {
  CURRENT_VAULT_FORMAT_VERSION,
  VAULT_LAYOUT,
} from "@murphai/contracts";

import {
  resolveCanonicalRecordClass,
  type CanonicalEntity,
} from "../src/canonical-entities.ts";
import { createVaultReadModel } from "../src/model.ts";
import {
  buildOverviewMetrics,
  buildOverviewWeeklyStats,
  summarizeOverviewExperiments,
  summarizeRecentOverviewJournals,
} from "../src/overview.ts";
import {
  readVaultSourceTolerant,
} from "../src/vault-source.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((vaultRoot) =>
      rm(vaultRoot, { recursive: true, force: true })),
  );
});

test("overview helpers normalize journal and experiment summaries", () => {
  const vault = createVaultReadModel({
    vaultRoot: "/tmp/query-overview",
    entities: [
      createEntity("goal", "goal_sleep", {
        title: "Improve sleep",
      }),
      createEntity("goal", "goal_recovery", {
        title: "Recovery",
      }),
      createEntity("journal", "journal:2026-04-11", {
        date: "2026-04-11",
        title: "Training journal",
        body: "# Title\n\n- Good energy\n- Strong finish\n",
        tags: ["training", "", "sleep"],
      }),
      createEntity("journal", "journal:2026-04-09", {
        occurredAt: "2026-04-09T21:00:00.000Z",
        title: null,
        body: null,
        tags: ["reflection"],
      }),
      createEntity("experiment", "exp_active", {
        occurredAt: "2026-04-08T10:00:00.000Z",
        date: "2026-04-08",
        title: "Magnesium trial",
        status: "Active",
        experimentSlug: "magnesium-trial",
        body: "# Trial\n\nTesting magnesium glycinate nightly.\n",
        tags: ["sleep", ""],
      }),
      createEntity("experiment", "exp_archived", {
        occurredAt: "2026-04-12T10:00:00.000Z",
        date: null,
        title: null,
        status: "archived",
        experimentSlug: null,
        body: "- Archived notes\n",
        tags: ["archive"],
      }),
      createEntity("event", "evt_01"),
      createEntity("sample", "smp_01", {
        stream: "hrv",
      }),
    ],
  });

  assert.deepEqual(
    buildOverviewMetrics(vault).map((entry) => [entry.label, entry.value]),
    [
      ["entities", 8],
      ["events", 1],
      ["samples", 1],
      ["journal days", 2],
      ["experiments", 2],
      ["registries", 2],
    ],
  );

  assert.deepEqual(summarizeRecentOverviewJournals(vault, NaN), [
    {
      date: "2026-04-11",
      id: "journal:2026-04-11",
      summary: "Good energy Strong finish",
      tags: ["training", "sleep"],
      title: "Training journal",
    },
    {
      date: "2026-04-09",
      id: "journal:2026-04-09",
      summary: null,
      tags: ["reflection"],
      title: "journal:2026-04-09",
    },
  ]);

  assert.deepEqual(summarizeOverviewExperiments(vault, 2), [
    {
      id: "exp_active",
      slug: "magnesium-trial",
      startedOn: "2026-04-08",
      status: "Active",
      summary: "Testing magnesium glycinate nightly.",
      tags: ["sleep"],
      title: "Magnesium trial",
    },
    {
      id: "exp_archived",
      slug: null,
      startedOn: "2026-04-12",
      status: "archived",
      summary: "Archived notes",
      tags: ["archive"],
      title: "exp_archived",
    },
  ]);
});

test("overview helpers handle empty inputs, limit coercion, truncation, and sunday week windows", () => {
  const longBody = `# Heading\n\n${"steady ".repeat(40)}progress`;
  const vault = createVaultReadModel({
    vaultRoot: "/tmp/query-overview-branches",
    entities: [
      createEntity("journal", "journal:undated", {
        occurredAt: null,
        title: null,
        body: "# Only heading",
        tags: [""],
      }),
      createEntity("experiment", "exp_uppercase", {
        occurredAt: null,
        date: null,
        title: null,
        status: " ACTIVE ",
        experimentSlug: "exp-uppercase",
        body: longBody,
        tags: ["focus", ""],
      }),
      createEntity("sample", "smp_week_1", {
        date: "2026-04-06",
        stream: "hrv",
        attributes: { value: 40, unit: " ms " },
      }),
      createEntity("sample", "smp_week_2", {
        date: "2026-04-08",
        stream: "hrv",
        attributes: { value: 60, unit: "ms" },
      }),
      createEntity("sample", "smp_prev_zero", {
        date: "2026-03-31",
        stream: "readiness",
        attributes: { value: 0, unit: null },
      }),
      createEntity("sample", "smp_curr_zero", {
        date: "2026-04-10",
        stream: "readiness",
        attributes: { value: 5, unit: null },
      }),
      createEntity("sample", "smp_invalid_value", {
        date: "2026-04-09",
        stream: "hrv",
        attributes: { value: "bad", unit: "ms" },
      }),
      createEntity("sample", "smp_missing_stream", {
        date: "2026-04-09",
        stream: null,
        attributes: { value: 20, unit: "ms" },
      }),
      createEntity("sample", "smp_outside_window", {
        date: "2026-03-01",
        stream: "hrv",
        attributes: { value: 99, unit: "ms" },
      }),
    ],
  });

  assert.deepEqual(summarizeRecentOverviewJournals(vault, 0), [
    {
      date: "Undated",
      id: "journal:undated",
      summary: null,
      tags: [],
      title: "journal:undated",
    },
  ]);

  const experiments = summarizeOverviewExperiments(vault, 0);
  assert.equal(experiments.length, 1);
  assert.deepEqual(experiments[0]?.id, "exp_uppercase");
  assert.deepEqual(experiments[0]?.slug, "exp-uppercase");
  assert.deepEqual(experiments[0]?.startedOn, "Undated");
  assert.deepEqual(experiments[0]?.status, " ACTIVE ");
  assert.deepEqual(experiments[0]?.tags, ["focus"]);
  assert.deepEqual(experiments[0]?.title, "exp_uppercase");
  assert.equal(experiments[0]?.summary?.endsWith("..."), true);

  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"));
  try {
    assert.deepEqual(buildOverviewWeeklyStats(vault, "UTC"), [
      {
        currentWeekAvg: 50,
        deltaPercent: null,
        previousWeekAvg: null,
        stream: "hrv",
        unit: "ms",
      },
      {
        currentWeekAvg: 5,
        deltaPercent: null,
        previousWeekAvg: 0,
        stream: "readiness",
        unit: null,
      },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

test("readVaultSourceTolerant keeps sparse vault layouts but hard-cuts legacy relation and file aliases", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-vault-source-"));
  tempRoots.push(vaultRoot);

  await writeVaultFile(
    vaultRoot,
    VAULT_LAYOUT.metadata,
    JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01K5JZ6C0D9F5RSM6X1H0M2Q3A",
      createdAt: "2026-04-01T00:00:00.000Z",
      title: "Coverage vault",
      timezone: "UTC",
    }),
  );
  await writeVaultFile(
    vaultRoot,
    VAULT_LAYOUT.coreDocument,
      [
        "---",
        "title: Core overview",
        "updatedAt: 2026-04-07T00:00:00.000Z",
        "updated_at: 2026-04-07T00:00:00.000Z",
        "tags:",
        "  - planning",
      "---",
      "",
      "# Core overview",
      "",
      "Canonical overview body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.experimentsDirectory, "magnesium-trial.md"),
    [
      "---",
      "experimentId: exp_magnesium",
      "slug: magnesium-trial",
      "title: Magnesium trial",
      "status: active",
      "startedOn: 2026-04-03",
      "started_on: 2026-04-03",
      "updatedAt: 2026-04-08T00:00:00.000Z",
      "updated_at: 2026-04-08T00:00:00.000Z",
      "tags:",
      "  - sleep",
      "relatedIds:",
      "  - goal_sleep",
      "eventIds:",
      "  - evt_note",
      "related_ids:",
      "  - ignored_goal",
      "event_ids:",
      "  - ignored_evt",
      "---",
      "",
      "# Magnesium trial",
      "",
      "Nightly supplementation notes.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.journalDirectory, "2026", "2026-04-08.md"),
      [
        "---",
        "title: April 8",
        "eventIds:",
        "  - evt_note",
        "sampleStreams:",
        "  - hrv",
        "relatedIds:",
        "  - goal_sleep",
        "event_ids:",
        "  - ignored_evt",
        "sample_streams:",
        "  - ignored_stream",
        "---",
      "",
      "# April 8",
      "",
      "Journal body.",
      "",
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.eventLedgerDirectory, "2026", "2026-04.jsonl"),
    [
      JSON.stringify({
        id: "evt_note",
        kind: "note",
        occurredAt: "2026-04-08T08:00:00.000Z",
        title: "Morning note",
        note: "Brief note.",
        links: [
          { type: "supports_goal", targetId: "goal_sleep" },
          { type: "related_to", targetId: "evt_related_alias" },
        ],
        relatedIds: ["ignored_goal"],
        eventIds: ["ignored_evt_alias"],
        related_ids: ["ignored_goal"],
        event_ids: ["ignored_evt"],
        raw_refs: ["raw/unused.json"],
        audio_paths: ["audio.m4a"],
        photo_paths: ["photo.jpg"],
        attachments: [null, { role: "media_1", kind: "photo" }],
      }),
      JSON.stringify({
        id: "aud_shadow",
        kind: "encounter",
        occurredAt: "2026-04-08T09:00:00.000Z",
        title: "Health encounter",
      }),
    ].join("\n"),
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.sampleLedgerDirectory, "2026", "2026-04.jsonl"),
    JSON.stringify({
      id: "samp_hrv_01",
      recordedAt: "2026-04-08T06:00:00.000Z",
      stream: "hrv",
      quality: "measured",
      relatedIds: ["goal_sleep"],
      value: 52,
      unit: "ms",
    }),
  );
  await writeVaultFile(
    vaultRoot,
    path.posix.join(VAULT_LAYOUT.auditDirectory, "2026", "2026-04.jsonl"),
    JSON.stringify({
      id: "audit_01",
      occurredAt: "2026-04-08T10:00:00.000Z",
      summary: "Projection rebuilt",
    }),
  );

  const snapshot = await readVaultSourceTolerant(vaultRoot);
  const families = [...new Set(snapshot.entities.map((entity) => entity.family))];

  assert.equal(snapshot.metadata?.vaultId, "vault_01K5JZ6C0D9F5RSM6X1H0M2Q3A");
  assert.deepEqual(families.sort(), ["audit", "core", "event", "experiment", "journal", "sample"]);

  const core = snapshot.entities.find((entity) => entity.family === "core");
  assert.equal(core?.title, "Core overview");
  assert.deepEqual(core?.tags, ["planning"]);
  assert.equal(core?.attributes.updated_at, undefined);

  const experiment = snapshot.entities.find((entity) => entity.family === "experiment");
  assert.equal(experiment?.date, "2026-04-03");
  assert.deepEqual(experiment?.relatedIds, []);
  assert.deepEqual(experiment?.tags, ["sleep"]);
  assert.equal(experiment?.attributes.started_on, undefined);
  assert.equal(experiment?.attributes.relatedIds, undefined);
  assert.equal(experiment?.attributes.eventIds, undefined);

  const journal = snapshot.entities.find((entity) => entity.family === "journal");
  assert.equal(journal?.date, "2026-04-08");
  assert.deepEqual(journal?.relatedIds, ["evt_note"]);
  assert.deepEqual(journal?.attributes.sampleStreams, ["hrv"]);
  assert.equal(journal?.attributes.event_ids, undefined);
  assert.equal(journal?.attributes.relatedIds, undefined);

  const event = snapshot.entities.find((entity) => entity.family === "event");
  assert.equal(event?.entityId, "evt_note");
  assert.deepEqual(event?.relatedIds, ["goal_sleep", "evt_related_alias"]);
  assert.equal(Array.isArray(event?.attributes.attachments), true);
  assert.equal(event?.attributes.audioPaths, undefined);
  assert.equal(event?.attributes.photoPaths, undefined);
  assert.equal(event?.attributes.relatedIds, undefined);
  assert.equal(event?.attributes.eventIds, undefined);
  assert.equal(event?.attributes.related_ids, undefined);

  const audit = snapshot.entities.find((entity) => entity.family === "audit");
  assert.equal(audit?.kind, "audit");
  assert.equal(audit?.title, "Projection rebuilt");
});

function createEntity(
  family: CanonicalEntity["family"],
  entityId: string,
  overrides: Partial<CanonicalEntity> = {},
): CanonicalEntity {
  return {
    entityId,
    primaryLookupId: entityId,
    lookupIds: [entityId],
    family,
    recordClass: resolveCanonicalRecordClass(family),
    kind: family,
    status: null,
    occurredAt: null,
    date: null,
    path: `${family}/${entityId}.md`,
    title: entityId,
    body: null,
    attributes: {},
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: null,
    tags: [],
    ...overrides,
  };
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${content}\n`, "utf8");
}
