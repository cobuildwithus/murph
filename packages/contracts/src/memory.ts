import * as z from "./zod-runtime.ts";

import {
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  ID_PREFIXES,
} from "./constants.ts";
import { parseFrontmatterDocument } from "./frontmatter.ts";
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
  const parsed = parseFrontmatterDocument(input.text);
  const frontmatter = memoryDocumentFrontmatterSchema.parse(parsed.attributes);
  const records = parseMemoryDocumentBody(parsed.body, input.sourcePath ?? "bank/memory.md");

  return {
    frontmatter,
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

export function upsertMemoryRecord(
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
  const record: MemoryRecord = memoryRecordSchema.parse({
    id: nextRecordId,
    section: next.section,
    text: normalizedText,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
    sourceLine: existingRecord?.sourceLine ?? input.records.length + 1,
    sourcePath: existingRecord?.sourcePath ?? memoryDocumentRelativePath,
  });

  const records = input.records.filter((entry) => entry.id !== nextRecordId);
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
  const records = input.records.filter((entry) => entry.id !== next.recordId);

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

function parseMemoryDocumentBody(body: string, sourcePath: string): MemoryRecord[] {
  const lines = body.replace(/\r\n/gu, "\n").split("\n");
  const records: MemoryRecord[] = [];
  let activeSection: MemorySection | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const headingMatch = /^##\s+(.+)$/u.exec(line);
    if (headingMatch?.[1]) {
      activeSection = normalizeMemorySection(headingMatch[1]);
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
      sourcePath,
    });
    if (parsed) {
      records.push(parsed);
    }
  }

  return records;
}

function parseMemoryRecordLine(input: {
  line: string;
  section: MemorySection;
  sourceLine: number;
  sourcePath: string;
}): MemoryRecord | null {
  const match = /^(?<text>.*?)(?:\s+<!--\s*murph-memory:(?<metadata>\{.*\})\s*-->)?$/u.exec(
    input.line,
  );
  if (!match?.groups?.text) {
    return null;
  }

  const text = normalizeMemoryText(match.groups.text);
  const metadata = parseMemoryRecordMetadata(match.groups.metadata);

  return memoryRecordSchema.parse({
    id: metadata.id,
    section: input.section,
    text,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    sourceLine: input.sourceLine,
    sourcePath: input.sourcePath,
  });
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

function parseMemoryRecordMetadata(value: string | undefined): MemoryRecordMetadata {
  if (value === undefined) {
    throw new Error("Memory record metadata comment is required.");
  }

  try {
    return memoryRecordMetadataSchema.parse(JSON.parse(value));
  } catch (error) {
    throw new Error("Memory record metadata comment is invalid.", { cause: error });
  }
}

function normalizeMemorySection(value: string): MemorySection {
  const normalized = value.trim();
  if (memorySectionValues.includes(normalized as MemorySection)) {
    return normalized as MemorySection;
  }

  throw new Error(`Unknown memory section "${value}".`);
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
