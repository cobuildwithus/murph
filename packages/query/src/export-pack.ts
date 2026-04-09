import { buildHealthContextFromVault } from "./export-pack-health.ts";
import type {
  ExportPackAssessmentRecord,
  ExportPackBankPage,
  ExportPackFilters,
  ExportPackHealthEventRecord,
  ExportPackHealthContext,
} from "./export-pack-health-types.ts";
import type { CanonicalEntity } from "./canonical-entities.ts";
import { getExperiment, listEntities, listJournalEntries } from "./model.ts";
import type { VaultReadModel } from "./model.ts";
import { summarizeDailySamples } from "./summaries.ts";
import type { DailySampleSummary } from "./summaries.ts";

export type {
  ExportPackAssessmentRecord,
  ExportPackBankPage,
  ExportPackFilters,
  ExportPackHealthEventRecord,
  ExportPackHealthContext,
} from "./export-pack-health-types.ts";

export interface ExportPackFile {
  path: string;
  mediaType: "application/json" | "text/markdown";
  contents: string;
}

export interface ExportPackManifest {
  recordCount: number;
  experimentCount: number;
  journalCount: number;
  sampleSummaryCount: number;
  assessmentCount: number;
  healthEventCount: number;
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
  family: CanonicalEntity["family"];
  title: string | null;
  summary: string;
  tags: string[];
  experimentSlug: string | null;
  sourcePath: string;
}

export interface QuestionPackContext {
  experiment: QuestionPackContextExperiment | null;
  journals: QuestionPackContextJournal[];
  timeline: QuestionPackTimelineRecord[];
  dailySampleSummaries: DailySampleSummary[];
  health: ExportPackHealthContext;
}

export interface QuestionPack {
  format: "murph.question-pack.v1";
  packId: string;
  generatedAt: string;
  scope: ExportPackFilters;
  instructions: QuestionPackInstructions;
  questions: string[];
  context: QuestionPackContext;
}

export interface ExportPack {
  format: "murph.export-pack.v1";
  packId: string;
  basePath: string;
  generatedAt: string;
  filters: ExportPackFilters;
  manifest: ExportPackManifest;
  entities: CanonicalEntity[];
  journalEntries: CanonicalEntity[];
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
  entities: CanonicalEntity[];
  journalEntries: CanonicalEntity[];
  dailySampleSummaries: DailySampleSummary[];
  experimentRecord: CanonicalEntity | null;
  health: ExportPackHealthContext;
}

function buildDefaultPackId(options: BuildExportPackOptions): string {
  return [
    "pack",
    options.from ?? "start",
    options.to ?? "end",
    options.experimentSlug ?? "all",
  ].join("-");
}

function sanitizePackId(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildExportPack(
  vault: VaultReadModel,
  options: BuildExportPackOptions = {},
): ExportPack {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const packId =
    sanitizePackId(options.packId ?? buildDefaultPackId(options)) ||
    sanitizePackId(buildDefaultPackId(options)) ||
    "pack";
  const basePath = `exports/packs/${packId}`;
  const filters: ExportPackFilters = {
    from: options.from ?? null,
    to: options.to ?? null,
    experimentSlug: options.experimentSlug ?? null,
  };

  const entities = listEntities(vault, {
    families: ["audit", "core", "event", "experiment", "journal", "sample"],
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
    recordCount: entities.length,
    experimentCount: experimentRecord ? 1 : vault.experiments.length,
    journalCount: journalEntries.length,
    sampleSummaryCount: dailySampleSummaries.length,
    assessmentCount: health.assessments.length,
    healthEventCount: health.healthEvents.length,
    bankPageCount: countHealthBankPages(health),
    questionCount: 0,
    fileCount: 0,
  };

  const questionPack = buildQuestionPack({
    packId,
    generatedAt,
    filters,
    entities,
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
          format: "murph.export-pack.v1",
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
              path: `${basePath}/entities.json`,
              mediaType: "application/json",
              role: "entities",
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
      path: `${basePath}/entities.json`,
      mediaType: "application/json",
      contents: JSON.stringify(entities, null, 2),
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
    format: "murph.export-pack.v1",
    packId,
    basePath,
    generatedAt,
    filters,
    manifest,
    entities,
    journalEntries,
    dailySampleSummaries,
    health,
    questionPack,
    files,
  };
}

function renderAssistantContext(input: QuestionPack): string {
  const { packId, generatedAt, scope, instructions, questions, context } = input;

  const entityLines = context.timeline.slice(0, 50).map((entity) => {
    return `- ${entity.when} | ${entity.kind} | ${entity.id} | ${entity.summary}`;
  });

  const summaryLines = context.dailySampleSummaries.map((summary) => {
    const averageValue =
      summary.averageValue === null ? "n/a" : String(summary.averageValue);
    const unitSuffix = summary.unit ? ` ${summary.unit}` : "";
    return `- ${summary.date} | ${summary.stream} | count=${summary.sampleCount} | avg=${averageValue}${unitSuffix}`;
  });
  const healthBankSectionCount = countHealthBankPages(context.health);

  const lines = [
    "# Murph Export Pack",
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

  lines.push("## Entity Timeline", "", ...entityLines, "", "## Daily Sample Summaries", "");

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

  if (context.health.healthEvents.length > 0) {
    lines.push("## Health Events", "");
    for (const event of context.health.healthEvents.slice(0, 25)) {
      lines.push(`- ${event.occurredAt} | ${event.kind} | ${event.title}`);
    }
    lines.push("");
  }

  if (healthBankSectionCount > 0) {
    lines.push("## Health Registries", "");
    pushRegistrySection(lines, "Goals", context.health.goals);
    pushRegistrySection(lines, "Conditions", context.health.conditions);
    pushRegistrySection(lines, "Allergies", context.health.allergies);
    pushRegistrySection(lines, "Protocols", context.health.protocols);
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
    entities,
    journalEntries,
    dailySampleSummaries,
    experimentRecord,
    health,
  } = input;

  return {
    format: "murph.question-pack.v1",
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
      entities,
      journalEntries,
      dailySampleSummaries,
      experimentRecord,
      health,
    }),
    context: {
      experiment: experimentRecord ? summarizeExperiment(experimentRecord) : null,
      journals: journalEntries.map(summarizeJournalEntry),
      timeline: entities.map(summarizeTimelineRecord),
      dailySampleSummaries,
      health,
    },
  };
}

function buildPromptQuestions(input: {
  filters: ExportPackFilters;
  entities: CanonicalEntity[];
  journalEntries: CanonicalEntity[];
  dailySampleSummaries: DailySampleSummary[];
  experimentRecord: CanonicalEntity | null;
  health: ExportPackHealthContext;
}): string[] {
  const { filters, entities, journalEntries, dailySampleSummaries, experimentRecord, health } = input;
  const questions = [
    `What are the most important changes or events between ${filters.from ?? "the start"} and ${filters.to ?? "the end"}?`,
    "Which entities look most actionable for follow-up, and why?",
  ];

  if (dailySampleSummaries.length > 0) {
    questions.push("What trends or outliers appear in the daily sample summaries?");
  }

  if (journalEntries.length > 0) {
    questions.push(
      "What do the journal notes add that is not obvious from the structured entities alone?",
    );
  }

  if (experimentRecord) {
    questions.push(
      `What evidence in this pack is relevant to the ${experimentRecord.experimentSlug} experiment?`,
    );
  }

  if (entities.some((entity) => entity.kind === "meal")) {
    questions.push(
      "Do meals or meal-adjacent notes appear to line up with any reported symptoms or measurements?",
    );
  }

  if (health.assessments.length > 0) {
    questions.push(
      "Which intake-assessment answers appear most relevant to the current goals, conditions, or protocols?",
    );
  }

  if (countHealthBankPages(health) > 0) {
    questions.push(
      "Which durable goals, conditions, protocols, family history, or genetics context should shape interpretation of the other records?",
    );
  }

  if (health.healthEvents.length > 0) {
    questions.push(
      "Which time-stamped health events most change the interpretation of the other records?",
    );
  }

  return questions;
}

function summarizeExperiment(entity: CanonicalEntity): QuestionPackContextExperiment {
  return {
    id: entity.entityId,
    slug: entity.experimentSlug,
    title: entity.title,
    startedOn: entity.date,
    tags: entity.tags,
    body: entity.body,
    sourcePath: entity.path,
  };
}

function summarizeJournalEntry(entity: CanonicalEntity): QuestionPackContextJournal {
  return {
    id: entity.entityId,
    date: entity.date,
    title: entity.title,
    summary: entity.body,
    tags: entity.tags,
    eventIds: toStringArray(entity.attributes.eventIds),
    sampleStreams: toStringArray(entity.attributes.sampleStreams),
    sourcePath: entity.path,
  };
}

function summarizeTimelineRecord(entity: CanonicalEntity): QuestionPackTimelineRecord {
  return {
    id: entity.entityId,
    when: entity.occurredAt ?? entity.date ?? "unknown-date",
    kind: entity.kind || entity.family,
    family: entity.family,
    title: entity.title,
    summary: summarizeEntity(entity),
    tags: entity.tags,
    experimentSlug: entity.experimentSlug,
    sourcePath: entity.path,
  };
}

function summarizeEntity(entity: CanonicalEntity): string {
  if (entity.title) {
    return entity.title;
  }

  if (typeof entity.body === "string" && entity.body.trim()) {
    return entity.body.trim().split("\n")[0] ?? "";
  }

  return entity.kind || entity.family;
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
    healthEventCount: health.healthEvents.length,
    bankPageCount: countHealthBankPages(health),
  };
}

function countHealthBankPages(health: ExportPackHealthContext): number {
  return (
    health.goals.length +
    health.conditions.length +
    health.allergies.length +
    health.protocols.length +
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
  return buildHealthContextFromVault(vault, filters);
}
