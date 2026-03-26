import { emitAuditRecord } from "../audit.js";
import { toIsoTimestamp } from "../time.js";
import { isPlainRecord } from "../types.js";
import { VaultError } from "../errors.js";

import type { UnknownRecord } from "../types.js";
import type {
  AllergyProposal,
  AssessmentProposalSource,
  AssessmentResponseProposal,
  AssessmentResponseRecord,
  ConditionProposal,
  FamilyMemberProposal,
  GeneticVariantProposal,
  GoalProposal,
  HistoryEventProposal,
  ProfileSnapshotProposal,
  ProtocolProposal,
} from "./types.js";
import { readAssessmentResponse } from "./storage.js";

interface ProjectAssessmentResponseInput {
  vaultRoot?: string;
  assessmentId?: string;
  assessmentResponse?: AssessmentResponseRecord;
}

interface CandidateNode {
  pointer: string;
  value: unknown;
}

const CONTAINER_KEYS = ["response", "proposal", "proposals", "structured", "data"] as const;

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length === 0 ? undefined : normalized;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toStringOrUndefined(entry))
    .filter((entry): entry is string => entry !== undefined);
}

function toPlainObject(value: unknown, fallbackKey: string): UnknownRecord | null {
  if (isPlainRecord(value)) {
    return value;
  }

  const scalar = toStringOrUndefined(value);
  return scalar ? { [fallbackKey]: scalar } : null;
}

function buildSource(record: AssessmentResponseRecord | undefined, pointer: string): AssessmentProposalSource {
  return {
    assessmentId: record?.id,
    assessmentPointer: pointer,
    importedFrom: record?.source,
    sourcePath: record?.rawPath,
  };
}

function collectNodes(container: unknown, pointer: string): CandidateNode[] {
  if (!isPlainRecord(container)) {
    return [];
  }

  const nodes: CandidateNode[] = [];

  for (const key of CONTAINER_KEYS) {
    const child = container[key];

    if (isPlainRecord(child)) {
      nodes.push({ pointer: `${pointer}/${key}`, value: child });
      nodes.push(...collectNodes(child, `${pointer}/${key}`));
    }
  }

  return nodes;
}

function resolveProjectionContainers(response: UnknownRecord): CandidateNode[] {
  return [{ pointer: "", value: response }, ...collectNodes(response, "")];
}

function readCategoryEntries(containers: readonly CandidateNode[], keys: readonly string[]): CandidateNode[] {
  const entries: CandidateNode[] = [];

  for (const container of containers) {
    if (!isPlainRecord(container.value)) {
      continue;
    }

    for (const key of keys) {
      const candidate = container.value[key];

      asArray(candidate).forEach((entry, index) => {
        if (entry !== undefined && entry !== null) {
          entries.push({
            pointer: `${container.pointer}/${key}${Array.isArray(candidate) ? `/${index}` : ""}`,
            value: entry,
          });
        }
      });
    }
  }

  return entries;
}

function normalizeGoalProposal(
  value: unknown,
  source: AssessmentProposalSource,
): GoalProposal | null {
  const raw = toPlainObject(value, "title");

  if (!raw) {
    return null;
  }

  const title =
    toStringOrUndefined(raw.title) ??
    toStringOrUndefined(raw.name) ??
    toStringOrUndefined(raw.goal) ??
    toStringOrUndefined(raw.label);

  if (!title) {
    return null;
  }

  return {
    source,
    title,
    status: toStringOrUndefined(raw.status),
    horizon: toStringOrUndefined(raw.horizon),
    priority: toStringOrUndefined(raw.priority),
    note:
      toStringOrUndefined(raw.note) ??
      toStringOrUndefined(raw.description) ??
      toStringOrUndefined(raw.details),
    tags: toStringArray(raw.tags),
    raw,
  };
}

function normalizeConditionProposal(
  value: unknown,
  source: AssessmentProposalSource,
): ConditionProposal | null {
  const raw = toPlainObject(value, "name");

  if (!raw) {
    return null;
  }

  const name =
    toStringOrUndefined(raw.name) ??
    toStringOrUndefined(raw.condition) ??
    toStringOrUndefined(raw.diagnosis) ??
    toStringOrUndefined(raw.label);

  if (!name) {
    return null;
  }

  return {
    source,
    name,
    status: toStringOrUndefined(raw.status),
    onsetAt:
      toStringOrUndefined(raw.onsetAt) ??
      toStringOrUndefined(raw.diagnosedAt) ??
      toStringOrUndefined(raw.recordedAt),
    note:
      toStringOrUndefined(raw.note) ??
      toStringOrUndefined(raw.description) ??
      toStringOrUndefined(raw.details),
    raw,
  };
}

function normalizeAllergyProposal(
  value: unknown,
  source: AssessmentProposalSource,
): AllergyProposal | null {
  const raw = toPlainObject(value, "substance");

  if (!raw) {
    return null;
  }

  const substance =
    toStringOrUndefined(raw.substance) ??
    toStringOrUndefined(raw.allergen) ??
    toStringOrUndefined(raw.name) ??
    toStringOrUndefined(raw.label);

  if (!substance) {
    return null;
  }

  return {
    source,
    substance,
    reaction:
      toStringOrUndefined(raw.reaction) ??
      toStringOrUndefined(raw.reactions),
    severity: toStringOrUndefined(raw.severity),
    note:
      toStringOrUndefined(raw.note) ??
      toStringOrUndefined(raw.description),
    raw,
  };
}

function normalizeProtocolProposal(
  value: unknown,
  source: AssessmentProposalSource,
): ProtocolProposal | null {
  const raw = toPlainObject(value, "name");

  if (!raw) {
    return null;
  }

  const name =
    toStringOrUndefined(raw.name) ??
    toStringOrUndefined(raw.medicationName) ??
    toStringOrUndefined(raw.supplementName) ??
    toStringOrUndefined(raw.label);

  if (!name) {
    return null;
  }

  const dose = [toStringOrUndefined(raw.dose), toStringOrUndefined(raw.unit)]
    .filter((entry): entry is string => entry !== undefined)
    .join(" ")
    .trim();

  return {
    source,
    name,
    kind: toStringOrUndefined(raw.kind) ?? toStringOrUndefined(raw.type),
    status: toStringOrUndefined(raw.status),
    dose: dose || undefined,
    schedule:
      toStringOrUndefined(raw.schedule) ??
      toStringOrUndefined(raw.frequency),
    note:
      toStringOrUndefined(raw.note) ??
      toStringOrUndefined(raw.instructions),
    raw,
  };
}

function normalizeHistoryEventProposal(
  value: unknown,
  source: AssessmentProposalSource,
): HistoryEventProposal | null {
  const raw = toPlainObject(value, "title");

  if (!raw) {
    return null;
  }

  const title =
    toStringOrUndefined(raw.title) ??
    toStringOrUndefined(raw.name) ??
    toStringOrUndefined(raw.event) ??
    toStringOrUndefined(raw.label);

  if (!title) {
    return null;
  }

  const occurredAtCandidate =
    toStringOrUndefined(raw.occurredAt) ??
    toStringOrUndefined(raw.recordedAt) ??
    toStringOrUndefined(raw.date);

  return {
    source,
    kind:
      toStringOrUndefined(raw.kind) ??
      toStringOrUndefined(raw.type) ??
      "note",
    title,
    occurredAt:
      occurredAtCandidate === undefined
        ? undefined
        : toIsoTimestamp(occurredAtCandidate, "occurredAt"),
    note:
      toStringOrUndefined(raw.note) ??
      toStringOrUndefined(raw.description),
    raw,
  };
}

function normalizeFamilyMemberProposal(
  value: unknown,
  source: AssessmentProposalSource,
): FamilyMemberProposal | null {
  const raw = toPlainObject(value, "name");

  if (!raw) {
    return null;
  }

  const name =
    toStringOrUndefined(raw.name) ??
    toStringOrUndefined(raw.label) ??
    toStringOrUndefined(raw.relative) ??
    toStringOrUndefined(raw.relationship);

  if (!name) {
    return null;
  }

  return {
    source,
    name,
    relationship:
      toStringOrUndefined(raw.relationship) ??
      toStringOrUndefined(raw.relation),
    note:
      toStringOrUndefined(raw.note) ??
      toStringOrUndefined(raw.description),
    raw,
  };
}

function normalizeGeneticVariantProposal(
  value: unknown,
  source: AssessmentProposalSource,
): GeneticVariantProposal | null {
  const raw = toPlainObject(value, "variant");

  if (!raw) {
    return null;
  }

  const variant =
    toStringOrUndefined(raw.variant) ??
    toStringOrUndefined(raw.name) ??
    toStringOrUndefined(raw.label);

  if (!variant) {
    return null;
  }

  return {
    source,
    gene: toStringOrUndefined(raw.gene),
    variant,
    significance:
      toStringOrUndefined(raw.significance) ??
      toStringOrUndefined(raw.classification),
    zygosity: toStringOrUndefined(raw.zygosity),
    raw,
  };
}

function normalizeProfileSnapshotProposal(
  value: unknown,
  source: AssessmentProposalSource,
): ProfileSnapshotProposal | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  const nestedProfile = isPlainRecord(value.profile) ? value.profile : null;
  const profile = nestedProfile ?? value;
  return {
    source:
      source.importedFrom === "derived" ? "derived" :
      source.assessmentId ? "assessment_projection" : "manual",
    sourceAssessmentIds: source.assessmentId ? [source.assessmentId] : undefined,
    profile,
  };
}

async function resolveAssessmentResponse(
  input: ProjectAssessmentResponseInput,
): Promise<AssessmentResponseRecord | undefined> {
  if (input.assessmentResponse) {
    return input.assessmentResponse;
  }

  if (input.vaultRoot && input.assessmentId) {
    return readAssessmentResponse({
      vaultRoot: input.vaultRoot,
      assessmentId: input.assessmentId,
    });
  }

  if (input.assessmentId) {
    throw new VaultError(
      "ASSESSMENT_RESPONSE_PROJECT_INVALID",
      "vaultRoot is required when projecting by assessmentId.",
      { assessmentId: input.assessmentId },
    );
  }

  return undefined;
}

export async function projectAssessmentResponse(
  input: ProjectAssessmentResponseInput,
): Promise<AssessmentResponseProposal> {
  const assessmentResponse = await resolveAssessmentResponse(input);
  const response = assessmentResponse?.responses;

  if (!response) {
    throw new VaultError(
      "ASSESSMENT_RESPONSE_PROJECT_INVALID",
      "Assessment response payload is required for projection.",
    );
  }

  const containers = resolveProjectionContainers(response);

  const profileSnapshots = readCategoryEntries(containers, [
    "profile",
    "profileSnapshot",
    "profileSnapshots",
    "currentProfile",
  ])
    .map((entry) => normalizeProfileSnapshotProposal(entry.value, buildSource(assessmentResponse, entry.pointer)))
    .filter((entry): entry is ProfileSnapshotProposal => entry !== null);

  const goals = readCategoryEntries(containers, ["goals", "goal"])
    .map((entry) => normalizeGoalProposal(entry.value, buildSource(assessmentResponse, entry.pointer)))
    .filter((entry): entry is GoalProposal => entry !== null);

  const conditions = readCategoryEntries(containers, ["conditions", "condition"])
    .map((entry) => normalizeConditionProposal(entry.value, buildSource(assessmentResponse, entry.pointer)))
    .filter((entry): entry is ConditionProposal => entry !== null);

  const allergies = readCategoryEntries(containers, ["allergies", "allergy"])
    .map((entry) => normalizeAllergyProposal(entry.value, buildSource(assessmentResponse, entry.pointer)))
    .filter((entry): entry is AllergyProposal => entry !== null);

  const protocols = readCategoryEntries(containers, ["protocols", "protocol", "medications", "supplements"])
    .map((entry) => normalizeProtocolProposal(entry.value, buildSource(assessmentResponse, entry.pointer)))
    .filter((entry): entry is ProtocolProposal => entry !== null);

  const historyEvents = readCategoryEntries(containers, ["historyEvents", "history", "events", "historyEvent"])
    .map((entry) => normalizeHistoryEventProposal(entry.value, buildSource(assessmentResponse, entry.pointer)))
    .filter((entry): entry is HistoryEventProposal => entry !== null);

  const familyMembers = readCategoryEntries(containers, ["familyMembers", "family", "familyMember"])
    .map((entry) => normalizeFamilyMemberProposal(entry.value, buildSource(assessmentResponse, entry.pointer)))
    .filter((entry): entry is FamilyMemberProposal => entry !== null);

  const geneticVariants = readCategoryEntries(containers, [
    "geneticVariants",
    "variants",
    "genetics",
    "geneticVariant",
  ])
    .map((entry) => normalizeGeneticVariantProposal(entry.value, buildSource(assessmentResponse, entry.pointer)))
    .filter((entry): entry is GeneticVariantProposal => entry !== null);

  const proposal: AssessmentResponseProposal = {
    assessmentId: assessmentResponse.id,
    sourcePath: assessmentResponse.rawPath,
    profileSnapshots,
    goals,
    conditions,
    allergies,
    protocols,
    historyEvents,
    familyMembers,
    geneticVariants,
  };

  if (input.vaultRoot) {
    const audit = await emitAuditRecord({
      vaultRoot: input.vaultRoot,
      action: "intake_project",
      commandName: "core.projectAssessmentResponse",
      summary: `Projected assessment ${assessmentResponse.id} into health proposals.`,
      occurredAt: new Date(),
      targetIds: [assessmentResponse.id],
    });
    proposal.auditPath = audit.relativePath;
  }

  return proposal;
}
