import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parseFrontmatterDocument } from "./health/shared.js";
import { getExperiment, listJournalEntries, listRecords } from "./model.js";
import type { VaultReadModel, VaultRecord } from "./model.js";
import { summarizeDailySamples } from "./summaries.js";
import type { DailySampleSummary } from "./summaries.js";
import type { FrontmatterObject } from "./health/shared.js";

export interface ExportPackFile {
  path: string;
  mediaType: "application/json" | "text/markdown";
  contents: string;
}

export interface ExportPackFilters {
  from: string | null;
  to: string | null;
  experimentSlug: string | null;
}

export interface ExportPackManifest {
  recordCount: number;
  experimentCount: number;
  journalCount: number;
  sampleSummaryCount: number;
  assessmentCount: number;
  profileSnapshotCount: number;
  historyEventCount: number;
  bankPageCount: number;
  questionCount: number;
  fileCount: number;
}

export interface QuestionPackInstructions {
  role: string;
  answerStyle: string;
  evidencePolicy: string;
}

export interface QuestionPackContextExperiment {
  id: string;
  slug: string | null;
  title: string | null;
  startedOn: string | null;
  tags: string[];
  body: string | null;
  sourcePath: string;
}

export interface QuestionPackContextJournal {
  id: string;
  date: string | null;
  title: string | null;
  summary: string | null;
  tags: string[];
  eventIds: string[];
  sampleStreams: string[];
  sourcePath: string;
}

export interface QuestionPackTimelineRecord {
  id: string;
  when: string;
  kind: string;
  recordType: VaultRecord["recordType"];
  title: string | null;
  summary: string;
  tags: string[];
  experimentSlug: string | null;
  sourcePath: string;
}

export interface ExportPackAssessmentRecord {
  id: string;
  title: string | null;
  assessmentType: string | null;
  recordedAt: string | null;
  importedAt: string | null;
  source: string | null;
  sourcePath: string | null;
  questionnaireSlug: string | null;
  relatedIds: string[];
  responses: Record<string, unknown>;
  relativePath: string;
}

export interface ExportPackProfileSnapshotRecord {
  id: string;
  recordedAt: string | null;
  source: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  profile: Record<string, unknown>;
  relativePath: string;
}

export interface ExportPackHistoryRecord {
  id: string;
  kind: string;
  occurredAt: string;
  recordedAt: string | null;
  source: string | null;
  title: string;
  status: string | null;
  tags: string[];
  relatedIds: string[];
  relativePath: string;
  data: Record<string, unknown>;
}

export interface ExportPackBankPage {
  id: string;
  slug: string;
  title: string | null;
  status: string | null;
  relativePath: string;
  markdown: string;
  body: string;
  attributes: FrontmatterObject;
}

export interface ExportPackCurrentProfile {
  snapshotId: string | null;
  updatedAt: string | null;
  sourceAssessmentIds: string[];
  sourceEventIds: string[];
  topGoalIds: string[];
  relativePath: string;
  markdown: string | null;
  body: string | null;
}

export interface ExportPackHealthContext {
  assessments: ExportPackAssessmentRecord[];
  profileSnapshots: ExportPackProfileSnapshotRecord[];
  historyEvents: ExportPackHistoryRecord[];
  currentProfile: ExportPackCurrentProfile | null;
  goals: ExportPackBankPage[];
  conditions: ExportPackBankPage[];
  allergies: ExportPackBankPage[];
  regimens: ExportPackBankPage[];
  familyMembers: ExportPackBankPage[];
  geneticVariants: ExportPackBankPage[];
}

export interface QuestionPackContext {
  experiment: QuestionPackContextExperiment | null;
  journals: QuestionPackContextJournal[];
  timeline: QuestionPackTimelineRecord[];
  dailySampleSummaries: DailySampleSummary[];
  health: ExportPackHealthContext;
}

export interface QuestionPack {
  format: "healthybob.question-pack.v1";
  packId: string;
  generatedAt: string;
  scope: ExportPackFilters;
  instructions: QuestionPackInstructions;
  questions: string[];
  context: QuestionPackContext;
}

export interface ExportPack {
  format: "healthybob.export-pack.v1";
  packId: string;
  basePath: string;
  generatedAt: string;
  filters: ExportPackFilters;
  manifest: ExportPackManifest;
  records: VaultRecord[];
  journalEntries: VaultRecord[];
  dailySampleSummaries: DailySampleSummary[];
  health: ExportPackHealthContext;
  questionPack: QuestionPack;
  files: ExportPackFile[];
}

export interface BuildExportPackOptions {
  from?: string;
  to?: string;
  experimentSlug?: string;
  packId?: string;
  generatedAt?: string;
}

interface QuestionPackBuildInput {
  packId: string;
  generatedAt: string;
  filters: ExportPackFilters;
  records: VaultRecord[];
  journalEntries: VaultRecord[];
  dailySampleSummaries: DailySampleSummary[];
  experimentRecord: VaultRecord | null;
  health: ExportPackHealthContext;
}

export function buildExportPack(
  vault: VaultReadModel,
  options: BuildExportPackOptions = {},
): ExportPack {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packId =
    options.packId ??
    [
      "pack",
      options.from ?? "start",
      options.to ?? "end",
      options.experimentSlug ?? "all",
    ]
      .join("-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
  const basePath = `exports/packs/${packId}`;
  const filters: ExportPackFilters = {
    from: options.from ?? null,
    to: options.to ?? null,
    experimentSlug: options.experimentSlug ?? null,
  };

  const records = listRecords(vault, {
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    experimentSlug: filters.experimentSlug ?? undefined,
  });
  const journalEntries = listJournalEntries(vault, {
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    experimentSlug: filters.experimentSlug ?? undefined,
  });
  const dailySampleSummaries = summarizeDailySamples(vault, {
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    experimentSlug: filters.experimentSlug ?? undefined,
  });
  const health = buildHealthContext(vault, filters);
  const experimentRecord = filters.experimentSlug
    ? getExperiment(vault, filters.experimentSlug)
    : null;

  const manifest: ExportPackManifest = {
    recordCount: records.length,
    experimentCount: experimentRecord ? 1 : vault.experiments.length,
    journalCount: journalEntries.length,
    sampleSummaryCount: dailySampleSummaries.length,
    assessmentCount: health.assessments.length,
    profileSnapshotCount: health.profileSnapshots.length,
    historyEventCount: health.historyEvents.length,
    bankPageCount: countHealthBankPages(health),
    questionCount: 0,
    fileCount: 0,
  };

  const questionPack = buildQuestionPack({
    packId,
    generatedAt,
    filters,
    records,
    journalEntries,
    dailySampleSummaries,
    experimentRecord,
    health,
  });
  manifest.questionCount = questionPack.questions.length;
  manifest.fileCount = 5;

  const files: ExportPackFile[] = [
    {
      path: `${basePath}/manifest.json`,
      mediaType: "application/json",
      contents: JSON.stringify(
        {
          format: "healthybob.export-pack.v1",
          packId,
          generatedAt,
          filters,
          manifest,
          health: summarizeHealthManifest(health),
          files: [
            {
              path: `${basePath}/manifest.json`,
              mediaType: "application/json",
              role: "manifest",
            },
            {
              path: `${basePath}/question-pack.json`,
              mediaType: "application/json",
              role: "question-pack",
            },
            {
              path: `${basePath}/records.json`,
              mediaType: "application/json",
              role: "records",
            },
            {
              path: `${basePath}/daily-samples.json`,
              mediaType: "application/json",
              role: "daily-samples",
            },
            {
              path: `${basePath}/assistant-context.md`,
              mediaType: "text/markdown",
              role: "assistant-context",
            },
          ],
        },
        null,
        2,
      ),
    },
    {
      path: `${basePath}/question-pack.json`,
      mediaType: "application/json",
      contents: JSON.stringify(questionPack, null, 2),
    },
    {
      path: `${basePath}/records.json`,
      mediaType: "application/json",
      contents: JSON.stringify(records, null, 2),
    },
    {
      path: `${basePath}/daily-samples.json`,
      mediaType: "application/json",
      contents: JSON.stringify(dailySampleSummaries, null, 2),
    },
    {
      path: `${basePath}/assistant-context.md`,
      mediaType: "text/markdown",
      contents: renderAssistantContext(questionPack),
    },
  ];

  return {
    format: "healthybob.export-pack.v1",
    packId,
    basePath,
    generatedAt,
    filters,
    manifest,
    records,
    journalEntries,
    dailySampleSummaries,
    health,
    questionPack,
    files,
  };
}

function renderAssistantContext(input: QuestionPack): string {
  const { packId, generatedAt, scope, instructions, questions, context } = input;

  const recordLines = context.timeline.slice(0, 50).map((record) => {
    return `- ${record.when} | ${record.kind} | ${record.id} | ${record.summary}`;
  });

  const summaryLines = context.dailySampleSummaries.map((summary) => {
    const averageValue =
      summary.averageValue === null ? "n/a" : String(summary.averageValue);
    const unitSuffix = summary.unit ? ` ${summary.unit}` : "";
    return `- ${summary.date} | ${summary.stream} | count=${summary.sampleCount} | avg=${averageValue}${unitSuffix}`;
  });
  const healthBankSectionCount = countHealthBankPages(context.health);

  const lines = [
    "# Healthy Bob Export Pack",
    "",
    `- Pack ID: ${packId}`,
    `- Generated At: ${generatedAt}`,
    `- From: ${scope.from ?? "unbounded"}`,
    `- To: ${scope.to ?? "unbounded"}`,
    `- Experiment: ${scope.experimentSlug ?? "all"}`,
    "",
  ];

  lines.push("## Prompt Instructions", "");
  lines.push(`- Role: ${instructions.role}`);
  lines.push(`- Answer Style: ${instructions.answerStyle}`);
  lines.push(`- Evidence Policy: ${instructions.evidencePolicy}`, "");

  lines.push("## Questions", "");
  for (const question of questions) {
    lines.push(`- ${question}`);
  }
  lines.push("");

  if (context.experiment) {
    lines.push("## Experiment Focus", "");
    lines.push(`- ${context.experiment.slug}`);
    if (context.experiment.title) {
      lines.push(`- Title: ${context.experiment.title}`);
    }
    if (context.experiment.startedOn) {
      lines.push(`- Started On: ${context.experiment.startedOn}`);
    }
    if (context.experiment.body) {
      lines.push("", context.experiment.body);
    }
    lines.push("");
  }

  if (context.journals.length > 0) {
    lines.push("## Journal Highlights", "");
    for (const journal of context.journals) {
      lines.push(`- ${journal.date} | ${journal.title}`);
      if (journal.summary) {
        lines.push(`  ${journal.summary}`);
      }
    }
    lines.push("");
  }

  lines.push("## Record Timeline", "", ...recordLines, "", "## Daily Sample Summaries", "");

  if (summaryLines.length > 0) {
    lines.push(...summaryLines);
  } else {
    lines.push("- No sample summaries in scope.");
  }

  lines.push("");

  if (context.health.assessments.length > 0) {
    lines.push("## Intake Assessments", "");
    for (const assessment of context.health.assessments) {
      lines.push(
        `- ${assessment.recordedAt ?? assessment.importedAt ?? "unknown-date"} | ${assessment.id} | ${assessment.title ?? assessment.assessmentType ?? "assessment"}`,
      );
    }
    lines.push("");
  }

  if (context.health.currentProfile) {
    lines.push("## Current Profile", "");
    lines.push(`- Snapshot: ${context.health.currentProfile.snapshotId ?? "none"}`);
    lines.push(`- Updated At: ${context.health.currentProfile.updatedAt ?? "unknown"}`);
    if (context.health.currentProfile.topGoalIds.length > 0) {
      lines.push(`- Top Goals: ${context.health.currentProfile.topGoalIds.join(", ")}`);
    }
    if (context.health.currentProfile.body) {
      lines.push("", context.health.currentProfile.body);
    }
    lines.push("");
  }

  if (context.health.historyEvents.length > 0) {
    lines.push("## Health History", "");
    for (const event of context.health.historyEvents.slice(0, 25)) {
      lines.push(`- ${event.occurredAt} | ${event.kind} | ${event.title}`);
    }
    lines.push("");
  }

  if (healthBankSectionCount > 0) {
    lines.push("## Health Registries", "");
    pushRegistrySection(lines, "Goals", context.health.goals);
    pushRegistrySection(lines, "Conditions", context.health.conditions);
    pushRegistrySection(lines, "Allergies", context.health.allergies);
    pushRegistrySection(lines, "Regimens", context.health.regimens);
    pushRegistrySection(lines, "Family", context.health.familyMembers);
    pushRegistrySection(lines, "Genetics", context.health.geneticVariants);
  }

  lines.push("");
  return lines.join("\n");
}

function buildQuestionPack(input: QuestionPackBuildInput): QuestionPack {
  const {
    packId,
    generatedAt,
    filters,
    records,
    journalEntries,
    dailySampleSummaries,
    experimentRecord,
    health,
  } = input;

  return {
    format: "healthybob.question-pack.v1",
    packId,
    generatedAt,
    scope: filters,
    instructions: {
      role: "Answer as a careful health-record analyst using only the supplied export context.",
      answerStyle:
        "Be concise, explicitly note uncertainty, and prefer dated observations over generalities.",
      evidencePolicy:
        "Cite the provided journal notes, record timeline, and daily sample summaries instead of guessing.",
    },
    questions: buildPromptQuestions({
      filters,
      records,
      journalEntries,
      dailySampleSummaries,
      experimentRecord,
      health,
    }),
    context: {
      experiment: experimentRecord ? summarizeExperiment(experimentRecord) : null,
      journals: journalEntries.map(summarizeJournalEntry),
      timeline: records.map(summarizeTimelineRecord),
      dailySampleSummaries,
      health,
    },
  };
}

function buildPromptQuestions(input: {
  filters: ExportPackFilters;
  records: VaultRecord[];
  journalEntries: VaultRecord[];
  dailySampleSummaries: DailySampleSummary[];
  experimentRecord: VaultRecord | null;
  health: ExportPackHealthContext;
}): string[] {
  const { filters, records, journalEntries, dailySampleSummaries, experimentRecord, health } = input;
  const questions = [
    `What are the most important changes or events between ${filters.from ?? "the start"} and ${filters.to ?? "the end"}?`,
    "Which records look most actionable for follow-up, and why?",
  ];

  if (dailySampleSummaries.length > 0) {
    questions.push("What trends or outliers appear in the daily sample summaries?");
  }

  if (journalEntries.length > 0) {
    questions.push(
      "What do the journal notes add that is not obvious from the structured records alone?",
    );
  }

  if (experimentRecord) {
    questions.push(
      `What evidence in this pack is relevant to the ${experimentRecord.experimentSlug} experiment?`,
    );
  }

  if (records.some((record) => record.kind === "meal")) {
    questions.push(
      "Do meals or meal-adjacent notes appear to line up with any reported symptoms or measurements?",
    );
  }

  if (health.assessments.length > 0) {
    questions.push(
      "Which intake-assessment answers appear most relevant to the current goals, conditions, or regimens?",
    );
  }

  if (health.currentProfile || countHealthBankPages(health) > 0) {
    questions.push(
      "How does the derived current profile compare with the durable health registries in this pack?",
    );
  }

  if (health.historyEvents.length > 0) {
    questions.push(
      "Which medical history events or exposures most change the interpretation of the other records?",
    );
  }

  return questions;
}

function summarizeExperiment(record: VaultRecord): QuestionPackContextExperiment {
  return {
    id: record.id,
    slug: record.experimentSlug,
    title: record.title,
    startedOn: record.date,
    tags: record.tags,
    body: record.body,
    sourcePath: record.sourcePath,
  };
}

function summarizeJournalEntry(record: VaultRecord): QuestionPackContextJournal {
  return {
    id: record.id,
    date: record.date,
    title: record.title,
    summary: record.body,
    tags: record.tags,
    eventIds: toStringArray(record.data.eventIds),
    sampleStreams: toStringArray(record.data.sampleStreams),
    sourcePath: record.sourcePath,
  };
}

function summarizeTimelineRecord(record: VaultRecord): QuestionPackTimelineRecord {
  return {
    id: record.id,
    when: record.occurredAt ?? record.date ?? "unknown-date",
    kind: record.kind ?? record.recordType,
    recordType: record.recordType,
    title: record.title,
    summary: summarizeRecord(record),
    tags: record.tags,
    experimentSlug: record.experimentSlug,
    sourcePath: record.sourcePath,
  };
}

function summarizeRecord(record: VaultRecord): string {
  if (record.title) {
    return record.title;
  }

  if (typeof record.body === "string" && record.body.trim()) {
    return record.body.trim().split("\n")[0] ?? "";
  }

  return record.kind ?? record.recordType;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function summarizeHealthManifest(health: ExportPackHealthContext) {
  return {
    assessmentCount: health.assessments.length,
    profileSnapshotCount: health.profileSnapshots.length,
    historyEventCount: health.historyEvents.length,
    bankPageCount: countHealthBankPages(health),
    currentProfileIncluded: health.currentProfile !== null,
  };
}

function countHealthBankPages(health: ExportPackHealthContext): number {
  return (
    health.goals.length +
    health.conditions.length +
    health.allergies.length +
    health.regimens.length +
    health.familyMembers.length +
    health.geneticVariants.length
  );
}

function pushRegistrySection(
  lines: string[],
  heading: string,
  entries: ExportPackBankPage[],
) {
  if (entries.length === 0) {
    return;
  }

  lines.push(`### ${heading}`, "");
  for (const entry of entries.slice(0, 20)) {
    lines.push(`- ${entry.id} | ${entry.title ?? entry.slug}`);
  }
  lines.push("");
}

function buildHealthContext(
  vault: VaultReadModel,
  filters: ExportPackFilters,
): ExportPackHealthContext {
  const assessments = readAssessmentRecords(vault.vaultRoot, filters);
  const profileSnapshots = readProfileSnapshotRecords(vault.vaultRoot, filters);
  const allProfileSnapshots = readProfileSnapshotRecords(vault.vaultRoot, {
    from: null,
    to: null,
    experimentSlug: null,
  });
  const historyEvents = readHistoryRecords(vault.vaultRoot, filters);
  const currentProfile = readCurrentProfileRecord(vault.vaultRoot, allProfileSnapshots);

  return {
    assessments,
    profileSnapshots,
    historyEvents,
    currentProfile,
    goals: readBankPages(vault.vaultRoot, "bank/goals", ["goalId"]),
    conditions: readBankPages(vault.vaultRoot, "bank/conditions", ["conditionId"]),
    allergies: readBankPages(vault.vaultRoot, "bank/allergies", ["allergyId"]),
    regimens: readBankPages(vault.vaultRoot, "bank/regimens", ["regimenId"]),
    familyMembers: readBankPages(vault.vaultRoot, "bank/family", ["familyMemberId", "memberId"]),
    geneticVariants: readBankPages(vault.vaultRoot, "bank/genetics", ["variantId"]),
  };
}

function readAssessmentRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackAssessmentRecord[] {
  return readJsonlDirectory(vaultRoot, "ledger/assessments")
    .map(({ relativePath, value }) => {
      const source = asObject(value);
      if (!source) {
        return null;
      }
      const id = firstString(source, ["id"]);
      if (!id?.startsWith("asmt_")) {
        return null;
      }

      return {
        id,
        title: firstString(source, ["title"]),
        assessmentType: firstString(source, ["assessmentType"]),
        recordedAt: firstString(source, ["recordedAt", "occurredAt", "importedAt"]),
        importedAt: firstString(source, ["importedAt"]),
        source: firstString(source, ["source"]),
        sourcePath: firstString(source, ["rawPath", "sourcePath"]),
        questionnaireSlug: firstString(source, ["questionnaireSlug"]),
        relatedIds: firstStringArray(source, ["relatedIds"]),
        responses: firstObject(source, ["responses", "response"]),
        relativePath,
      };
    })
    .filter((entry): entry is ExportPackAssessmentRecord => entry !== null)
    .filter((entry) => matchesDateWindow(entry.recordedAt ?? entry.importedAt, filters))
    .sort((left, right) =>
      (right.recordedAt ?? right.importedAt ?? "").localeCompare(left.recordedAt ?? left.importedAt ?? "") ||
      left.id.localeCompare(right.id),
    );
}

function readProfileSnapshotRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackProfileSnapshotRecord[] {
  return readJsonlDirectory(vaultRoot, "ledger/profile-snapshots")
    .map(({ relativePath, value }) => {
      const source = asObject(value);
      if (!source) {
        return null;
      }
      const id = firstString(source, ["id"]);
      if (!id?.startsWith("psnap_")) {
        return null;
      }

      const sourceObject = firstObject(source, ["source"]);
      const sourceAssessmentIds = firstStringArray(source, ["sourceAssessmentIds"]);
      return {
        id,
        recordedAt: firstString(source, ["recordedAt", "capturedAt"]),
        source:
          firstString(source, ["source"]) ??
          firstString(sourceObject, ["kind", "source", "importedFrom"]),
        sourceAssessmentIds:
          sourceAssessmentIds.length > 0
            ? sourceAssessmentIds
            : (firstString(sourceObject, ["assessmentId"])
                ? [firstString(sourceObject, ["assessmentId"]) as string]
                : []),
        sourceEventIds: firstStringArray(source, ["sourceEventIds"]),
        profile: firstObject(source, ["profile"]),
        relativePath,
      };
    })
    .filter((entry): entry is ExportPackProfileSnapshotRecord => entry !== null)
    .filter((entry) => matchesDateWindow(entry.recordedAt, filters))
    .sort((left, right) =>
      (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "") || left.id.localeCompare(right.id),
    );
}

function readHistoryRecords(
  vaultRoot: string,
  filters: ExportPackFilters,
): ExportPackHistoryRecord[] {
  const healthKinds = new Set(["encounter", "procedure", "test", "adverse_effect", "exposure"]);

  return readJsonlDirectory(vaultRoot, "ledger/events")
    .map(({ relativePath, value }) => {
      const source = asObject(value);
      if (!source) {
        return null;
      }
      const id = firstString(source, ["id"]);
      const kind = firstString(source, ["kind"]);
      const occurredAt = firstString(source, ["occurredAt"]);
      const title = firstString(source, ["title"]);
      if (!id?.startsWith("evt_") || !kind || !healthKinds.has(kind) || !occurredAt || !title) {
        return null;
      }

      return {
        id,
        kind,
        occurredAt,
        recordedAt: firstString(source, ["recordedAt"]),
        source: firstString(source, ["source"]),
        title,
        status: firstString(source, ["status"]),
        tags: firstStringArray(source, ["tags"]),
        relatedIds: firstStringArray(source, ["relatedIds"]),
        relativePath,
        data: source,
      };
    })
    .filter((entry): entry is ExportPackHistoryRecord => entry !== null)
    .filter((entry) => matchesDateWindow(entry.occurredAt, filters))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
}

function readCurrentProfileRecord(
  vaultRoot: string,
  profileSnapshots: ExportPackProfileSnapshotRecord[],
): ExportPackCurrentProfile | null {
  const latestSnapshot = profileSnapshots[0] ?? null;
  if (!latestSnapshot) {
    return null;
  }

  const relativePath = "bank/profile/current.md";
  const absolutePath = path.join(vaultRoot, relativePath);
  const markdown = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : null;

  if (markdown) {
    const parsed = parseFrontmatterDocument(markdown);
    const snapshotId =
      firstString(parsed.attributes, ["snapshotId"]) ??
      markdown.match(/Snapshot ID:\s+`([^`]+)`/u)?.[1] ??
      null;

    if (snapshotId === latestSnapshot.id) {
      return {
        snapshotId,
        updatedAt:
          firstString(parsed.attributes, ["updatedAt"]) ??
          markdown.match(/Recorded At:\s+([^\n]+)/u)?.[1]?.trim() ??
          latestSnapshot.recordedAt,
        sourceAssessmentIds: firstStringArray(parsed.attributes, ["sourceAssessmentIds"]),
        sourceEventIds: firstStringArray(parsed.attributes, ["sourceEventIds"]),
        topGoalIds: firstStringArray(parsed.attributes, ["topGoalIds"]),
        relativePath,
        markdown,
        body: parsed.body,
      };
    }
  }

  return {
    snapshotId: latestSnapshot.id,
    updatedAt: latestSnapshot.recordedAt,
    sourceAssessmentIds: latestSnapshot.sourceAssessmentIds,
    sourceEventIds: latestSnapshot.sourceEventIds,
    topGoalIds: firstStringArray(latestSnapshot.profile, ["topGoalIds"]),
    relativePath,
    markdown: null,
    body: null,
  };
}

function readBankPages(
  vaultRoot: string,
  relativeRoot: string,
  idKeys: readonly string[],
): ExportPackBankPage[] {
  return walkRelativeMarkdownFiles(vaultRoot, relativeRoot)
    .map((relativePath) => {
      const markdown = readFileSync(path.join(vaultRoot, relativePath), "utf8");
      const parsed = parseFrontmatterDocument(markdown);
      const id = firstString(parsed.attributes, idKeys);
      if (!id) {
        return null;
      }

      return {
        id,
        slug: firstString(parsed.attributes, ["slug"]) ?? path.basename(relativePath, ".md"),
        title: firstString(parsed.attributes, ["title", "name", "label"]),
        status: firstString(parsed.attributes, ["status", "clinicalStatus", "significance"]),
        relativePath,
        markdown,
        body: parsed.body,
        attributes: parsed.attributes,
      };
    })
    .filter((entry): entry is ExportPackBankPage => entry !== null)
    .sort((left, right) => (left.title ?? left.slug).localeCompare(right.title ?? right.slug));
}

function walkRelativeMarkdownFiles(vaultRoot: string, relativeRoot: string): string[] {
  const absoluteRoot = path.join(vaultRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const results: string[] = [];
  const stack = [relativeRoot];

  while (stack.length > 0) {
    const currentRelative = stack.pop() as string;
    const absoluteCurrent = path.join(vaultRoot, currentRelative);
    const entries = readdirSync(absoluteCurrent, { withFileTypes: true });

    for (const entry of entries) {
      const childRelative = path.join(currentRelative, entry.name);
      if (entry.isDirectory()) {
        stack.push(childRelative);
        continue;
      }

      if (entry.isFile() && childRelative.endsWith(".md")) {
        results.push(childRelative);
      }
    }
  }

  return results.sort();
}

function readJsonlDirectory(
  vaultRoot: string,
  relativeRoot: string,
): Array<{ relativePath: string; value: unknown }> {
  const absoluteRoot = path.join(vaultRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const files = walkRelativeFilesByExtension(vaultRoot, relativeRoot, ".jsonl");
  const results: Array<{ relativePath: string; value: unknown }> = [];

  for (const relativePath of files) {
    const contents = readFileSync(path.join(vaultRoot, relativePath), "utf8");
    for (const line of contents.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      results.push({
        relativePath,
        value: JSON.parse(trimmed),
      });
    }
  }

  return results;
}

function walkRelativeFilesByExtension(
  vaultRoot: string,
  relativeRoot: string,
  extension: string,
): string[] {
  const absoluteRoot = path.join(vaultRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const results: string[] = [];
  const stack = [relativeRoot];

  while (stack.length > 0) {
    const currentRelative = stack.pop() as string;
    const absoluteCurrent = path.join(vaultRoot, currentRelative);
    const entries = readdirSync(absoluteCurrent, { withFileTypes: true });

    for (const entry of entries) {
      const childRelative = path.join(currentRelative, entry.name);
      if (entry.isDirectory()) {
        stack.push(childRelative);
        continue;
      }

      if (entry.isFile() && childRelative.endsWith(extension)) {
        results.push(childRelative);
      }
    }
  }

  return results.sort();
}

function matchesDateWindow(
  value: string | null,
  filters: ExportPackFilters,
): boolean {
  if (!value) {
    return false;
  }

  const comparable = value.slice(0, 10);
  if (filters.from && comparable < filters.from) {
    return false;
  }

  if (filters.to && comparable > filters.to) {
    return false;
  }

  return true;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstObject(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  for (const key of keys) {
    const candidate = asObject(value[key]);
    if (candidate) {
      return candidate;
    }
  }

  return {};
}

function firstString(
  value: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function firstStringArray(
  value: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is string => typeof entry === "string");
    }
  }

  return [];
}
