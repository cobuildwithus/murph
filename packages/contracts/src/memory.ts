import * as z from "./zod-runtime.ts";

import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  ID_PREFIXES,
} from "./constants.ts";
import {
  parseFrontmatterDocument,
  type FrontmatterParseProblem,
} from "./frontmatter.ts";
import {
  generateContractId,
  isContractId,
} from "./ids.ts";
import { withContractMetadata } from "./schema-metadata.ts";

export const memoryDocumentRelativePath = "bank/memory.md";
export const memoryDocumentDocType = FRONTMATTER_DOC_TYPES.memory;
export const memoryDocumentSchemaVersion = CONTRACT_SCHEMA_VERSION.memoryFrontmatter;

export const MEMORY_DISPLAY_NAME_MAX_LENGTH = 120;
export const MEMORY_DISPLAY_NAME_RECORD_PREFIX = "Preferred display name: " as const;

// Mirrors the vault-share profile-name delivery rule: a name accepted into memory
// must never be rejected later by the delivery parser. Expressed as a regex so
// generated schemas retain the same no-blank/no-control-character constraint.
const MEMORY_DISPLAY_NAME_PATTERN =
  /^[^\s\u0000-\u001f\u007f](?:[^\u0000-\u001f\u007f]*[^\s\u0000-\u001f\u007f])?$/u;

export const memoryDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MEMORY_DISPLAY_NAME_MAX_LENGTH)
  .regex(MEMORY_DISPLAY_NAME_PATTERN, {
    message: "displayName must not be blank or contain control characters",
  });

export const memorySectionValues = [
  "Identity",
  "Preferences",
  "Instructions",
  "Context",
] as const;

export const memorySectionSchema = z.enum(memorySectionValues);

export const memoryDemographicsPatchSchema = z.object({
  birthYear: z.number().int().min(1900).max(9999).nullable().optional(),
  age: z.number().int().min(13).max(120).nullable().optional(),
  biologicalSex: z.enum(["female", "male"]).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.birthYear !== undefined && value.age !== undefined) {
    context.addIssue({ code: "custom", message: "Supply birthYear or age, never both." });
  }
  if (value.birthYear === undefined && value.age === undefined && value.biologicalSex === undefined) {
    context.addIssue({ code: "custom", message: "Supply at least one demographic field." });
  }
});

export const memoryDemographicsSchema = z.object({
  birthYear: z.number().int().nullable(),
  birthYearPrecision: z.enum(["exact", "approximate"]).nullable(),
  biologicalSex: z.enum(["female", "male"]).nullable(),
  status: z.enum(["resolved", "unresolved"]),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type MemoryDemographics = z.infer<typeof memoryDemographicsSchema>;
export type MemoryDemographicsPatch = z.infer<typeof memoryDemographicsPatchSchema>;
export type SetMemoryDemographicsInput = MemoryDemographicsPatch & { asOf?: string; now?: Date };

// One marker is sufficient while the serialized member-action mailbox retains
// the request until its post-checkpoint outcome. Generic memory edits preserve it.
const memoryDemographicsActionSchema = z.object({
  actionId: z.string().uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum(["applied", "unchanged", "rejected"]),
}).strict();

const canonicalMemoryRecordIdSchema = z.string().refine(
  (value) => isContractId(value, ID_PREFIXES.memory),
  {
    message: "Memory record id must match mem_<ULID>.",
  },
);

export const memoryRecordMetadataSchema = z
  .object({
    id: canonicalMemoryRecordIdSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const memoryDocumentFrontmatterSchema = withContractMetadata(
  z
    .object({
      docType: z.literal(memoryDocumentDocType),
      schemaVersion: z.literal(memoryDocumentSchemaVersion),
      title: z.string().min(1).default("Memory"),
      updatedAt: z.string().min(1),
      lastDemographicsAction: memoryDemographicsActionSchema.optional(),
    })
    .strict(),
  "@murphai/contracts/frontmatter-memory.schema.json",
  "Murph Memory Frontmatter",
);

export const memoryRecordSchema = z
  .object({
    id: canonicalMemoryRecordIdSchema,
    section: memorySectionSchema,
    text: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    sourceLine: z.number().int().positive(),
    sourcePath: z.string().min(1),
  })
  .strict();

export const memoryDocumentSchema = z
  .object({
    frontmatter: memoryDocumentFrontmatterSchema,
    records: z.array(memoryRecordSchema),
  })
  .strict();

export const memoryDocumentSnapshotSchema = memoryDocumentSchema.extend({
  exists: z.boolean(),
  markdown: z.string(),
  sourcePath: z.string().min(1),
  updatedAt: z.string().min(1).nullable(),
});

export type MemoryDocumentDocType = typeof memoryDocumentDocType;
export type MemorySection = (typeof memorySectionValues)[number];
export type MemoryDocumentFrontmatter = z.infer<typeof memoryDocumentFrontmatterSchema>;
export type MemoryRecordMetadata = z.infer<typeof memoryRecordMetadataSchema>;
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type MemoryDocument = z.infer<typeof memoryDocumentSchema>;
export type MemoryDocumentSnapshot = z.infer<typeof memoryDocumentSnapshotSchema>;

export interface ParseMemoryDocumentInput {
  sourcePath?: string | null;
  text: string;
}

export type MemoryDocumentParseIssue =
  | "frontmatter_invalid"
  | "frontmatter_contract_invalid"
  | "memory_section_invalid"
  | "record_metadata_missing"
  | "record_metadata_invalid"
  | "record_invalid";

export class MemoryDocumentParseError extends Error {
  readonly code = "MEMORY_DOCUMENT_INVALID";
  readonly details: {
    field?: string;
    issue: MemoryDocumentParseIssue;
    lineNumber?: number;
    sourcePath: string;
  };

  constructor(input: {
    field?: string;
    issue: MemoryDocumentParseIssue;
    lineNumber?: number;
    sourcePath: string;
  }) {
    const sourcePath = normalizeMemorySourcePath(input.sourcePath);
    const lineNumber = Number.isSafeInteger(input.lineNumber) && (input.lineNumber ?? 0) > 0
      ? input.lineNumber
      : undefined;
    super(
      lineNumber === undefined
        ? `Canonical memory document ${sourcePath} is invalid.`
        : `Canonical memory document ${sourcePath}:${lineNumber} is invalid.`,
    );
    this.name = "MemoryDocumentParseError";
    this.details = {
      sourcePath,
      issue: input.issue,
      ...(lineNumber === undefined ? {} : { lineNumber }),
      ...(input.field && /^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/u.test(input.field)
        ? { field: input.field }
        : {}),
    };
  }
}

export interface RenderMemoryDocumentInput {
  document: MemoryDocument;
}

export interface UpsertMemoryRecordInput {
  now?: Date;
  recordId?: string | null;
  section: MemorySection;
  text: string;
}

export interface SetMemoryDisplayNameInput {
  displayName: string;
  now?: Date;
}

export interface ForgetMemoryRecordInput {
  recordId: string;
}

export type MemoryDisplayNameSource = "canonical" | "legacy";

export interface MemoryDisplayNameResolution {
  displayName: string;
  record: MemoryRecord;
  source: MemoryDisplayNameSource;
}

interface MemoryDisplayNameCandidate extends MemoryDisplayNameResolution {}

const MEMORY_COMMENT_PREFIX = "murph-memory:";
const MEMORY_ROOT_HEADING = "# Memory";
const memorySectionOrder = new Map<MemorySection, number>(
  memorySectionValues.map((section, index) => [section, index]),
);

export function createDefaultMemoryFrontmatter(now = new Date()): MemoryDocumentFrontmatter {
  return memoryDocumentFrontmatterSchema.parse({
    docType: memoryDocumentDocType,
    schemaVersion: memoryDocumentSchemaVersion,
    title: "Memory",
    updatedAt: now.toISOString(),
  });
}

export function createEmptyMemoryDocument(now = new Date()): MemoryDocument {
  return {
    frontmatter: createDefaultMemoryFrontmatter(now),
    records: [],
  };
}

export function parseMemoryDocument(input: ParseMemoryDocumentInput): MemoryDocument {
  const sourcePath = input.sourcePath ?? memoryDocumentRelativePath;
  const parsed = parseFrontmatterDocument(input.text, {
    createError: (problem: FrontmatterParseProblem) =>
      new MemoryDocumentParseError({
        issue: "frontmatter_invalid",
        sourcePath,
        ...(problem.index === undefined ? {} : { lineNumber: problem.index + 2 }),
      }),
  });
  const frontmatterResult = memoryDocumentFrontmatterSchema.safeParse(parsed.attributes);
  if (!frontmatterResult.success) {
    throw new MemoryDocumentParseError({
      issue: "frontmatter_contract_invalid",
      sourcePath,
      field: frontmatterResult.error.issues[0]?.path.map(String).join("."),
    });
  }
  const bodyStartLine = resolveMemoryBodyStartLine(input.text);
  const records = parseMemoryDocumentBody(parsed.body, sourcePath, bodyStartLine);

  return {
    frontmatter: frontmatterResult.data,
    records,
  };
}

export function renderMemoryDocument(input: RenderMemoryDocumentInput): string {
  const document = memoryDocumentSchema.parse(input.document);
  const body = renderMemoryDocumentBody(document.records);

  return renderMemoryFrontmatter(document.frontmatter, body);
}

export function createMemoryRecordId(
  input: Pick<UpsertMemoryRecordInput, "section" | "text">,
): string {
  memorySectionSchema.parse(input.section);
  normalizeMemoryText(input.text);

  return generateContractId(ID_PREFIXES.memory);
}

export function upsertMemoryRecord(input: MemoryDocument, next: UpsertMemoryRecordInput): {
  created: boolean; document: MemoryDocument; record: MemoryRecord;
} {
  normalizeMemoryRecordId(input.records, next.recordId ?? null);
  const text = normalizeMemoryText(next.text);
  const kind = memoryDemographicKind(text);
  const existing = input.records.find(record => record.id === next.recordId);
  const previousKind = existing ? memoryDemographicKind(existing.text) : null;
  if (previousKind !== null && previousKind !== kind) {
    throw new Error("Replace a demographic record with the same kind, or forget it explicitly.");
  }
  if (kind === null) return upsertMemoryRecordRaw(input, next);
  const fact = parseMemoryDemographic(text);
  if (next.section !== "Identity" || !fact) {
    throw new Error("Demographic records must use a valid canonical Identity format.");
  }
  if (fact.kind === "dob") {
    // A newer full date supersedes an older year or dated age.
    const result = upsertMemoryRecordRaw(input, next);
    result.document.records = result.document.records.filter(record => {
      const other = memoryDemographicKind(record.text);
      return other !== "age" && other !== "year";
    });
    return result;
  }
  const base = existing && previousKind === null
    ? { frontmatter: input.frontmatter, records: input.records.filter(record => record.id !== existing.id) }
    : input;
  const document = setMemoryDemographics(base, {
    now: next.now,
    ...(fact.kind === "sex" ? { biologicalSex: fact.sex }
      : fact.kind === "year" ? { birthYear: fact.year }
      : { age: fact.age, asOf: fact.asOf }),
  });
  const record = document.records.find(record => memoryDemographicKind(record.text) === kind)
    ?? document.records.find(record => kind === "year" && memoryDemographicKind(record.text) === "dob");
  if (!record) throw new Error("The demographic write did not produce canonical evidence.");
  return {
    document: { frontmatter: document.frontmatter, records: document.records },
    record, created: !existing && !input.records.some(previous => previous.id === record.id),
  };
}

function upsertMemoryRecordRaw(
  input: MemoryDocument,
  next: UpsertMemoryRecordInput,
): {
  created: boolean;
  document: MemoryDocument;
  record: MemoryRecord;
} {
  const now = (next.now ?? new Date()).toISOString();
  const normalizedText = normalizeMemoryText(next.text);
  const explicitRecordId = normalizeMemoryRecordId(input.records, next.recordId ?? null);
  const existingContentRecord =
    explicitRecordId === null
      ? input.records.find(
          (record) =>
            record.section === next.section &&
            normalizeMemoryText(record.text) === normalizedText,
        ) ?? null
      : null;
  const nextRecordId =
    explicitRecordId ?? existingContentRecord?.id ?? createMemoryRecordId({
      section: next.section,
      text: normalizedText,
    });
  const existingIndex = input.records.findIndex((record) => record.id === nextRecordId);
  const existingRecord = existingIndex >= 0 ? input.records[existingIndex] ?? null : null;
  const demographicKind = memoryDemographicKind(normalizedText);
  const record: MemoryRecord = memoryRecordSchema.parse({
    id: nextRecordId,
    section: next.section,
    text: normalizedText,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
    sourceLine: existingRecord?.sourceLine ?? input.records.length + 1,
    sourcePath: existingRecord?.sourcePath ?? memoryDocumentRelativePath,
  });

  const records = input.records.filter((entry) => entry.id !== nextRecordId
    && (demographicKind === null || memoryDemographicKind(entry.text) !== demographicKind));
  const insertionIndex = findMemoryInsertionIndex(records, record.section);
  records.splice(insertionIndex, 0, record);

  return {
    created: existingRecord === null,
    document: {
      frontmatter: {
        ...input.frontmatter,
        updatedAt: now,
      },
      records,
    },
    record,
  };
}

export function setMemoryDisplayName(
  input: MemoryDocument,
  next: SetMemoryDisplayNameInput,
): {
  created: boolean;
  document: MemoryDocument;
  record: MemoryRecord;
} {
  const displayName = memoryDisplayNameSchema.parse(next.displayName);
  const canonicalCandidates = collectCanonicalMemoryDisplayNameCandidates(input.records);
  const target = selectMostRecentMemoryDisplayNameCandidate(canonicalCandidates);
  const existingDuplicateCanonicalRecordIds = new Set(
    input.records
      .filter((record) => hasCanonicalMemoryDisplayNameRecordText(record.text))
      .filter((record) => record.id !== target?.record.id)
      .map((record) => record.id),
  );
  if (
    target !== null
    && target.displayName === displayName
    && existingDuplicateCanonicalRecordIds.size === 0
  ) {
    return {
      created: false,
      document: input,
      record: target.record,
    };
  }

  const updated = upsertMemoryRecord(input, {
    now: next.now,
    recordId: target?.record.id ?? null,
    section: "Identity",
    text: formatMemoryDisplayNameRecordText(displayName),
  });
  const duplicateCanonicalRecordIds = new Set(
    input.records
      .filter((record) => hasCanonicalMemoryDisplayNameRecordText(record.text))
      .filter((record) => record.id !== updated.record.id)
      .map((record) => record.id),
  );
  if (duplicateCanonicalRecordIds.size === 0) {
    return updated;
  }

  return {
    ...updated,
    document: {
      ...updated.document,
      records: updated.document.records.filter(
        (record) => !duplicateCanonicalRecordIds.has(record.id),
      ),
    },
  };
}

export function forgetMemoryRecord(
  input: MemoryDocument,
  next: ForgetMemoryRecordInput,
): {
  document: MemoryDocument;
  record: MemoryRecord | null;
} {
  const index = input.records.findIndex((record) => record.id === next.recordId);
  if (index < 0) {
    return {
      document: input,
      record: null,
    };
  }

  const record = input.records[index] ?? null;
  const kind = record ? memoryDemographicKind(record.text) : null;
  const records = input.records.filter((entry) => entry.id !== next.recordId
    && (kind === null || memoryDemographicKind(entry.text) !== kind));

  return {
    document: {
      frontmatter: {
        ...input.frontmatter,
        updatedAt: new Date().toISOString(),
      },
      records,
    },
    record,
  };
}

export function buildMemoryPromptBlock(input: MemoryDocument): string | null {
  if (input.records.length === 0) {
    return null;
  }

  const sections = memorySectionValues.flatMap((section) => {
    const records = input.records.filter((record) => record.section === section);
    if (records.length === 0) {
      return [];
    }

    return [
      `${section}:\n${records.map((record) => `- ${record.text}`).join("\n")}`,
    ];
  });

  if (sections.length === 0) {
    return null;
  }

  return [
    "Memory lives in the canonical vault and is safe to rely on for durable user context.",
    `Memory:\n${sections.join("\n\n")}`,
  ].join("\n\n");
}

type MemoryDemographicKind = "dob" | "year" | "age" | "sex";
type MemoryDemographic =
  | { kind: "dob"; year: number }
  | { kind: "year"; year: number }
  | { kind: "age"; year: number; age: number; asOf: string }
  | { kind: "sex"; sex: "female" | "male" };

function memoryDemographicKind(text: string): MemoryDemographicKind | null {
  if (/^Date of birth\s*:/iu.test(text)) return "dob";
  if (/^Birth year\s*:/iu.test(text)) return "year";
  if (/^Age\s*:/iu.test(text)) return "age";
  if (/^Biological sex\s*:/iu.test(text)) return "sex";
  return null;
}

function validDemographicDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(date.getTime())
    && date.toISOString().slice(0, 10) === value;
}

function parseMemoryDemographic(text: string): MemoryDemographic | null {
  const dob = /^Date of birth: (\d{4}-\d{2}-\d{2})$/u.exec(text)?.[1];
  if (dob && validDemographicDate(dob) && Number(dob.slice(0, 4)) >= 1900) {
    return { kind: "dob", year: Number(dob.slice(0, 4)) };
  }
  const year = /^Birth year: (\d{4})$/u.exec(text)?.[1];
  if (year && Number(year) >= 1900) return { kind: "year", year: Number(year) };
  const age = /^Age: (\d{1,3}) \(as of (\d{4}-\d{2}-\d{2})\)$/u.exec(text);
  if (age?.[1] && age[2] && validDemographicDate(age[2])
    && Number(age[1]) >= 13 && Number(age[1]) <= 120) {
    return { kind: "age", year: Number(age[2].slice(0, 4)) - Number(age[1]), age: Number(age[1]), asOf: age[2] };
  }
  const sex = /^Biological sex: (female|male)$/u.exec(text)?.[1];
  return sex === "female" || sex === "male" ? { kind: "sex", sex } : null;
}

/** Only constrained evidence enters the projection; gender and prose never do. */
export async function resolveMemoryDemographics(input: MemoryDocument): Promise<MemoryDemographics> {
  const records = input.records.filter(record => memoryDemographicKind(record.text) !== null);
  const facts = new Map<MemoryDemographicKind, MemoryDemographic>();
  let invalidBirth = false;
  let invalidSex = false;
  for (const record of records) {
    const kind = memoryDemographicKind(record.text)!;
    const fact = parseMemoryDemographic(record.text);
    if (!fact || record.section !== "Identity" || facts.has(kind)) {
      if (kind === "sex") invalidSex = true;
      else invalidBirth = true;
    }
    if (fact) facts.set(kind, fact);
  }
  const birth = resolveMemoryBirthFacts(facts, invalidBirth);
  const sex = facts.get("sex");
  const selected = records.map(({ id, section, text, createdAt, updatedAt }) =>
    ({ id, section, text, createdAt, updatedAt })).sort((a, b) => a.id.localeCompare(b.id));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(selected)));
  return {
    birthYear: birth.year,
    birthYearPrecision: birth.precision,
    biologicalSex: invalidSex || sex?.kind !== "sex" ? null : sex.sex,
    status: birth.invalid || invalidSex ? "unresolved" : "resolved",
    revision: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
  };
}

function resolveMemoryBirthFacts(facts: ReadonlyMap<MemoryDemographicKind, MemoryDemographic>, invalid: boolean): {
  year: number | null; precision: "exact" | "approximate" | null; invalid: boolean;
} {
  const years = [...facts.values()].flatMap(fact => fact.kind === "dob" || fact.kind === "year" ? [fact.year] : []);
  const age = facts.get("age");
  const approximate = age?.kind === "age" ? age.year : null;
  const exact = years[0] ?? null;
  // At the source date, age N permits the current-year estimate or one year earlier.
  const disagreesWithAge = exact !== null && approximate !== null
    && exact !== approximate && exact !== approximate - 1;
  if (invalid || new Set(years).size > 1 || disagreesWithAge) {
    return { year: null, precision: null, invalid: true };
  }
  if (exact !== null) return { year: exact, precision: "exact", invalid: false };
  return { year: approximate, precision: approximate === null ? null : "approximate", invalid: false };
}

/** Validates the patch at admission time without making replay depend on today's year. */
export function validateMemoryDemographicsPatch(input: unknown, now = new Date()): MemoryDemographicsPatch {
  const patch = memoryDemographicsPatchSchema.parse(input);
  if (patch.birthYear != null && patch.birthYear > now.getUTCFullYear()) {
    throw new Error("Birth year must not be in the future.");
  }
  return patch;
}

export function setMemoryDemographics(
  input: MemoryDocument,
  next: SetMemoryDemographicsInput,
): MemoryDocument {
  const { now = new Date(), asOf, ...fields } = next;
  const patch = validateMemoryDemographicsPatch(fields, now);
  const date = asOf ?? now.toISOString().slice(0, 10);
  if (!validDemographicDate(date)) throw new Error("Age needs a valid source statement date.");
  let document = input;
  const remove = (kinds: MemoryDemographicKind[]) => {
    const records = document.records.filter(record => !kinds.includes(memoryDemographicKind(record.text)!));
    if (records.length !== document.records.length) document = { ...document, records };
  };
  const put = (kind: MemoryDemographicKind, text: string) => {
    const existing = document.records.filter(record => memoryDemographicKind(record.text) === kind);
    if (existing.length === 1 && existing[0]?.section === "Identity" && existing[0].text === text) return;
    document = upsertMemoryRecordRaw(document, {
      section: "Identity", text, now, recordId: existing[0]?.id,
    }).document;
  };
  if (patch.birthYear === null || patch.age === null) remove(["dob", "year", "age"]);
  else if (patch.birthYear !== undefined) {
    remove(["age"]);
    const dobs = document.records.filter(record => memoryDemographicKind(record.text) === "dob");
    const dob = dobs.length === 1 && dobs[0]?.section === "Identity" ? parseMemoryDemographic(dobs[0].text) : null;
    if (dob?.kind === "dob" && dob.year === patch.birthYear) remove(["year"]);
    else put("year", `Birth year: ${patch.birthYear}`);
  } else if (patch.age !== undefined) {
    // A newer stated age supersedes an older bare year; a full DOB stays and
    // must agree within the age's one-year window.
    remove(["year"]);
    put("age", `Age: ${patch.age} (as of ${date})`);
  }
  if (patch.biologicalSex === null) remove(["sex"]);
  else if (patch.biologicalSex !== undefined) put("sex", `Biological sex: ${patch.biologicalSex}`);
  return document === input ? input : {
    records: document.records, frontmatter: { ...document.frontmatter, updatedAt: now.toISOString() },
  };
}

export function formatMemoryDisplayNameRecordText(displayName: string): string {
  return `${MEMORY_DISPLAY_NAME_RECORD_PREFIX}${memoryDisplayNameSchema.parse(displayName)}`;
}

export function parseCanonicalMemoryDisplayNameRecordText(text: string): string | null {
  let normalizedText: string;
  try {
    normalizedText = normalizeMemoryText(text);
  } catch {
    return null;
  }

  if (!normalizedText.startsWith(MEMORY_DISPLAY_NAME_RECORD_PREFIX)) {
    return null;
  }

  const parsed = memoryDisplayNameSchema.safeParse(
    normalizedText.slice(MEMORY_DISPLAY_NAME_RECORD_PREFIX.length),
  );
  return parsed.success ? parsed.data : null;
}

export function hasCanonicalMemoryDisplayNameRecordText(text: string): boolean {
  try {
    return normalizeMemoryText(text).startsWith(MEMORY_DISPLAY_NAME_RECORD_PREFIX);
  } catch {
    return false;
  }
}

export function resolveMemoryDisplayName(
  input: MemoryDocument,
): MemoryDisplayNameResolution | null {
  const canonicalCandidates = collectCanonicalMemoryDisplayNameCandidates(input.records);
  const hasCanonicalEvidence = input.records.some(
    (record) =>
      record.section === "Identity"
      && hasCanonicalMemoryDisplayNameRecordText(record.text),
  );
  if (hasCanonicalEvidence) {
    return selectUniqueMemoryDisplayNameCandidate(canonicalCandidates);
  }

  return selectUniqueMemoryDisplayNameCandidate(
    collectLegacyMemoryDisplayNameCandidates(input.records),
  );
}

export function hasMemoryDisplayNameEvidence(input: MemoryDocument): boolean {
  return (
    input.records.some(
      (record) =>
        record.section === "Identity"
        && hasCanonicalMemoryDisplayNameRecordText(record.text),
    )
    || collectLegacyMemoryDisplayNameCandidates(input.records).length > 0
  );
}

function parseMemoryDocumentBody(
  body: string,
  sourcePath: string,
  bodyStartLine: number,
): MemoryRecord[] {
  const lines = body.replace(/\r\n/gu, "\n").split("\n");
  const records: MemoryRecord[] = [];
  const recordIds = new Set<string>();
  let activeSection: MemorySection | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const headingMatch = /^##\s+(.+)$/u.exec(line);
    if (headingMatch?.[1]) {
      activeSection = normalizeMemorySection(
        headingMatch[1],
        sourcePath,
        bodyStartLine + index,
      );
      continue;
    }

    const bulletMatch = /^-\s+(.*)$/u.exec(line);
    if (!bulletMatch?.[1] || activeSection === null) {
      continue;
    }

    const parsed = parseMemoryRecordLine({
      line: bulletMatch[1],
      section: activeSection,
      sourceLine: index + 1,
      diagnosticLine: bodyStartLine + index,
      sourcePath,
    });
    if (parsed) {
      if (recordIds.has(parsed.id)) {
        throw new MemoryDocumentParseError({
          issue: "record_invalid",
          sourcePath,
          lineNumber: bodyStartLine + index,
          field: "id",
        });
      }
      recordIds.add(parsed.id);
      records.push(parsed);
    }
  }

  return records;
}

function parseMemoryRecordLine(input: {
  line: string;
  section: MemorySection;
  sourceLine: number;
  diagnosticLine: number;
  sourcePath: string;
}): MemoryRecord | null {
  const match = /^(?<text>.*?)(?:\s+<!--\s*murph-memory:(?<metadata>\{.*\})\s*-->)?$/u.exec(
    input.line,
  );
  if (!match?.groups?.text) {
    return null;
  }

  let text: string;
  try {
    text = normalizeMemoryText(match.groups.text);
  } catch {
    throw new MemoryDocumentParseError({
      issue: "record_invalid",
      sourcePath: input.sourcePath,
      lineNumber: input.diagnosticLine,
      field: "text",
    });
  }
  const metadata = parseMemoryRecordMetadata(
    match.groups.metadata,
    input.sourcePath,
    input.diagnosticLine,
  );

  const record = memoryRecordSchema.safeParse({
    id: metadata.id,
    section: input.section,
    text,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    sourceLine: input.sourceLine,
    sourcePath: input.sourcePath,
  });
  if (!record.success) {
    throw new MemoryDocumentParseError({
      issue: "record_invalid",
      sourcePath: input.sourcePath,
      lineNumber: input.diagnosticLine,
      field: record.error.issues[0]?.path.map(String).join("."),
    });
  }
  return record.data;
}

function renderMemoryDocumentBody(records: readonly MemoryRecord[]): string {
  const chunks: string[] = [MEMORY_ROOT_HEADING];

  for (const section of memorySectionValues) {
    chunks.push("");
    chunks.push(`## ${section}`);
    const sectionRecords = records.filter((record) => record.section === section);
    if (sectionRecords.length > 0) {
      chunks.push("");
      for (const record of sectionRecords) {
        chunks.push(`- ${renderMemoryRecordText(record)}`);
      }
    }
  }

  return `${chunks.join("\n").trimEnd()}\n`;
}

function renderMemoryRecordText(record: MemoryRecord): string {
  const metadata = memoryRecordMetadataSchema.parse({
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
  return `${record.text} <!-- ${MEMORY_COMMENT_PREFIX}${JSON.stringify(metadata)} -->`;
}

function renderMemoryFrontmatter(
  frontmatter: MemoryDocumentFrontmatter,
  body: string,
): string {
  return [
    "---",
    `docType: ${frontmatter.docType}`,
    `schemaVersion: ${frontmatter.schemaVersion}`,
    `title: ${renderMemoryFrontmatterValue(frontmatter.title)}`,
    `updatedAt: ${renderMemoryFrontmatterValue(frontmatter.updatedAt)}`,
    ...(frontmatter.lastDemographicsAction === undefined ? [] : [
      "lastDemographicsAction:",
      `  actionId: ${frontmatter.lastDemographicsAction.actionId}`,
      `  payloadHash: ${frontmatter.lastDemographicsAction.payloadHash}`,
      `  status: ${frontmatter.lastDemographicsAction.status}`,
    ]),
    "---",
    body,
  ].join("\n");
}

function renderMemoryFrontmatterValue(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/u.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function parseMemoryRecordMetadata(
  value: string | undefined,
  sourcePath: string,
  lineNumber: number,
): MemoryRecordMetadata {
  if (value === undefined) {
    throw new MemoryDocumentParseError({
      issue: "record_metadata_missing",
      sourcePath,
      lineNumber,
      field: "metadata",
    });
  }

  try {
    return memoryRecordMetadataSchema.parse(JSON.parse(value));
  } catch {
    throw new MemoryDocumentParseError({
      issue: "record_metadata_invalid",
      sourcePath,
      lineNumber,
      field: "metadata",
    });
  }
}

function normalizeMemorySection(
  value: string,
  sourcePath: string,
  lineNumber: number,
): MemorySection {
  const normalized = value.trim();
  if (memorySectionValues.includes(normalized as MemorySection)) {
    return normalized as MemorySection;
  }

  throw new MemoryDocumentParseError({
    issue: "memory_section_invalid",
    sourcePath,
    lineNumber,
    field: "section",
  });
}

function resolveMemoryBodyStartLine(text: string): number {
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  if (lines[0] !== "---") {
    return 1;
  }
  const closingIndex = lines.indexOf("---", 1);
  return closingIndex < 0 ? 1 : closingIndex + 2;
}

function normalizeMemorySourcePath(value: string): string {
  if (
    value.length === 0
    || value.length > 160
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value)
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    return memoryDocumentRelativePath;
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return memoryDocumentRelativePath;
  }

  return value;
}

function normalizeMemoryRecordId(
  records: readonly MemoryRecord[],
  value: string | null,
): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) {
    return null;
  }

  if (records.some((record) => record.id === normalized)) {
    return canonicalMemoryRecordIdSchema.parse(normalized);
  }

  return canonicalMemoryRecordIdSchema.parse(normalized);
}

function normalizeMemoryText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    throw new Error("Memory text must be a non-empty string.");
  }

  if (normalized.includes(MEMORY_COMMENT_PREFIX)) {
    throw new Error("Memory text cannot contain the reserved memory metadata marker.");
  }

  return normalized;
}

function findMemoryInsertionIndex(
  records: readonly MemoryRecord[],
  section: MemorySection,
): number {
  const targetOrder = memorySectionOrder.get(section) ?? 0;
  let insertionIndex = records.length;

  for (let index = 0; index < records.length; index += 1) {
    const recordOrder = memorySectionOrder.get(records[index]?.section ?? section) ?? 0;
    if (recordOrder <= targetOrder) {
      insertionIndex = index + 1;
    }
  }

  return insertionIndex;
}

function collectCanonicalMemoryDisplayNameCandidates(
  records: readonly MemoryRecord[],
): MemoryDisplayNameCandidate[] {
  return records.flatMap((record) => {
    if (record.section !== "Identity") {
      return [];
    }

    const displayName = parseCanonicalMemoryDisplayNameRecordText(record.text);
    if (displayName === null) {
      return [];
    }

    return [{
      displayName,
      record,
      source: "canonical" as const,
    }];
  });
}

function collectLegacyMemoryDisplayNameCandidates(
  records: readonly MemoryRecord[],
): MemoryDisplayNameCandidate[] {
  return records.flatMap((record) => {
    if (record.section !== "Identity") {
      return [];
    }

    const displayName = parseLegacyMemoryDisplayNameRecordText(record.text);
    if (displayName === null) {
      return [];
    }

    return [{
      displayName,
      record,
      source: "legacy" as const,
    }];
  });
}

const legacyDisplayNameContextWords = new Set([
  "about",
  "around",
  "at",
  "for",
  "from",
  "home",
  "in",
  "near",
  "of",
  "on",
  "work",
]);

function parseLegacyMemoryDisplayNameRecordText(text: string): string | null {
  let normalizedText: string;
  try {
    normalizedText = normalizeMemoryText(text);
  } catch {
    return null;
  }

  const patterns = [
    {
      maxTokens: 5,
      pattern: /^preferred\s+(?:display\s+)?name:\s*(?<name>.+)$/iu,
    },
    {
      maxTokens: 5,
      pattern: /^(?:the\s+)?user(?:'s|’s)?\s+(?:preferred\s+)?display\s+name\s+is\s+(?<name>.+)$/iu,
    },
    {
      maxTokens: 5,
      pattern: /^(?:the\s+)?user(?:'s|’s)?\s+preferred\s+name\s+is\s+(?<name>.+)$/iu,
    },
    {
      maxTokens: 2,
      pattern: /^(?:the\s+)?user\s+goes\s+by\s+(?<name>.+)$/iu,
    },
    {
      maxTokens: 2,
      pattern: /^(?:the\s+)?user(?:'s|’s)?\s+name\s+is\s+(?<name>.+)$/iu,
    },
  ] as const;

  for (const { maxTokens, pattern } of patterns) {
    const match = pattern.exec(normalizedText);
    const candidate = normalizeLegacyMemoryDisplayNameCandidate(match?.groups?.name ?? null, {
      maxTokens,
    });
    if (candidate !== null) {
      return candidate;
    }
  }

  return null;
}

function normalizeLegacyMemoryDisplayNameCandidate(
  value: string | null,
  options: { maxTokens: number },
): string | null {
  if (value === null) {
    return null;
  }

  let normalized = value.trim();
  normalized = normalized.replace(/^["'“”]+/u, "").replace(/["'“”]+$/u, "").trim();
  normalized = normalized.replace(/[.!?]$/u, "").trim();
  if (
    normalized.length === 0
    || /[,;:@()[\]{}]/u.test(normalized)
    || /\d/u.test(normalized)
    || /\s+(?:and|but|because|while|with|who|which|that)\s+/iu.test(normalized)
  ) {
    return null;
  }

  const tokens = normalized.split(/\s+/u);
  if (
    tokens.length > options.maxTokens
    || tokens.some((token) => legacyDisplayNameContextWords.has(token.toLowerCase()))
    || tokens.some((token) => !/^[\p{L}][\p{L}\p{M}'’.-]*$/u.test(token))
  ) {
    return null;
  }

  const parsed = memoryDisplayNameSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function selectUniqueMemoryDisplayNameCandidate(
  candidates: readonly MemoryDisplayNameCandidate[],
): MemoryDisplayNameResolution | null {
  if (candidates.length === 0) {
    return null;
  }

  const uniqueDisplayNames = new Set(candidates.map((candidate) => candidate.displayName));
  if (uniqueDisplayNames.size !== 1) {
    return null;
  }

  return selectMostRecentMemoryDisplayNameCandidate(candidates);
}

function selectMostRecentMemoryDisplayNameCandidate(
  candidates: readonly MemoryDisplayNameCandidate[],
): MemoryDisplayNameCandidate | null {
  let selected: MemoryDisplayNameCandidate | null = null;
  for (const candidate of candidates) {
    if (
      selected === null
      || compareMemoryDisplayNameCandidateRecency(candidate, selected) > 0
    ) {
      selected = candidate;
    }
  }

  return selected;
}

function compareMemoryDisplayNameCandidateRecency(
  left: MemoryDisplayNameCandidate,
  right: MemoryDisplayNameCandidate,
): number {
  const leftUpdatedAt = Date.parse(left.record.updatedAt);
  const rightUpdatedAt = Date.parse(right.record.updatedAt);
  const leftHasTimestamp = Number.isFinite(leftUpdatedAt);
  const rightHasTimestamp = Number.isFinite(rightUpdatedAt);

  if (leftHasTimestamp && rightHasTimestamp && leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt - rightUpdatedAt;
  }

  if (leftHasTimestamp !== rightHasTimestamp) {
    return leftHasTimestamp ? 1 : -1;
  }

  return left.record.sourceLine - right.record.sourceLine;
}
