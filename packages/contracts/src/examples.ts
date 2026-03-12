import type {
  AuditRecord,
  CoreFrontmatter,
  EventRecord,
  ExperimentFrontmatter,
  JournalDayFrontmatter,
  SampleRecord,
  VaultMetadata,
} from "./types.js";

type FrontmatterExamples = {
  core: CoreFrontmatter;
  journalDay: JournalDayFrontmatter;
  experiment: ExperimentFrontmatter;
};

export const exampleVaultMetadata: Readonly<VaultMetadata> = Object.freeze<VaultMetadata>({
  schemaVersion: "hb.vault.v1",
  vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
  createdAt: "2026-03-12T14:00:00Z",
  title: "Healthy Bob Vault",
  timezone: "America/New_York",
  idPolicy: {
    format: "prefix_ulid",
    prefixes: {
      audit: "aud",
      document: "doc",
      event: "evt",
      experiment: "exp",
      meal: "meal",
      pack: "pack",
      provider: "prov",
      sample: "smp",
      transform: "xfm",
      vault: "vault",
    },
  },
  paths: {
    coreDocument: "CORE.md",
    journalRoot: "journal",
    experimentsRoot: "bank/experiments",
    providersRoot: "bank/providers",
    rawRoot: "raw",
    eventsRoot: "ledger/events",
    samplesRoot: "ledger/samples",
    auditRoot: "audit",
    exportsRoot: "exports",
  },
  shards: {
    events: "ledger/events/YYYY/YYYY-MM.jsonl",
    samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
    audit: "audit/YYYY/YYYY-MM.jsonl",
  },
});

export const exampleEventRecords: readonly Readonly<EventRecord>[] = Object.freeze([
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV41B483QH9GQ1Y08D7RMTA",
    kind: "document",
    occurredAt: "2026-03-12T08:15:00Z",
    recordedAt: "2026-03-12T08:16:00Z",
    dayKey: "2026-03-12",
    source: "import",
    title: "Primary care visit summary",
    tags: ["clinic", "pdf"],
    relatedIds: ["doc_01JNV41Q9MN0S1R6ZMW7FGD9DG"],
    rawRefs: ["raw/documents/2026/03/doc_01JNV41Q9MN0S1R6ZMW7FGD9DG/visit-summary.pdf"],
    documentId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG",
    documentPath: "raw/documents/2026/03/doc_01JNV41Q9MN0S1R6ZMW7FGD9DG/visit-summary.pdf",
    mimeType: "application/pdf",
    providerId: "prov_01JNV422Y2M5ZBV64ZP4N1DRB1",
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV42F34M22V2PE9Q4KQ7H1X",
    kind: "meal",
    occurredAt: "2026-03-12T12:32:00Z",
    recordedAt: "2026-03-12T12:33:00Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Lunch bowl",
    note: "Chicken, rice, and avocado.",
    tags: ["meal", "lunch"],
    relatedIds: ["meal_01JNV42NP0KH6JQXMZM1G0V6SE"],
    rawRefs: ["raw/meals/2026/03/meal_01JNV42NP0KH6JQXMZM1G0V6SE/photo-01.jpg"],
    mealId: "meal_01JNV42NP0KH6JQXMZM1G0V6SE",
    photoPaths: ["raw/meals/2026/03/meal_01JNV42NP0KH6JQXMZM1G0V6SE/photo-01.jpg"],
    audioPaths: [],
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV4303N61Y40QAHGM4ZHPD7",
    kind: "symptom",
    occurredAt: "2026-03-12T13:05:00Z",
    recordedAt: "2026-03-12T13:05:30Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Headache after lunch",
    tags: ["symptom"],
    symptom: "headache",
    intensity: 4,
    bodySite: "temples",
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV43AK9SK58T6GX3DWRZH9Q",
    kind: "note",
    occurredAt: "2026-03-12T14:10:00Z",
    recordedAt: "2026-03-12T14:10:05Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "General note",
    note: "Energy stayed steady through the afternoon.",
    tags: ["note"],
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV43NDX1N7BX08NQ19MJ4DK",
    kind: "observation",
    occurredAt: "2026-03-12T15:00:00Z",
    recordedAt: "2026-03-12T15:00:05Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Post-walk blood pressure",
    metric: "blood-pressure-systolic",
    value: 118,
    unit: "mmHg",
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV43Y9ZV6EY1K9J7ZT4B9SC",
    kind: "experiment_event",
    occurredAt: "2026-03-12T06:00:00Z",
    recordedAt: "2026-03-12T06:00:10Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Magnesium trial started",
    relatedIds: ["exp_01JNV4458HYPP53JDQCBP1QJFM"],
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFM",
    experimentSlug: "magnesium-sleep",
    phase: "start",
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV447V6K3SW1Q9NJ7XVQZ7P",
    kind: "medication_intake",
    occurredAt: "2026-03-12T07:00:00Z",
    recordedAt: "2026-03-12T07:00:10Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Prescription dose",
    medicationName: "Lisinopril",
    dose: 10,
    unit: "mg",
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV44J4HH2F9H5S0VRZ4QJEB",
    kind: "supplement_intake",
    occurredAt: "2026-03-12T21:00:00Z",
    recordedAt: "2026-03-12T21:00:10Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Evening magnesium",
    supplementName: "Magnesium glycinate",
    dose: 200,
    unit: "mg",
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV44WS3W0R27XPTKFC3QFJA",
    kind: "activity_session",
    occurredAt: "2026-03-12T17:30:00Z",
    recordedAt: "2026-03-12T17:30:30Z",
    dayKey: "2026-03-12",
    source: "device",
    title: "Evening walk",
    activityType: "walk",
    durationMinutes: 42,
    distanceKm: 3.4,
  },
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV456CT4G36RE0B1VRCZ1M3",
    kind: "sleep_session",
    occurredAt: "2026-03-12T05:55:00Z",
    recordedAt: "2026-03-12T06:05:00Z",
    dayKey: "2026-03-12",
    source: "device",
    title: "Night sleep",
    startAt: "2026-03-11T22:40:00Z",
    endAt: "2026-03-12T05:55:00Z",
    durationMinutes: 435,
  },
]);

export const exampleSampleRecords: readonly Readonly<SampleRecord>[] = Object.freeze([
  {
    schemaVersion: "hb.sample.v1",
    id: "smp_01JNV45RHN0TQ9ZXE0A7YSE1YQ",
    stream: "heart_rate",
    recordedAt: "2026-03-12T17:32:00Z",
    dayKey: "2026-03-12",
    source: "device",
    quality: "raw",
    value: 92,
    unit: "bpm",
  },
  {
    schemaVersion: "hb.sample.v1",
    id: "smp_01JNV4628FSM6B5NQ8VJSEW415",
    stream: "hrv",
    recordedAt: "2026-03-12T06:01:00Z",
    dayKey: "2026-03-12",
    source: "device",
    quality: "normalized",
    value: 48.2,
    unit: "ms",
  },
  {
    schemaVersion: "hb.sample.v1",
    id: "smp_01JNV46CSWT0AKB5D1PKR4F1S6",
    stream: "steps",
    recordedAt: "2026-03-12T23:59:00Z",
    dayKey: "2026-03-12",
    source: "device",
    quality: "raw",
    value: 10432,
    unit: "count",
  },
  {
    schemaVersion: "hb.sample.v1",
    id: "smp_01JNV46VFEV8Q05M8NSEJ2MZXG",
    stream: "sleep_stage",
    recordedAt: "2026-03-12T03:10:00Z",
    dayKey: "2026-03-12",
    source: "device",
    quality: "raw",
    stage: "deep",
    startAt: "2026-03-12T03:00:00Z",
    endAt: "2026-03-12T03:30:00Z",
    durationMinutes: 30,
    unit: "stage",
  },
  {
    schemaVersion: "hb.sample.v1",
    id: "smp_01JNV475C8F69A9D4G4H5WWEZR",
    stream: "respiratory_rate",
    recordedAt: "2026-03-12T06:01:00Z",
    dayKey: "2026-03-12",
    source: "device",
    quality: "normalized",
    value: 14.6,
    unit: "breaths_per_minute",
  },
  {
    schemaVersion: "hb.sample.v1",
    id: "smp_01JNV47DWWHKJ9RN0MM7R6FBF8",
    stream: "temperature",
    recordedAt: "2026-03-12T06:01:00Z",
    dayKey: "2026-03-12",
    source: "device",
    quality: "normalized",
    value: 36.7,
    unit: "celsius",
  },
  {
    schemaVersion: "hb.sample.v1",
    id: "smp_01JNV47Q7KJ8Y6JAZ2RW1H7MYN",
    stream: "glucose",
    recordedAt: "2026-03-12T08:00:00Z",
    dayKey: "2026-03-12",
    source: "device",
    quality: "raw",
    value: 96,
    unit: "mg_dL",
  },
]);

export const exampleAuditRecords: readonly Readonly<AuditRecord>[] = Object.freeze([
  {
    schemaVersion: "hb.audit.v1",
    id: "aud_01JNV480C4MP7R7QX3T2Q1XMD1",
    action: "meal_add",
    status: "success",
    occurredAt: "2026-03-12T12:33:05Z",
    actor: "cli",
    commandName: "vault-cli meal add",
    summary: "Stored a meal event and copied one photo attachment.",
    targetIds: ["evt_01JNV42F34M22V2PE9Q4KQ7H1X", "meal_01JNV42NP0KH6JQXMZM1G0V6SE"],
    changes: [
      {
        path: "raw/meals/2026/03/meal_01JNV42NP0KH6JQXMZM1G0V6SE/photo-01.jpg",
        op: "copy",
      },
      {
        path: "ledger/events/2026/2026-03.jsonl",
        op: "append",
      },
    ],
  },
  {
    schemaVersion: "hb.audit.v1",
    id: "aud_01JNV48RFKQE89MG73CSDM3M6G",
    action: "validate",
    status: "failure",
    occurredAt: "2026-03-12T18:00:00Z",
    actor: "core",
    commandName: "vault-cli validate",
    summary: "Rejected a sample shard with an unsupported stream name.",
    errorCode: "HB_ENUM_UNSUPPORTED",
    changes: [],
  },
]);

export const exampleFrontmatterObjects: Readonly<FrontmatterExamples> = Object.freeze({
  core: {
    schemaVersion: "hb.frontmatter.core.v1",
    docType: "core",
    vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
    title: "Healthy Bob Vault",
    timezone: "America/New_York",
    updatedAt: "2026-03-12T20:00:00Z",
    activeExperimentSlugs: ["magnesium-sleep"],
  },
  journalDay: {
    schemaVersion: "hb.frontmatter.journal-day.v1",
    docType: "journal_day",
    dayKey: "2026-03-12",
    eventIds: ["evt_01JNV42F34M22V2PE9Q4KQ7H1X", "evt_01JNV43AK9SK58T6GX3DWRZH9Q"],
    sampleStreams: ["heart_rate", "steps", "glucose"],
  },
  experiment: {
    schemaVersion: "hb.frontmatter.experiment.v1",
    docType: "experiment",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFM",
    slug: "magnesium-sleep",
    status: "active",
    title: "Magnesium for sleep onset",
    startedOn: "2026-03-12",
    hypothesis: "Evening magnesium reduces time to fall asleep.",
    tags: ["sleep", "supplement"],
  },
});

export const exampleFrontmatterMarkdown: Readonly<Record<keyof FrontmatterExamples, string>> = Object.freeze({
  core: `---
schemaVersion: hb.frontmatter.core.v1
docType: core
vaultId: vault_01JNV40W8VFYQ2H7CMJY5A9R4K
title: Healthy Bob Vault
timezone: America/New_York
updatedAt: 2026-03-12T20:00:00Z
activeExperimentSlugs:
  - magnesium-sleep
---

# Core Summary
`,
  journalDay: `---
schemaVersion: hb.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-12
eventIds:
  - evt_01JNV42F34M22V2PE9Q4KQ7H1X
  - evt_01JNV43AK9SK58T6GX3DWRZH9Q
sampleStreams:
  - heart_rate
  - steps
  - glucose
---

# 2026-03-12
`,
  experiment: `---
schemaVersion: hb.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01JNV4458HYPP53JDQCBP1QJFM
slug: magnesium-sleep
status: active
title: Magnesium for sleep onset
startedOn: 2026-03-12
hypothesis: Evening magnesium reduces time to fall asleep.
tags:
  - sleep
  - supplement
---

# Magnesium For Sleep Onset
`,
});
