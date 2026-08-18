import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
  CommonsProtocolRef,
  ExperimentAnalysisPlan,
  ExperimentAssistantSupport,
  EffectiveProtocolSnapshot,
  ExperimentFrontmatter,
  ExperimentOutcome,
  ExperimentOnboardingCapture,
  ExperimentOutcomeRef,
  ExperimentOutcomeTracking,
  ExperimentRunPlan,
  ExperimentStatus,
} from "@murphai/contracts";
import {
  EXPERIMENT_STATUSES,
  experimentAdherenceTargetsAuthoringSchema,
  experimentDocumentRelativePath,
  experimentFrontmatterSchema,
  experimentOutcomeSchema,
  safeParseContract,
} from "@murphai/contracts";

import { FRONTMATTER_SCHEMA_VERSIONS, ID_PREFIXES, VAULT_LAYOUT } from "../constants.ts";
import { emitAuditRecord } from "../audit.ts";
import { commitAuditedCanonicalWrite } from "../audited-write.ts";
import { VaultError } from "../errors.ts";
import {
  assertExperimentDocumentRelativePath,
  listCanonicalExperimentDocumentPathsInterruptible,
} from "../experiment-storage.ts";
import { parseFrontmatterDocument, stringifyFrontmatterDocument } from "../frontmatter.ts";
import { stageMarkdownDocumentWrite } from "../markdown-documents.ts";
import { readUtf8File } from "../fs.ts";
import { generateRecordId } from "../ids.ts";
import { toMonthlyShardRelativePath } from "../jsonl.ts";
import { sanitizePathSegment } from "../path-safety.ts";
import { defaultTimeZone, toIsoTimestamp, toLocalDayKey } from "../time.ts";
import { loadVault } from "../vault.ts";

import { buildExperimentEventRecord } from "./events.ts";
import {
  compactObject,
  normalizeOptionalText,
  normalizeTimestampInput,
  runLoadedCanonicalWrite,
  uniqueTrimmedStringList,
  validateContract,
} from "./shared.ts";

import type { ExperimentEventRecord } from "@murphai/contracts";
import type { ProtocolRef } from "../protocols.ts";
import type { DateInput, FrontmatterObject, UnknownRecord } from "../types.ts";

export interface CreateExperimentInput {
  vaultRoot: string;
  slug: string;
  title?: string;
  hypothesis?: string;
  startedOn?: DateInput;
  status?: string;
  body?: string;
  tags?: string[];
  commonsProtocolRef?: CommonsProtocolRef;
  protocolRef?: ProtocolRef;
  effectiveProtocolSnapshot?: EffectiveProtocolSnapshot;
  runPlan?: ExperimentRunPlan;
  analysisPlan?: ExperimentAnalysisPlan;
  onboarding?: ExperimentOnboardingCapture;
  assistantSupport?: ExperimentAssistantSupport;
}

export interface CreateExperimentResult {
  created: boolean;
  experiment: {
    id: string;
    slug: string;
    relativePath: string;
  };
  event: ExperimentEventRecord | null;
  auditPath: string | null;
}

export interface ReadExperimentLifecycleFrontmatterResult {
  items: ExperimentFrontmatter[];
  yielded: boolean;
}

export const MAX_EXPERIMENT_LIFECYCLE_DOCUMENTS = 1_024;

export interface UpdateExperimentInput {
  vaultRoot: string;
  relativePath: string;
  title?: string;
  hypothesis?: string;
  startedOn?: string;
  status?: string;
  body?: string;
  tags?: string[];
  commonsProtocolRef?: CommonsProtocolRef | null;
  protocolRef?: ProtocolRef | null;
  effectiveProtocolSnapshot?: EffectiveProtocolSnapshot | null;
  runPlan?: ExperimentRunPlan | null;
  analysisPlan?: ExperimentAnalysisPlan | null;
  onboarding?: ExperimentOnboardingCapture | null;
  assistantSupport?: ExperimentAssistantSupport | null;
  outcome?: ExperimentOutcomeTracking | null;
  outcomeRef?: ExperimentOutcomeRef | null;
  expectedDocumentSha256?: string;
}

export interface UpdateExperimentResult {
  experimentId: string;
  slug: string;
  relativePath: string;
  status: ExperimentStatus;
  updated: true;
}

export interface WriteExperimentOutcomeInput {
  vaultRoot: string;
  relativePath: string;
  expectedFrontmatter: ExperimentFrontmatter;
  outcome: ExperimentOutcome;
}

export interface WriteExperimentOutcomeResult {
  experimentId: string;
  slug: string;
  relativePath: string;
  status: ExperimentStatus;
  outcome: ExperimentOutcome;
  outcomePath: string;
  updatedExperiment: boolean;
}

export interface ReadReferencedExperimentOutcomeInput {
  vaultRoot: string;
  relativePath: string;
  expectedFrontmatter: ExperimentFrontmatter;
}

interface AppendExperimentLifecycleEventInput {
  vaultRoot: string;
  relativePath: string;
  phase: "checkpoint" | "stop";
  occurredAt?: string;
  title: string;
  note?: string;
  nextStatus?: ExperimentStatus;
  endedOn?: string;
}

export interface AppendExperimentLifecycleEventResult extends UpdateExperimentResult {
  eventId: string;
  ledgerFile: string;
}

const EXPERIMENT_STATUS_SET = new Set<ExperimentStatus>(EXPERIMENT_STATUSES);

function normalizeExperimentHypothesis(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nextOptionalExperimentValue<TValue>(
  inputValue: TValue | null | undefined,
  existingValue: TValue | undefined,
): TValue | undefined {
  if (inputValue === undefined) {
    return existingValue;
  }

  return inputValue ?? undefined;
}

function requireExperimentStatus(value: unknown): ExperimentStatus {
  if (typeof value !== "string" || !EXPERIMENT_STATUS_SET.has(value as ExperimentStatus)) {
    throw new VaultError("EXPERIMENT_STATUS_INVALID", "Experiment status is invalid.");
  }

  return value as ExperimentStatus;
}

function frontmatterString(value: FrontmatterObject, key: string): string {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : "";
}

function experimentFrontmatterObject(attributes: ExperimentFrontmatter): FrontmatterObject {
  const cloned = JSON.parse(JSON.stringify(attributes));
  if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) {
    throw new VaultError("FRONTMATTER_INVALID", "Experiment frontmatter failed object serialization.");
  }

  return cloned as FrontmatterObject;
}

function toExperimentComparableAttributes(
  attributes:
    | Pick<ExperimentFrontmatter, "slug" | "status" | "title" | "startedOn" | "hypothesis">
    | FrontmatterObject,
): UnknownRecord {
  return compactObject({
    slug: frontmatterString(attributes as FrontmatterObject, "slug").trim(),
    status: requireExperimentStatus((attributes as FrontmatterObject).status),
    title: frontmatterString(attributes as FrontmatterObject, "title").trim(),
    startedOn: frontmatterString(attributes as FrontmatterObject, "startedOn").trim(),
    hypothesis: normalizeExperimentHypothesis((attributes as FrontmatterObject).hypothesis),
  }) as UnknownRecord;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hasCompleteExperimentCreateInput(input: CreateExperimentInput): boolean {
  return (
    input.body !== undefined ||
    input.tags !== undefined ||
    input.commonsProtocolRef !== undefined ||
    input.protocolRef !== undefined ||
    input.effectiveProtocolSnapshot !== undefined ||
    input.runPlan !== undefined ||
    input.analysisPlan !== undefined ||
    input.onboarding !== undefined ||
    input.assistantSupport !== undefined
  );
}

function validateExperimentFrontmatter(
  value: unknown,
  relativePath = "experiment",
): ExperimentFrontmatter {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as FrontmatterObject
    : {};

  return validateContract(
    experimentFrontmatterSchema,
    source,
    "EXPERIMENT_FRONTMATTER_INVALID",
    `Experiment frontmatter for "${relativePath}" is invalid.`,
    {
      relativePath,
    },
  );
}

export async function readExperimentFrontmatterDocument(
  vaultRoot: string,
  relativePath: string,
): Promise<{
  rawDocument: string;
  document: {
    attributes: ExperimentFrontmatter;
    body: string;
  };
}> {
  assertExperimentDocumentRelativePath(relativePath);
  const rawDocument = await readUtf8File(vaultRoot, relativePath);
  const parsed = parseFrontmatterDocument(rawDocument);
  const attributes = validateExperimentFrontmatter(parsed.attributes, relativePath);
  if (experimentDocumentRelativePath(attributes.slug) !== relativePath) {
    throw new VaultError(
      "EXPERIMENT_DOCUMENT_PATH_MISMATCH",
      "An experiment document filename must match its frontmatter slug.",
      { relativePath },
    );
  }

  return {
    rawDocument,
    document: {
      attributes,
      body: parsed.body,
    },
  };
}

/**
 * Reads the validated experiment snapshot used by managed lifecycle work.
 * Partial snapshots are discarded when foreground work asks maintenance to
 * yield, and the storage boundary enforces a hard document-count ceiling.
 */
export async function readExperimentLifecycleFrontmatterDocuments(input: {
  vaultRoot: string;
  shouldYield?: (() => boolean) | null;
}): Promise<ReadExperimentLifecycleFrontmatterResult> {
  const listed = await listCanonicalExperimentDocumentPathsInterruptible({
    vaultRoot: input.vaultRoot,
    maxDocuments: MAX_EXPERIMENT_LIFECYCLE_DOCUMENTS,
    shouldYield: input.shouldYield ?? null,
  });
  if (listed.yielded) {
    return { items: [], yielded: true };
  }

  const items: ExperimentFrontmatter[] = [];
  for (const relativePath of listed.relativePaths) {
    if (input.shouldYield?.() === true) {
      return { items: [], yielded: true };
    }
    const { document } = await readExperimentFrontmatterDocument(
      input.vaultRoot,
      relativePath,
    );
    items.push(document.attributes);
  }

  if (input.shouldYield?.() === true) {
    return { items: [], yielded: true };
  }
  return { items, yielded: false };
}

function appendExperimentNoteBlock(
  body: string,
  input: {
    occurredAt: string;
    title: string;
    note?: string;
  },
): string {
  const trimmedBody = body.trimEnd();
  const lines = [`### ${input.title} (${input.occurredAt})`];
  const note = normalizeOptionalText(input.note);

  if (note) {
    lines.push("", note);
  }

  const block = `${lines.join("\n")}\n`;
  if (trimmedBody.length === 0) {
    return `## Notes\n\n${block}`;
  }

  if (trimmedBody.includes("\n## Notes\n")) {
    return `${trimmedBody}\n\n${block}`;
  }

  return `${trimmedBody}\n\n## Notes\n\n${block}`;
}

export async function createExperiment(input: CreateExperimentInput): Promise<CreateExperimentResult> {
  const {
    vaultRoot,
    slug,
    title,
    hypothesis,
    startedOn = new Date(),
    status = "active",
  } = input;
  const vault = await loadVault({ vaultRoot });
  const safeSlug = sanitizePathSegment(slug, "experiment");
  const startedTimestamp = toIsoTimestamp(startedOn, "startedOn");
  const startedDay = toLocalDayKey(startedOn, vault.metadata.timezone ?? defaultTimeZone(), "startedOn");
  const relativePath = experimentDocumentRelativePath(safeSlug);
  const normalizedTitle = String(title ?? safeSlug).trim();
  const normalizedStatus = requireExperimentStatus(status);
  const normalizedHypothesis = normalizeExperimentHypothesis(hypothesis);
  const comparableAttributes = toExperimentComparableAttributes({
    slug: safeSlug,
    status: normalizedStatus,
    title: normalizedTitle,
    startedOn: startedDay,
    hypothesis: normalizedHypothesis,
  });
  const experimentId = generateRecordId(ID_PREFIXES.experiment);
  const attributes = validateContract(
    experimentFrontmatterSchema,
    compactObject({
      schemaVersion: FRONTMATTER_SCHEMA_VERSIONS.experiment,
      docType: "experiment",
      experimentId,
      slug: safeSlug,
      status: normalizedStatus,
      title: normalizedTitle,
      startedOn: startedDay,
      hypothesis: normalizedHypothesis,
      tags: uniqueTrimmedStringList(input.tags) ?? undefined,
      commonsProtocolRef: input.commonsProtocolRef,
      protocolRef: input.protocolRef,
      effectiveProtocolSnapshot: input.effectiveProtocolSnapshot,
      runPlan: input.runPlan,
      analysisPlan: input.analysisPlan,
      onboarding: input.onboarding,
      assistantSupport: input.assistantSupport,
    }),
    "FRONTMATTER_INVALID",
    "Experiment frontmatter failed contract validation before write.",
  );
  validateContract(
    experimentAdherenceTargetsAuthoringSchema,
    attributes.runPlan?.adherenceTargets ?? [],
    "FRONTMATTER_INVALID",
    "Experiment adherence targets failed authoring validation before write.",
  );
  const body = input.body ?? `# ${normalizedTitle}\n\n## Plan\n\n## Notes\n\n`;

  try {
    const existingDocument = parseFrontmatterDocument(await readUtf8File(vaultRoot, relativePath));
    const existingResult = safeParseContract(
      experimentFrontmatterSchema,
      existingDocument.attributes,
    );

    if (!existingResult.success) {
      throw new VaultError(
        "FRONTMATTER_INVALID",
        `Existing experiment "${safeSlug}" failed contract validation.`,
        {
          relativePath,
          errors: existingResult.errors,
        },
      );
    }
    const existingAttributes = existingResult.data;

    if (
      JSON.stringify(toExperimentComparableAttributes(existingAttributes)) !==
      JSON.stringify(comparableAttributes)
    ) {
      throw new VaultError(
        "VAULT_EXPERIMENT_CONFLICT",
        `Experiment "${safeSlug}" already exists with different frontmatter.`,
        {
          relativePath,
          experimentId: existingAttributes.experimentId,
        },
      );
    }

    if (hasCompleteExperimentCreateInput(input)) {
      const expectedAttributes = {
        ...attributes,
        experimentId: existingAttributes.experimentId,
      };
      if (
        !isDeepStrictEqual(existingAttributes, expectedAttributes) ||
        existingDocument.body !== body
      ) {
        throw new VaultError(
          "VAULT_EXPERIMENT_CONFLICT",
          `Experiment "${safeSlug}" already exists with different canonical plan data.`,
          {
            relativePath,
            experimentId: existingAttributes.experimentId,
          },
        );
      }
    }

    return {
      created: false,
      experiment: {
        id: existingAttributes.experimentId,
        slug: existingAttributes.slug,
        relativePath,
      },
      event: null,
      auditPath: null,
    };
  } catch (error) {
    if (!(error instanceof VaultError) || error.code !== "VAULT_FILE_MISSING") {
      throw error;
    }
  }

  const markdown = stringifyFrontmatterDocument({
    attributes: experimentFrontmatterObject(attributes),
    body,
  });
  const event = buildExperimentEventRecord({
    occurredAt: startedTimestamp,
    title: normalizedTitle,
    experimentId,
    experimentSlug: safeSlug,
    phase: "start",
  });
  const ledgerFile = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    startedTimestamp,
    "occurredAt",
  );

  return runLoadedCanonicalWrite<CreateExperimentResult>({
    vaultRoot,
    operationType: "experiment_create",
    summary: `Create experiment ${safeSlug}`,
    occurredAt: startedTimestamp,
    mutate: async ({ batch }) => {
      await stageMarkdownDocumentWrite(
        batch,
        {
          relativePath,
          created: true,
        },
        markdown,
        {
          overwrite: false,
        },
      );
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(event)}\n`);
      const audit = await emitAuditRecord({
        vaultRoot,
        batch,
        action: "experiment_create",
        commandName: "core.createExperiment",
        summary: `Created experiment ${safeSlug}.`,
        occurredAt: startedTimestamp,
        files: [relativePath, ledgerFile],
        targetIds: [experimentId, event.id],
      });

      return {
        created: true,
        experiment: {
          id: experimentId,
          slug: safeSlug,
          relativePath,
        },
        event,
        auditPath: audit.relativePath,
      };
    },
  });
}

export async function updateExperiment(
  input: UpdateExperimentInput,
): Promise<UpdateExperimentResult> {
  const { rawDocument, document } = await readExperimentFrontmatterDocument(
    input.vaultRoot,
    input.relativePath,
  );
  if (input.expectedDocumentSha256 !== undefined) {
    const expectedDocumentSha256 = input.expectedDocumentSha256.trim();
    if (!/^[a-f0-9]{64}$/u.test(expectedDocumentSha256)) {
      throw new VaultError(
        "INVALID_INPUT",
        "Expected experiment document SHA-256 must be a 64-character lowercase hexadecimal digest.",
        { relativePath: input.relativePath },
      );
    }
    const actualDocumentSha256 = sha256Text(rawDocument);
    if (actualDocumentSha256 !== expectedDocumentSha256) {
      throw new VaultError(
        "VAULT_EXPERIMENT_CONFLICT",
        "Experiment changed after it was read; refresh it before applying this update.",
        {
          relativePath: input.relativePath,
          expectedDocumentSha256,
          actualDocumentSha256,
        },
      );
    }
  }
  const nextAttributes = validateExperimentFrontmatter(
    compactObject({
      ...document.attributes,
      title: normalizeOptionalText(input.title) ?? document.attributes.title,
      hypothesis:
        input.hypothesis === undefined
          ? document.attributes.hypothesis
          : normalizeOptionalText(input.hypothesis) ?? undefined,
      startedOn: input.startedOn ?? document.attributes.startedOn,
      status:
        input.status === undefined
          ? document.attributes.status
          : requireExperimentStatus(input.status),
      tags:
        input.tags === undefined
          ? document.attributes.tags
          : uniqueTrimmedStringList(input.tags) ?? undefined,
      commonsProtocolRef: nextOptionalExperimentValue(
        input.commonsProtocolRef,
        document.attributes.commonsProtocolRef,
      ),
      protocolRef: nextOptionalExperimentValue(
        input.protocolRef,
        document.attributes.protocolRef,
      ),
      effectiveProtocolSnapshot: nextOptionalExperimentValue(
        input.effectiveProtocolSnapshot,
        document.attributes.effectiveProtocolSnapshot,
      ),
      runPlan: nextOptionalExperimentValue(input.runPlan, document.attributes.runPlan),
      analysisPlan: nextOptionalExperimentValue(
        input.analysisPlan,
        document.attributes.analysisPlan,
      ),
      onboarding: nextOptionalExperimentValue(input.onboarding, document.attributes.onboarding),
      assistantSupport: nextOptionalExperimentValue(
        input.assistantSupport,
        document.attributes.assistantSupport,
      ),
      outcome: nextOptionalExperimentValue(input.outcome, document.attributes.outcome),
      outcomeRef: nextOptionalExperimentValue(input.outcomeRef, document.attributes.outcomeRef),
    }),
    input.relativePath,
  );
  if (
    !isDeepStrictEqual(
      nextAttributes.runPlan?.adherenceTargets,
      document.attributes.runPlan?.adherenceTargets,
    )
  ) {
    validateContract(
      experimentAdherenceTargetsAuthoringSchema,
      nextAttributes.runPlan?.adherenceTargets ?? [],
      "FRONTMATTER_INVALID",
      "Experiment adherence targets failed authoring validation before write.",
    );
  }
  if (
    document.attributes.status !== "planned" &&
    (
      !isDeepStrictEqual(
        nextAttributes.commonsProtocolRef,
        document.attributes.commonsProtocolRef,
      ) ||
      !isDeepStrictEqual(
        nextAttributes.protocolRef,
        document.attributes.protocolRef,
      ) ||
      !isDeepStrictEqual(
        nextAttributes.effectiveProtocolSnapshot,
        document.attributes.effectiveProtocolSnapshot,
      )
    )
  ) {
    throw new VaultError(
      "EXPERIMENT_LINEAGE_IMMUTABLE",
      "Only a planned experiment may change its protocol lineage or effective snapshot.",
      {
        experimentId: document.attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: experimentFrontmatterObject(nextAttributes),
    body: input.body ?? document.body,
  });

  const result = await commitAuditedCanonicalWrite<UpdateExperimentResult>({
    vaultRoot: input.vaultRoot,
    operationType: "experiment_update",
    summary: `Update experiment ${nextAttributes.experimentId}`,
    occurredAt: new Date(),
    audit: {
      action: "experiment_update",
      commandName: "core.updateExperiment",
      summary: `Updated experiment ${nextAttributes.experimentId}.`,
      targetIds: [nextAttributes.experimentId],
    },
    mutate: async ({ batch }) => {
      const write = await stageMarkdownDocumentWrite(
        batch,
        {
          relativePath: input.relativePath,
          created: false,
        },
        nextMarkdown,
        {
          overwrite: true,
        },
      );

      return {
        result: {
          experimentId: nextAttributes.experimentId,
          slug: nextAttributes.slug,
          relativePath: input.relativePath,
          status: nextAttributes.status,
          updated: true,
        },
        changes: write.changes,
      };
    },
  });

  return result.result;
}

export async function writeExperimentOutcome(
  input: WriteExperimentOutcomeInput,
): Promise<WriteExperimentOutcomeResult> {
  const { document } = await readExperimentFrontmatterDocument(
    input.vaultRoot,
    input.relativePath,
  );
  const expectedFrontmatter = validateExperimentFrontmatter(
    input.expectedFrontmatter,
    input.relativePath,
  );
  if (!isDeepStrictEqual(document.attributes, expectedFrontmatter)) {
    throw new VaultError(
      "EXPERIMENT_REVISION_CONFLICT",
      "Experiment changed while its outcome was being analyzed. Retry the closeout against the current experiment revision.",
      {
        experimentId: document.attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }

  const referencedOutcome = await resolveReferencedExperimentOutcome({
    attributes: document.attributes,
    relativePath: input.relativePath,
    vaultRoot: input.vaultRoot,
  });
  const shouldAdvanceReferencedOutcome =
    referencedOutcome !== null &&
    shouldAdvanceReferencedExperimentOutcome({
      frontmatter: document.attributes,
      referencedOutcome: referencedOutcome.outcome,
      requestedAsOf: input.outcome.asOf,
    });
  if (
    referencedOutcome !== null &&
    !shouldAdvanceReferencedOutcome
  ) {
    return referencedOutcome;
  }

  const requestedOutcome = validateContract(
    experimentOutcomeSchema,
    input.outcome,
    "EXPERIMENT_OUTCOME_INVALID",
    "Experiment outcome failed contract validation before write.",
  );
  const attributes = document.attributes;
  if (
    requestedOutcome.experiment.id !== attributes.experimentId ||
    requestedOutcome.experiment.slug !== attributes.slug ||
    requestedOutcome.experiment.title !== attributes.title
  ) {
    throw new VaultError(
      "EXPERIMENT_OUTCOME_MISMATCH",
      "Experiment outcome identity does not match the current experiment.",
      {
        experimentId: attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }
  if (
    !isDeepStrictEqual(
      requestedOutcome.commonsProtocolRef ?? null,
      attributes.commonsProtocolRef ?? null,
    ) ||
    !isDeepStrictEqual(
      requestedOutcome.protocolRef ?? null,
      attributes.protocolRef ?? null,
    ) ||
    !isDeepStrictEqual(
      requestedOutcome.effectiveProtocolSnapshot ?? null,
      attributes.effectiveProtocolSnapshot ?? null,
    )
  ) {
    throw new VaultError(
      "EXPERIMENT_OUTCOME_LINEAGE_MISMATCH",
      "Experiment outcome protocol lineage does not match the current experiment snapshot.",
      {
        experimentId: attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }

  const outcomeId = `${attributes.experimentId}-outcome-${requestedOutcome.asOf}`;
  if (requestedOutcome.outcomeId && requestedOutcome.outcomeId !== outcomeId) {
    throw new VaultError(
      "EXPERIMENT_OUTCOME_MISMATCH",
      "Experiment outcome id does not match its experiment and analysis date.",
      {
        experimentId: attributes.experimentId,
        outcomeId: requestedOutcome.outcomeId,
      },
    );
  }
  const outcomePath = `${VAULT_LAYOUT.experimentsDirectory}/outcomes/${attributes.slug}-${requestedOutcome.asOf}.json`;
  const shouldCompleteRun =
    attributes.status === "active" &&
    attributes.runPlan?.interventionEnd !== undefined &&
    requestedOutcome.asOf >= attributes.runPlan.interventionEnd;
  const nextStatus = shouldCompleteRun ? "completed" as const : attributes.status;
  const nextEndedOn = shouldCompleteRun
    ? attributes.runPlan?.interventionEnd
    : attributes.endedOn;
  const {
    generatedAt: _requestedGeneratedAt,
    ...requestedComparable
  } = requestedOutcome;
  void _requestedGeneratedAt;
  const candidateOutcome = validateContract(
    experimentOutcomeSchema,
    {
      ...requestedComparable,
      experiment: {
        ...requestedOutcome.experiment,
        status: nextStatus,
      },
      outcomeId,
    },
    "EXPERIMENT_OUTCOME_INVALID",
    "Experiment outcome failed contract validation before write.",
  );
  const existingOutcome = await readExistingExperimentOutcome(input.vaultRoot, outcomePath);

  if (attributes.outcomeRef !== undefined && !shouldAdvanceReferencedOutcome) {
    throw new VaultError(
      "EXPERIMENT_OUTCOME_REFERENCE_INVALID",
      "The experiment already references a different immutable outcome artifact.",
      {
        experimentId: attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }

  if (existingOutcome !== null) {
    throw new VaultError(
      "EXPERIMENT_OUTCOME_UNREFERENCED",
      "An unreferenced experiment outcome artifact already exists and requires explicit repair.",
      {
        experimentId: attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }

  const generatedAt = new Date().toISOString();
  const validatedOutcome = validateContract(
    experimentOutcomeSchema,
    {
      ...candidateOutcome,
      generatedAt,
    },
    "EXPERIMENT_OUTCOME_INVALID",
    "Experiment outcome failed contract validation before write.",
  );
  const nextAttributes = validateExperimentFrontmatter(
    {
      ...attributes,
      status: nextStatus,
      endedOn: nextEndedOn,
      outcome: {
        ...attributes.outcome,
        latestOutcomeId: outcomeId,
        readyForReviewAt: attributes.outcome?.readyForReviewAt ?? generatedAt,
        finalAnalysisStatus: "generated",
      },
      outcomeRef: {
        outcomeId,
        generatedAt,
        relativePath: outcomePath,
      },
    },
    input.relativePath,
  );
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: experimentFrontmatterObject(nextAttributes),
    body: document.body,
  });

  const result = await commitAuditedCanonicalWrite<WriteExperimentOutcomeResult>({
    vaultRoot: input.vaultRoot,
    operationType: "experiment_outcome_write",
    summary: `Write experiment outcome ${outcomeId}`,
    occurredAt: generatedAt,
    audit: {
      action: "experiment_update",
      commandName: "core.writeExperimentOutcome",
      summary: `Wrote outcome analysis for experiment ${attributes.experimentId}.`,
      targetIds: [attributes.experimentId],
    },
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(
        outcomePath,
        `${JSON.stringify(validatedOutcome, null, 2)}\n`,
        { overwrite: true },
      );
      const experimentWrite = await stageMarkdownDocumentWrite(
        batch,
        {
          relativePath: input.relativePath,
          created: false,
        },
        nextMarkdown,
        { overwrite: true },
      );

      return {
        result: {
          experimentId: nextAttributes.experimentId,
          slug: nextAttributes.slug,
          relativePath: input.relativePath,
          status: nextAttributes.status,
          outcome: validatedOutcome,
          outcomePath,
          updatedExperiment: true,
        },
        files: [outcomePath],
        changes: experimentWrite.changes,
      };
    },
  });

  return result.result;
}

export async function readReferencedExperimentOutcome(
  input: ReadReferencedExperimentOutcomeInput,
): Promise<WriteExperimentOutcomeResult | null> {
  const { document } = await readExperimentFrontmatterDocument(
    input.vaultRoot,
    input.relativePath,
  );
  const expectedFrontmatter = validateExperimentFrontmatter(
    input.expectedFrontmatter,
    input.relativePath,
  );
  if (!isDeepStrictEqual(document.attributes, expectedFrontmatter)) {
    throw new VaultError(
      "EXPERIMENT_REVISION_CONFLICT",
      "Experiment changed while its saved outcome was being resolved. Retry against the current experiment revision.",
      {
        experimentId: document.attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }

  return resolveReferencedExperimentOutcome({
    attributes: document.attributes,
    relativePath: input.relativePath,
    vaultRoot: input.vaultRoot,
  });
}

async function resolveReferencedExperimentOutcome(input: {
  attributes: ExperimentFrontmatter;
  relativePath: string;
  vaultRoot: string;
}): Promise<WriteExperimentOutcomeResult | null> {
  const reference = input.attributes.outcomeRef;
  if (reference === undefined) {
    return null;
  }
  if (reference.relativePath === undefined) {
    throw new VaultError(
      "EXPERIMENT_OUTCOME_REFERENCE_INVALID",
      "The saved experiment outcome reference is missing or does not match its immutable artifact.",
      {
        experimentId: input.attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }

  const outcome = await readExistingExperimentOutcome(
    input.vaultRoot,
    reference.relativePath,
  );
  const expectedOutcomeId = outcome === null
    ? null
    : `${input.attributes.experimentId}-outcome-${outcome.asOf}`;
  const expectedOutcomePath = outcome === null
    ? null
    : `${VAULT_LAYOUT.experimentsDirectory}/outcomes/${input.attributes.slug}-${outcome.asOf}.json`;
  if (
    outcome === null ||
    outcome.generatedAt !== reference.generatedAt ||
    outcome.outcomeId !== reference.outcomeId ||
    outcome.outcomeId !== expectedOutcomeId ||
    reference.relativePath !== expectedOutcomePath ||
    outcome.experiment.id !== input.attributes.experimentId ||
    outcome.experiment.slug !== input.attributes.slug ||
    !isDeepStrictEqual(
      outcome.commonsProtocolRef ?? null,
      input.attributes.commonsProtocolRef ?? null,
    ) ||
    !isDeepStrictEqual(
      outcome.protocolRef ?? null,
      input.attributes.protocolRef ?? null,
    ) ||
    !isDeepStrictEqual(
      outcome.effectiveProtocolSnapshot ?? null,
      input.attributes.effectiveProtocolSnapshot ?? null,
    ) ||
    input.attributes.outcome?.latestOutcomeId !== reference.outcomeId ||
    input.attributes.outcome?.finalAnalysisStatus !== "generated"
  ) {
    throw new VaultError(
      "EXPERIMENT_OUTCOME_REFERENCE_INVALID",
      "The saved experiment outcome reference is missing or does not match its immutable artifact.",
      {
        experimentId: input.attributes.experimentId,
        relativePath: input.relativePath,
      },
    );
  }

  return {
    experimentId: input.attributes.experimentId,
    slug: input.attributes.slug,
    relativePath: input.relativePath,
    status: input.attributes.status,
    outcome,
    outcomePath: reference.relativePath,
    updatedExperiment: false,
  };
}

export function shouldAdvanceReferencedExperimentOutcome(input: {
  frontmatter: ExperimentFrontmatter;
  referencedOutcome: ExperimentOutcome;
  requestedAsOf: string;
}): boolean {
  const currentInterventionEnd = input.frontmatter.runPlan?.interventionEnd;
  const savedInterventionEnd = input.referencedOutcome.windows.interventionEnd;
  if (
    currentInterventionEnd === undefined ||
    input.referencedOutcome.experiment.status !== "active" ||
    input.requestedAsOf <= input.referencedOutcome.asOf
  ) {
    return false;
  }
  const interventionEnd =
    savedInterventionEnd !== null && savedInterventionEnd > currentInterventionEnd
      ? savedInterventionEnd
      : currentInterventionEnd;
  if (input.requestedAsOf < interventionEnd) {
    return false;
  }

  return (
    input.frontmatter.status === "active" ||
    (
      input.frontmatter.status === "completed" &&
      (
        input.frontmatter.endedOn === undefined ||
        input.frontmatter.endedOn >= interventionEnd
      )
    )
  );
}

async function readExistingExperimentOutcome(
  vaultRoot: string,
  outcomePath: string,
): Promise<ExperimentOutcome | null> {
  try {
    const value: unknown = JSON.parse(await readUtf8File(vaultRoot, outcomePath));
    const parsed = experimentOutcomeSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof VaultError && error.code === "VAULT_FILE_MISSING")
    ) {
      return null;
    }
    throw error;
  }
}

async function appendExperimentLifecycleEvent(
  input: AppendExperimentLifecycleEventInput,
): Promise<AppendExperimentLifecycleEventResult> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const { document } = await readExperimentFrontmatterDocument(
    input.vaultRoot,
    input.relativePath,
  );
  const occurredAt = normalizeTimestampInput(input.occurredAt ?? new Date());
  if (!occurredAt) {
    throw new VaultError("INVALID_TIMESTAMP", "Experiment lifecycle event requires occurredAt.");
  }

  const nextAttributes = validateExperimentFrontmatter(
    compactObject({
      ...document.attributes,
      endedOn: input.endedOn ?? document.attributes.endedOn,
      status: input.nextStatus ?? document.attributes.status,
    }),
    input.relativePath,
  );
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: experimentFrontmatterObject(nextAttributes),
    body: appendExperimentNoteBlock(document.body, {
      occurredAt,
      title: input.title,
      note: input.note,
    }),
  });
  const eventRecord = buildExperimentEventRecord({
    occurredAt,
    title: `${document.attributes.title} ${input.title}`.trim(),
    note: input.note,
    experimentId: document.attributes.experimentId,
    experimentSlug: document.attributes.slug,
    phase: input.phase,
    timeZone: vault.metadata.timezone,
  });
  const ledgerFile = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    occurredAt,
    "occurredAt",
  );

  const result = await commitAuditedCanonicalWrite<AppendExperimentLifecycleEventResult>({
    vaultRoot: input.vaultRoot,
    operationType: "experiment_lifecycle_event",
    summary: `Append ${input.phase} lifecycle event for ${document.attributes.experimentId}`,
    occurredAt,
    audit: {
      action: "experiment_lifecycle",
      commandName:
        input.phase === "checkpoint" ? "core.checkpointExperiment" : "core.stopExperiment",
      summary: `Appended ${input.phase} lifecycle event for ${document.attributes.experimentId}.`,
      targetIds: [document.attributes.experimentId, eventRecord.id],
    },
    mutate: async ({ batch }) => {
      const write = await stageMarkdownDocumentWrite(
        batch,
        {
          relativePath: input.relativePath,
          created: false,
        },
        nextMarkdown,
        {
          overwrite: true,
        },
      );
      await batch.stageJsonlAppend(ledgerFile, `${JSON.stringify(eventRecord)}\n`);

      return {
        result: {
          experimentId: document.attributes.experimentId,
          slug: document.attributes.slug,
          relativePath: input.relativePath,
          status: nextAttributes.status,
          eventId: eventRecord.id,
          ledgerFile,
          updated: true,
        },
        changes: [
          ...write.changes,
          {
            path: ledgerFile,
            op: "append",
          },
        ],
      };
    },
  });

  return result.result;
}

export async function checkpointExperiment(
  input: Omit<AppendExperimentLifecycleEventInput, "phase" | "nextStatus" | "endedOn">,
): Promise<AppendExperimentLifecycleEventResult> {
  return appendExperimentLifecycleEvent({
    ...input,
    phase: "checkpoint",
  });
}

export async function stopExperiment(
  input: {
    vaultRoot: string;
    relativePath: string;
    occurredAt?: string;
    title: string;
    note?: string;
  },
): Promise<AppendExperimentLifecycleEventResult> {
  const occurredAt = normalizeTimestampInput(input.occurredAt ?? new Date());
  if (!occurredAt) {
    throw new VaultError("INVALID_TIMESTAMP", "Experiment lifecycle event requires occurredAt.");
  }
  const vault = await loadVault({ vaultRoot: input.vaultRoot });

  return appendExperimentLifecycleEvent({
    ...input,
    phase: "stop",
    occurredAt,
    nextStatus: "completed",
    endedOn: toLocalDayKey(occurredAt, vault.metadata.timezone ?? defaultTimeZone(), "occurredAt"),
  });
}
