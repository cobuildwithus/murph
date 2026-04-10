import { CURRENT_VAULT_FORMAT_VERSION } from "./constants.ts";

import type {
  AllergyFrontmatter,
  AssessmentResponseRecord,
  AuditRecord,
  ConditionFrontmatter,
  CoreFrontmatter,
  EventRecord,
  ExperimentFrontmatter,
  FamilyMemberFrontmatter,
  FoodFrontmatter,
  GeneticVariantFrontmatter,
  GoalFrontmatter,
  InboxCaptureRecord,
  JournalDayFrontmatter,
  ProviderFrontmatter,
  RecipeFrontmatter,
  ProtocolFrontmatter,
  WorkoutFormatFrontmatter,
  SampleRecord,
  VaultMetadata,
} from "./zod.ts";

type FrontmatterExamples = {
  core: CoreFrontmatter;
  journalDay: JournalDayFrontmatter;
  experiment: ExperimentFrontmatter;
  food: FoodFrontmatter;
  provider: ProviderFrontmatter;
  recipe: RecipeFrontmatter;
  workoutFormat: WorkoutFormatFrontmatter;
};

type HealthFrontmatterExamples = {
  allergy: AllergyFrontmatter;
  condition: ConditionFrontmatter;
  familyMember: FamilyMemberFrontmatter;
  geneticVariant: GeneticVariantFrontmatter;
  goal: GoalFrontmatter;
  protocol: ProtocolFrontmatter;
};

export const exampleVaultMetadata: Readonly<VaultMetadata> = Object.freeze<VaultMetadata>({
  formatVersion: CURRENT_VAULT_FORMAT_VERSION,
  vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
  createdAt: "2026-03-12T14:00:00Z",
  title: "Murph Vault",
  timezone: "America/New_York",
});

export const exampleInboxCaptureRecords: readonly Readonly<InboxCaptureRecord>[] = Object.freeze([
  {
    schemaVersion: "murph.inbox-capture.v1",
    captureId: "cap_3f9f0d778d89c3beec6b8a13dc",
    identityKey: "telegram\u0000bot\u0000msg-123",
    eventId: "evt_01JNV41B483QH9GQ1Y08D7RMTA",
    source: "telegram",
    accountId: "bot",
    externalId: "msg-123",
    thread: {
      id: "chat-123",
      title: "Breakfast",
      isDirect: true,
    },
    actor: {
      id: "contact-1",
      displayName: "Friend",
      isSelf: false,
    },
    occurredAt: "2026-03-12T08:15:00Z",
    recordedAt: "2026-03-12T08:16:00Z",
    receivedAt: "2026-03-12T08:16:04Z",
    text: "Breakfast photo and note",
    raw: {
      source: "telegram",
      attachmentCount: 1,
    },
    sourceDirectory: "raw/inbox/telegram/bot/2026/03/cap_3f9f0d778d89c3beec6b8a13dc",
    envelopePath: "raw/inbox/telegram/bot/2026/03/cap_3f9f0d778d89c3beec6b8a13dc/envelope.json",
    rawRefs: [
      "raw/inbox/telegram/bot/2026/03/cap_3f9f0d778d89c3beec6b8a13dc/envelope.json",
      "raw/inbox/telegram/bot/2026/03/cap_3f9f0d778d89c3beec6b8a13dc/attachments/01__breakfast.jpg",
    ],
    attachments: [
      {
        attachmentId: "att_cap_3f9f0d778d89c3beec6b8a13dc_01",
        ordinal: 1,
        externalId: "att-1",
        kind: "image",
        mime: "image/jpeg",
        originalPath: null,
        fileName: "breakfast.jpg",
        byteSize: 12345,
        storedPath: "raw/inbox/telegram/bot/2026/03/cap_3f9f0d778d89c3beec6b8a13dc/attachments/01__breakfast.jpg",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
  },
]);

export const exampleEventRecords: readonly Readonly<EventRecord>[] = Object.freeze([
  {
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV41B483QH9GQ1Y08D7RMTA",
    kind: "document",
    occurredAt: "2026-03-12T08:15:00Z",
    recordedAt: "2026-03-12T08:16:00Z",
    dayKey: "2026-03-12",
    source: "import",
    title: "Primary care visit summary",
    tags: ["clinic", "pdf"],
    links: [{ type: "related_to", targetId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG" }],
    rawRefs: ["raw/documents/2026/03/doc_01JNV41Q9MN0S1R6ZMW7FGD9DG/visit-summary.pdf"],
    attachments: [
      {
        role: "source_document",
        kind: "document",
        relativePath: "raw/documents/2026/03/doc_01JNV41Q9MN0S1R6ZMW7FGD9DG/visit-summary.pdf",
        mediaType: "application/pdf",
        sha256: "1111111111111111111111111111111111111111111111111111111111111111",
        originalFileName: "visit-summary.pdf",
      },
    ],
    documentId: "doc_01JNV41Q9MN0S1R6ZMW7FGD9DG",
    mimeType: "application/pdf",
    providerId: "prov_01JNV422Y2M5ZBV64ZP4N1DRB1",
  },
  {
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV42F34M22V2PE9Q4KQ7H1X",
    kind: "meal",
    occurredAt: "2026-03-12T12:32:00Z",
    recordedAt: "2026-03-12T12:33:00Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Lunch bowl",
    note: "Chicken, rice, and avocado.",
    tags: ["meal", "lunch"],
    links: [{ type: "related_to", targetId: "meal_01JNV42NP0KH6JQXMZM1G0V6SE" }],
    rawRefs: ["raw/meals/2026/03/meal_01JNV42NP0KH6JQXMZM1G0V6SE/photo-01.jpg"],
    attachments: [
      {
        role: "photo",
        kind: "photo",
        relativePath: "raw/meals/2026/03/meal_01JNV42NP0KH6JQXMZM1G0V6SE/photo-01.jpg",
        mediaType: "image/jpeg",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        originalFileName: "photo-01.jpg",
      },
    ],
    mealId: "meal_01JNV42NP0KH6JQXMZM1G0V6SE",
  },
  {
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV43Y9ZV6EY1K9J7ZT4B9SC",
    kind: "experiment_event",
    occurredAt: "2026-03-12T06:00:00Z",
    recordedAt: "2026-03-12T06:00:10Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Magnesium trial started",
    links: [{ type: "related_to", targetId: "exp_01JNV4458HYPP53JDQCBP1QJFM" }],
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFM",
    experimentSlug: "magnesium-sleep",
    phase: "start",
  },
  {
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
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
    schemaVersion: "murph.event.v1",
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
    workout: {
      sourceApp: "oura",
      sourceWorkoutId: "walk-01JNV44WS3W0R27XPTKFC3QFJA",
      startedAt: "2026-03-12T17:18:00Z",
      endedAt: "2026-03-12T18:00:00Z",
      sessionNote: "Evening walk",
      exercises: [],
    },
  },
  {
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV44WS3W0R27XPTKFC3QFJB",
    kind: "activity_session",
    occurredAt: "2026-03-12T17:55:00Z",
    recordedAt: "2026-03-12T18:02:00Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Push Day A",
    note: "Paused the first rep on each work set.",
    activityType: "strength-training",
    durationMinutes: 20,
    attachments: [
      {
        role: "media_1",
        kind: "photo",
        relativePath: "raw/workouts/2026/03/evt_01JNV44WS3W0R27XPTKFC3QFJB/progress-front.jpg",
        mediaType: "image/jpeg",
        sha256: "3333333333333333333333333333333333333333333333333333333333333333",
        originalFileName: "progress-front.jpg",
      },
    ],
    rawRefs: [
      "raw/workouts/2026/03/evt_01JNV44WS3W0R27XPTKFC3QFJB/progress-front.jpg"
    ],
    workout: {
      sourceApp: "manual",
      startedAt: "2026-03-12T17:55:00Z",
      endedAt: "2026-03-12T18:15:00Z",
      routineId: "wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1",
      routineName: "Push Day A",
      sessionNote: "Paused the first rep on each work set.",
      media: [
        {
          kind: "photo",
          relativePath: "raw/workouts/2026/03/evt_01JNV44WS3W0R27XPTKFC3QFJB/progress-front.jpg",
          mediaType: "image/jpeg",
        }
      ],
      exercises: [
        {
          name: "Pushups",
          order: 1,
          mode: "bodyweight",
          note: "Controlled tempo",
          sets: [
            { order: 1, reps: 20 },
            { order: 2, reps: 20 },
            { order: 3, reps: 20 },
            { order: 4, reps: 20 }
          ]
        },
        {
          name: "Incline Bench Press",
          order: 2,
          mode: "weight_reps",
          unitOverride: "lb",
          sets: [
            { order: 1, type: "warmup", reps: 12, weight: 45, weightUnit: "lb" },
            { order: 2, reps: 12, weight: 65, weightUnit: "lb", rpe: 8 },
            { order: 3, reps: 12, weight: 65, weightUnit: "lb", rpe: 8 },
            { order: 4, reps: 12, weight: 65, weightUnit: "lb", rpe: 9 }
          ]
        }
      ]
    }
  },
  {
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV450A1B2C3D4E5F6G7H8JK",
    kind: "body_measurement",
    occurredAt: "2026-03-12T07:00:00Z",
    recordedAt: "2026-03-12T07:00:10Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "Weekly check-in",
    note: "Morning fasted check-in.",
    attachments: [
      {
        role: "media_1",
        kind: "photo",
        relativePath: "raw/measurements/2026/03/evt_01JNV450A1B2C3D4E5F6G7H8JK/front.jpg",
        mediaType: "image/jpeg",
        sha256: "4444444444444444444444444444444444444444444444444444444444444444",
        originalFileName: "front.jpg",
      }
    ],
    measurements: [
      { type: "weight", value: 182.4, unit: "lb" },
      { type: "waist", value: 33.5, unit: "in" },
      { type: "body_fat_pct", value: 18.2, unit: "percent" }
    ],
    media: [
      {
        kind: "photo",
        relativePath: "raw/measurements/2026/03/evt_01JNV450A1B2C3D4E5F6G7H8JK/front.jpg",
        mediaType: "image/jpeg",
      }
    ],
    rawRefs: [
      "raw/measurements/2026/03/evt_01JNV450A1B2C3D4E5F6G7H8JK/front.jpg"
    ],
  },
  {
    schemaVersion: "murph.event.v1",
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
  {
    schemaVersion: "murph.event.v1",
    id: "evt_01JNV45XJ4M22V2PE9Q4KQ7H1X",
    kind: "intervention_session",
    occurredAt: "2026-03-12T19:30:00Z",
    recordedAt: "2026-03-12T19:30:15Z",
    dayKey: "2026-03-12",
    source: "manual",
    title: "20-minute sauna",
    note: "20 min sauna after lifting.",
    links: [{ type: "related_to", targetId: "prot_01JNV422Y2M5ZBV64ZP4N1DRB1" }],
    interventionType: "sauna",
    durationMinutes: 20,
    protocolId: "prot_01JNV422Y2M5ZBV64ZP4N1DRB1",
  },
]);

export const exampleSampleRecords: readonly Readonly<SampleRecord>[] = Object.freeze([
  {
    schemaVersion: "murph.sample.v1",
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
    schemaVersion: "murph.sample.v1",
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
    schemaVersion: "murph.sample.v1",
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
    schemaVersion: "murph.sample.v1",
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
    schemaVersion: "murph.sample.v1",
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
    schemaVersion: "murph.sample.v1",
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
    schemaVersion: "murph.sample.v1",
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
    schemaVersion: "murph.audit.v1",
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
    schemaVersion: "murph.audit.v1",
    id: "aud_01JNV48RFKQE89MG73CSDM3M6G",
    action: "validate",
    status: "failure",
    occurredAt: "2026-03-12T18:00:00Z",
    actor: "core",
    commandName: "vault-cli validate",
    summary: "Rejected a sample shard with an unsupported stream name.",
    errorCode: "ENUM_UNSUPPORTED",
    changes: [],
  },
]);

export const exampleAssessmentResponses: readonly Readonly<AssessmentResponseRecord>[] = Object.freeze([
  {
    schemaVersion: "murph.assessment-response.v1",
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

export const exampleFrontmatterObjects: Readonly<FrontmatterExamples> = Object.freeze({
  core: {
    schemaVersion: "murph.frontmatter.core.v1",
    docType: "core",
    vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
    title: "Murph Vault",
    timezone: "America/New_York",
    updatedAt: "2026-03-12T20:00:00Z",
    activeExperimentSlugs: ["magnesium-sleep"],
  },
  journalDay: {
    schemaVersion: "murph.frontmatter.journal-day.v1",
    docType: "journal_day",
    dayKey: "2026-03-12",
    eventIds: ["evt_01JNV42F34M22V2PE9Q4KQ7H1X", "evt_01JNV43AK9SK58T6GX3DWRZH9Q"],
    sampleStreams: ["heart_rate", "steps", "glucose"],
  },
  experiment: {
    schemaVersion: "murph.frontmatter.experiment.v1",
    docType: "experiment",
    experimentId: "exp_01JNV4458HYPP53JDQCBP1QJFM",
    slug: "magnesium-sleep",
    status: "active",
    title: "Magnesium for sleep onset",
    startedOn: "2026-03-12",
    hypothesis: "Evening magnesium reduces time to fall asleep.",
    tags: ["sleep", "supplement"],
  },
  food: {
    schemaVersion: "murph.frontmatter.food.v1",
    docType: "food",
    foodId: "food_01JNV422Y2M5ZBV64ZP4N1DRB1",
    slug: "regular-acai-bowl",
    title: "Regular Acai Bowl",
    status: "active",
    summary: "The usual acai bowl order from the neighborhood spot with repeat toppings.",
    kind: "acai bowl",
    vendor: "Neighborhood Acai Bar",
    location: "Brooklyn, NY",
    serving: "1 bowl",
    aliases: ["regular acai bowl", "usual acai bowl"],
    ingredients: [
      "acai base",
      "banana",
      "strawberries",
      "granola",
      "almond butter",
    ],
    tags: ["breakfast", "favorite"],
    note: "Typical order includes extra granola and no honey.",
    autoLogDaily: {
      time: "08:00",
    },
  },
  provider: {
    schemaVersion: "murph.frontmatter.provider.v1",
    docType: "provider",
    providerId: "prov_01JNV422Y2M5ZBV64ZP4N1DRB1",
    slug: "primary-care-clinic",
    title: "Primary Care Clinic",
    status: "active",
    specialty: "primary-care",
    organization: "Murph Medical Group",
    location: "New York, NY",
    website: "https://example.com/providers/primary-care-clinic",
    phone: "+1-555-0100",
    note: "Preferred clinic for annual wellness visits.",
    aliases: ["HBC Primary Care"],
  },
  recipe: {
    schemaVersion: "murph.frontmatter.recipe.v1",
    docType: "recipe",
    recipeId: "rcp_01JNV422Y2M5ZBV64ZP4N1DRB1",
    slug: "sheet-pan-salmon-bowls",
    title: "Sheet Pan Salmon Bowls",
    status: "saved",
    summary: "A reliable high-protein salmon bowl with roasted vegetables and rice.",
    cuisine: "mediterranean",
    dishType: "dinner",
    source: "Family weeknight rotation",
    servings: 2,
    prepTimeMinutes: 15,
    cookTimeMinutes: 20,
    totalTimeMinutes: 35,
    tags: ["high-protein", "weeknight"],
    ingredients: [
      "2 salmon fillets",
      "2 cups cooked rice",
      "2 cups broccoli florets",
      "1 tbsp olive oil",
      "1 lemon",
    ],
    steps: [
      "Heat the oven to 220C and line a sheet pan.",
      "Toss the broccoli with olive oil and roast for 10 minutes.",
      "Add the salmon, season, and roast until cooked through.",
      "Serve over rice with lemon juice and any pan juices.",
    ],
    relatedGoalIds: ["goal_01JNV43AK9SK58T6GX3DWRZH9Q"],
    relatedConditionIds: ["cond_01JNV43NDX1N7BX08NQ19MJ4DK"],
  },
  workoutFormat: {
    schemaVersion: "murph.frontmatter.workout-format.v1",
    docType: "workout_format",
    workoutFormatId: "wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1",
    slug: "push-day-a",
    title: "Push Day A",
    status: "active",
    summary: "Default push-focused strength session I repeat most weeks.",
    activityType: "strength-training",
    durationMinutes: 45,
    template: {
      routineNote: "Add one extra triceps set if the session feels easy.",
      exercises: [
        {
          name: "Pushups",
          order: 1,
          mode: "bodyweight",
          note: "Controlled tempo",
          plannedSets: [
            { order: 1, targetReps: 20 },
            { order: 2, targetReps: 20 },
            { order: 3, targetReps: 20 },
            { order: 4, targetReps: 20 }
          ]
        },
        {
          name: "Incline Bench Press",
          order: 2,
          mode: "weight_reps",
          unitOverride: "lb",
          plannedSets: [
            { order: 1, type: "warmup", targetReps: 12, targetWeight: 45, targetWeightUnit: "lb" },
            { order: 2, targetReps: 12, targetWeight: 65, targetWeightUnit: "lb", targetRpe: 8 },
            { order: 3, targetReps: 12, targetWeight: 65, targetWeightUnit: "lb", targetRpe: 8 },
            { order: 4, targetReps: 12, targetWeight: 65, targetWeightUnit: "lb", targetRpe: 9 }
          ]
        }
      ]
    },
    tags: ["gym", "strength"],
    note: "Usual push session when I do not need to vary the lifts.",
  },
});

export const exampleHealthFrontmatterObjects: Readonly<HealthFrontmatterExamples> = Object.freeze({
  goal: {
    schemaVersion: "murph.frontmatter.goal.v1",
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
    schemaVersion: "murph.frontmatter.condition.v1",
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
    relatedProtocolIds: ["prot_01JNV447V6K3SW1Q9NJ7XVQZ7P"],
    note: "Self-reported difficulty falling asleep at least four nights per week.",
  },
  allergy: {
    schemaVersion: "murph.frontmatter.allergy.v1",
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
  protocol: {
    schemaVersion: "murph.frontmatter.protocol.v1",
    docType: "protocol",
    protocolId: "prot_01JNV447V6K3SW1Q9NJ7XVQZ7P",
    slug: "magnesium-glycinate",
    title: "Magnesium glycinate",
    kind: "supplement",
    status: "active",
    startedOn: "2026-03-12",
    substance: "Magnesium glycinate",
    dose: 200,
    unit: "mg",
    schedule: "nightly",
    brand: "Thorne",
    manufacturer: "Thorne Health",
    servingSize: "2 capsules",
    ingredients: [
      {
        compound: "Magnesium",
        label: "Magnesium glycinate chelate",
        amount: 200,
        unit: "mg",
      },
      {
        compound: "Glycine",
        amount: 1000,
        unit: "mg",
        note: "Approximate amino acid contribution from the chelate.",
      },
    ],
    relatedGoalIds: ["goal_01JNV43AK9SK58T6GX3DWRZH9Q"],
    relatedConditionIds: ["cond_01JNV43NDX1N7BX08NQ19MJ4DK"],
  },
  familyMember: {
    schemaVersion: "murph.frontmatter.family-member.v1",
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
    schemaVersion: "murph.frontmatter.genetic-variant.v1",
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
schemaVersion: murph.frontmatter.core.v1
docType: core
vaultId: vault_01JNV40W8VFYQ2H7CMJY5A9R4K
title: Murph Vault
timezone: America/New_York
updatedAt: 2026-03-12T20:00:00Z
activeExperimentSlugs:
  - magnesium-sleep
---

# Core Summary
`,
  journalDay: `---
schemaVersion: murph.frontmatter.journal-day.v1
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
schemaVersion: murph.frontmatter.experiment.v1
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
  food: `---
schemaVersion: murph.frontmatter.food.v1
docType: food
foodId: food_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: regular-acai-bowl
title: Regular Acai Bowl
status: active
summary: The usual acai bowl order from the neighborhood spot with repeat toppings.
kind: acai bowl
vendor: Neighborhood Acai Bar
location: Brooklyn, NY
serving: 1 bowl
aliases:
  - regular acai bowl
  - usual acai bowl
ingredients:
  - acai base
  - banana
  - strawberries
  - granola
  - almond butter
tags:
  - breakfast
  - favorite
note: Typical order includes extra granola and no honey.
autoLogDaily:
  time: 08:00
---

# Regular Acai Bowl
`,
  provider: `---
schemaVersion: murph.frontmatter.provider.v1
docType: provider
providerId: prov_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: primary-care-clinic
title: Primary Care Clinic
status: active
specialty: primary-care
organization: Murph Medical Group
location: New York, NY
website: https://example.com/providers/primary-care-clinic
phone: +1-555-0100
note: Preferred clinic for annual wellness visits.
aliases:
  - HBC Primary Care
---

# Primary Care Clinic
`,
  recipe: `---
schemaVersion: murph.frontmatter.recipe.v1
docType: recipe
recipeId: rcp_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: sheet-pan-salmon-bowls
title: Sheet Pan Salmon Bowls
status: saved
summary: A reliable high-protein salmon bowl with roasted vegetables and rice.
cuisine: mediterranean
dishType: dinner
source: Family weeknight rotation
servings: 2
prepTimeMinutes: 15
cookTimeMinutes: 20
totalTimeMinutes: 35
tags:
  - high-protein
  - weeknight
ingredients:
  - 2 salmon fillets
  - 2 cups cooked rice
  - 2 cups broccoli florets
  - 1 tbsp olive oil
  - 1 lemon
steps:
  - Heat the oven to 220C and line a sheet pan.
  - Toss the broccoli with olive oil and roast for 10 minutes.
  - Add the salmon, season, and roast until cooked through.
  - Serve over rice with lemon juice and any pan juices.
relatedGoalIds:
  - goal_01JNV43AK9SK58T6GX3DWRZH9Q
relatedConditionIds:
  - cond_01JNV43NDX1N7BX08NQ19MJ4DK
---

# Sheet Pan Salmon Bowls
`,
  workoutFormat: `---
schemaVersion: murph.frontmatter.workout-format.v1
docType: workout_format
workoutFormatId: wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1
slug: push-day-a
title: Push Day A
status: active
summary: Default push-focused strength session I repeat most weeks.
activityType: strength-training
durationMinutes: 45
template:
  routineNote: Add one extra triceps set if the session feels easy.
  exercises:
    -
      name: Pushups
      order: 1
      mode: bodyweight
      note: Controlled tempo
      plannedSets:
        -
          order: 1
          targetReps: 20
        -
          order: 2
          targetReps: 20
        -
          order: 3
          targetReps: 20
        -
          order: 4
          targetReps: 20
    -
      name: Incline Bench Press
      order: 2
      mode: weight_reps
      unitOverride: lb
      plannedSets:
        -
          order: 1
          type: warmup
          targetReps: 12
          targetWeight: 45
          targetWeightUnit: lb
        -
          order: 2
          targetReps: 12
          targetWeight: 65
          targetWeightUnit: lb
          targetRpe: 8
        -
          order: 3
          targetReps: 12
          targetWeight: 65
          targetWeightUnit: lb
          targetRpe: 8
        -
          order: 4
          targetReps: 12
          targetWeight: 65
          targetWeightUnit: lb
          targetRpe: 9
tags:
  - gym
  - strength
note: Usual push session when I do not need to vary the lifts.
---

# Push Day A
`,
});
