import type {
  AllergyFrontmatter,
  AssessmentResponseRecord,
  AuditRecord,
  ConditionFrontmatter,
  CoreFrontmatter,
  EventRecord,
  ExperimentFrontmatter,
  FamilyMemberFrontmatter,
  GeneticVariantFrontmatter,
  GoalFrontmatter,
  JournalDayFrontmatter,
  ProfileCurrentFrontmatter,
  ProfileSnapshotRecord,
  RegimenFrontmatter,
  SampleRecord,
  VaultMetadata,
} from "./zod.js";

type FrontmatterExamples = {
  core: CoreFrontmatter;
  journalDay: JournalDayFrontmatter;
  experiment: ExperimentFrontmatter;
};

type HealthFrontmatterExamples = {
  allergy: AllergyFrontmatter;
  condition: ConditionFrontmatter;
  familyMember: FamilyMemberFrontmatter;
  geneticVariant: GeneticVariantFrontmatter;
  goal: GoalFrontmatter;
  profileCurrent: ProfileCurrentFrontmatter;
  regimen: RegimenFrontmatter;
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
      allergy: "alg",
      assessment: "asmt",
      audit: "aud",
      condition: "cond",
      document: "doc",
      event: "evt",
      experiment: "exp",
      family: "fam",
      goal: "goal",
      meal: "meal",
      pack: "pack",
      profileSnapshot: "psnap",
      provider: "prov",
      regimen: "reg",
      sample: "smp",
      transform: "xfm",
      variant: "var",
      vault: "vault",
    },
  },
  paths: {
    allergiesRoot: "bank/allergies",
    assessmentLedgerRoot: "ledger/assessments",
    conditionsRoot: "bank/conditions",
    coreDocument: "CORE.md",
    familyRoot: "bank/family",
    geneticsRoot: "bank/genetics",
    goalsRoot: "bank/goals",
    journalRoot: "journal",
    experimentsRoot: "bank/experiments",
    profileCurrentDocument: "bank/profile/current.md",
    profileRoot: "bank/profile",
    profileSnapshotsRoot: "ledger/profile-snapshots",
    providersRoot: "bank/providers",
    rawAssessmentsRoot: "raw/assessments",
    rawRoot: "raw",
    eventsRoot: "ledger/events",
    regimensRoot: "bank/regimens",
    samplesRoot: "ledger/samples",
    auditRoot: "audit",
    exportsRoot: "exports",
  },
  shards: {
    assessments: "ledger/assessments/YYYY/YYYY-MM.jsonl",
    events: "ledger/events/YYYY/YYYY-MM.jsonl",
    profileSnapshots: "ledger/profile-snapshots/YYYY/YYYY-MM.jsonl",
    samples: "ledger/samples/<stream>/YYYY/YYYY-MM.jsonl",
    audit: "audit/YYYY/YYYY-MM.jsonl",
  },
});

export const exampleEventRecords: readonly Readonly<EventRecord>[] = Object.freeze([
  {
    schemaVersion: "hb.event.v1",
    id: "evt_01JNV45RHN0TQ9ZXE0A7YSE1YQ",
    kind: "encounter",
    occurredAt: "2026-03-09T14:15:00Z",
    recordedAt: "2026-03-09T15:00:00Z",
    dayKey: "2026-03-09",
    source: "import",
    title: "Urgent care visit",
    encounterType: "urgent-care",
    location: "Downtown Urgent Care",
  },
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
    id: "evt_01JNV4628FSM6B5NQ8VJSEW415",
    kind: "procedure",
    occurredAt: "2026-03-10T10:00:00Z",
    recordedAt: "2026-03-10T10:05:00Z",
    dayKey: "2026-03-10",
    source: "import",
    title: "Knee arthroscopy",
    procedure: "right-knee-arthroscopy",
    status: "completed",
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
    id: "evt_01JNV46CSWT0AKB5D1PKR4F1S6",
    kind: "test",
    occurredAt: "2026-03-11T08:00:00Z",
    recordedAt: "2026-03-11T08:05:00Z",
    dayKey: "2026-03-11",
    source: "import",
    title: "Lipid panel",
    testName: "lipid-panel",
    resultStatus: "abnormal",
    summary: "LDL elevated above target range.",
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
    id: "evt_01JNV46VFEV8Q05M8NSEJ2MZXG",
    kind: "adverse_effect",
    occurredAt: "2026-03-12T09:00:00Z",
    recordedAt: "2026-03-12T09:02:00Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Nausea after supplement",
    substance: "Magnesium glycinate",
    effect: "nausea",
    severity: "mild",
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
    id: "evt_01JNV475C8F69A9D4G4H5WWEZR",
    kind: "exposure",
    occurredAt: "2026-03-12T19:00:00Z",
    recordedAt: "2026-03-12T19:03:00Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Basement mold cleanup",
    exposureType: "environmental",
    substance: "mold",
    duration: "45 minutes",
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

export const exampleAssessmentResponses: readonly Readonly<AssessmentResponseRecord>[] = Object.freeze([
  {
    schemaVersion: "hb.assessment-response.v1",
    id: "asmt_01JNV40W8VFYQ2H7CMJY5A9R4K",
    assessmentType: "full-intake",
    recordedAt: "2026-03-12T13:00:00Z",
    source: "import",
    rawPath: "raw/assessments/2026/03/asmt_01JNV40W8VFYQ2H7CMJY5A9R4K/source.json",
    title: "Comprehensive intake questionnaire",
    questionnaireSlug: "health-history-intake",
    responses: {
      goals: ["sleep", "energy"],
      sleep: {
        difficultyFallingAsleep: true,
        averageHours: 6.5,
      },
      caffeine: {
        servingsPerDay: 3,
      },
    },
    relatedIds: ["goal_01JNV41B483QH9GQ1Y08D7RMTA"],
  },
]);

export const exampleProfileSnapshots: readonly Readonly<ProfileSnapshotRecord>[] = Object.freeze([
  {
    schemaVersion: "hb.profile-snapshot.v1",
    id: "psnap_01JNV42F34M22V2PE9Q4KQ7H1X",
    recordedAt: "2026-03-12T13:05:00Z",
    source: "assessment_projection",
    sourceAssessmentIds: ["asmt_01JNV40W8VFYQ2H7CMJY5A9R4K"],
    sourceEventIds: ["evt_01JNV46VFEV8Q05M8NSEJ2MZXG"],
    profile: {
      summary: "Sleep is a primary concern and caffeine load is likely contributing.",
      highlights: ["Sleep latency is elevated", "Caffeine use remains high"],
      sleep: {
        averageHours: 6.5,
        difficultyFallingAsleep: true,
      },
      nutrition: {
        pattern: "omnivore",
      },
      substances: {
        caffeine: "3 servings daily",
      },
    },
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

export const exampleHealthFrontmatterObjects: Readonly<HealthFrontmatterExamples> = Object.freeze({
  profileCurrent: {
    schemaVersion: "hb.frontmatter.profile-current.v1",
    docType: "profile_current",
    snapshotId: "psnap_01JNV42F34M22V2PE9Q4KQ7H1X",
    updatedAt: "2026-03-12T13:05:00Z",
    sourceAssessmentIds: ["asmt_01JNV40W8VFYQ2H7CMJY5A9R4K"],
    sourceEventIds: ["evt_01JNV46VFEV8Q05M8NSEJ2MZXG"],
    topGoalIds: ["goal_01JNV43AK9SK58T6GX3DWRZH9Q"],
  },
  goal: {
    schemaVersion: "hb.frontmatter.goal.v1",
    docType: "goal",
    goalId: "goal_01JNV43AK9SK58T6GX3DWRZH9Q",
    slug: "improve-sleep",
    title: "Improve sleep quality and duration",
    status: "active",
    horizon: "long_term",
    priority: 1,
    window: {
      startAt: "2026-03-01",
      targetAt: "2026-06-01",
    },
    parentGoalId: null,
    relatedGoalIds: [],
    relatedExperimentIds: ["exp_01JNV4458HYPP53JDQCBP1QJFM"],
    domains: ["sleep", "energy"],
  },
  condition: {
    schemaVersion: "hb.frontmatter.condition.v1",
    docType: "condition",
    conditionId: "cond_01JNV43NDX1N7BX08NQ19MJ4DK",
    slug: "insomnia-symptoms",
    title: "Insomnia symptoms",
    clinicalStatus: "active",
    verificationStatus: "provisional",
    assertedOn: "2026-03-12",
    severity: "moderate",
    bodySites: [],
    relatedGoalIds: ["goal_01JNV43AK9SK58T6GX3DWRZH9Q"],
    relatedRegimenIds: ["reg_01JNV447V6K3SW1Q9NJ7XVQZ7P"],
    note: "Self-reported difficulty falling asleep at least four nights per week.",
  },
  allergy: {
    schemaVersion: "hb.frontmatter.allergy.v1",
    docType: "allergy",
    allergyId: "alg_01JNV43Y9ZV6EY1K9J7ZT4B9SC",
    slug: "penicillin",
    title: "Penicillin intolerance",
    substance: "Penicillin",
    status: "active",
    criticality: "high",
    reaction: "rash",
    recordedOn: "2026-03-12",
    relatedConditionIds: ["cond_01JNV43NDX1N7BX08NQ19MJ4DK"],
    note: "Historical reaction reported during intake.",
  },
  regimen: {
    schemaVersion: "hb.frontmatter.regimen.v1",
    docType: "regimen",
    regimenId: "reg_01JNV447V6K3SW1Q9NJ7XVQZ7P",
    slug: "magnesium-glycinate",
    title: "Magnesium glycinate",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-12",
    substance: "Magnesium glycinate",
    dose: 200,
    unit: "mg",
    schedule: "nightly",
    relatedGoalIds: ["goal_01JNV43AK9SK58T6GX3DWRZH9Q"],
    relatedConditionIds: ["cond_01JNV43NDX1N7BX08NQ19MJ4DK"],
  },
  familyMember: {
    schemaVersion: "hb.frontmatter.family-member.v1",
    docType: "family_member",
    familyMemberId: "fam_01JNV44J4HH2F9H5S0VRZ4QJEB",
    slug: "mother",
    title: "Mother",
    relationship: "mother",
    conditions: ["Type 2 diabetes", "Hypertension"],
    deceased: false,
    note: "Family history reported during intake.",
    relatedVariantIds: ["var_01JNV44WS3W0R27XPTKFC3QFJA"],
  },
  geneticVariant: {
    schemaVersion: "hb.frontmatter.genetic-variant.v1",
    docType: "genetic_variant",
    variantId: "var_01JNV44WS3W0R27XPTKFC3QFJA",
    slug: "mthfr-c677t",
    title: "MTHFR C677T",
    gene: "MTHFR",
    zygosity: "heterozygous",
    significance: "risk_factor",
    inheritance: "maternal report",
    sourceFamilyMemberIds: ["fam_01JNV44J4HH2F9H5S0VRZ4QJEB"],
    note: "Reported from prior direct-to-consumer genetics summary.",
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
