import { createHash } from "node:crypto";

import { z } from "zod";

import { parseFrontmatterDocument } from "./frontmatter.ts";

export const memoryDocumentRelativePath = "bank/memory.md";
export const memoryDocumentDocType = "murph.memory.v1";
export const memoryDocumentSchemaVersion = 1;

export const memorySectionValues = [
  "Identity",
  "Preferences",
  "Instructions",
  "Context",
] as const;

export const memorySectionSchema = z.enum(memorySectionValues);

export const memoryRecordMetadataSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.string().min(1).nullable().default(null),
    updatedAt: z.string().min(1).nullable().default(null),
  })
  .strict();

export const memoryDocumentFrontmatterSchema = z
  .object({
    docType: z.literal(memoryDocumentDocType),
    schemaVersion: z.literal(memoryDocumentSchemaVersion),
    title: z.string().min(1).default("Memory"),
    updatedAt: z.string().min(1),
  })
  .strict();

export const memoryRecordSchema = z
  .object({
    id: z.string().min(1),
    section: memorySectionSchema,
    text: z.string().min(1),
    createdAt: z.string().min(1).nullable(),
    updatedAt: z.string().min(1).nullable(),
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

export interface ForgetMemoryRecordInput {
  recordId: string;
}

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
  const normalized = [input.section, normalizeMemoryText(input.text)].join("\u0000");
  return `mem_${createHash("sha1").update(normalized).digest("hex").slice(0, 16)}`;
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
  const nextRecordId = normalizeMemoryRecordId(next.recordId ?? null) ?? createMemoryRecordId(next);
  const existingIndex = input.records.findIndex((record) => record.id === nextRecordId);
  const existingRecord = existingIndex >= 0 ? input.records[existingIndex] ?? null : null;
  const record: MemoryRecord = memoryRecordSchema.parse({
    id: nextRecordId,
    section: next.section,
    text: normalizeMemoryText(next.text),
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
  const metadata = match.groups.metadata ? parseMemoryRecordMetadata(match.groups.metadata) : null;
  const id = metadata?.id ?? createMemoryRecordId({
    section: input.section,
    text,
  });

  return memoryRecordSchema.parse({
    id,
    section: input.section,
    text,
    createdAt: metadata?.createdAt ?? null,
    updatedAt: metadata?.updatedAt ?? null,
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

function parseMemoryRecordMetadata(value: string): MemoryRecordMetadata | null {
  try {
    return memoryRecordMetadataSchema.parse(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function normalizeMemorySection(value: string): MemorySection {
  const normalized = value.trim();
  if (memorySectionValues.includes(normalized as MemorySection)) {
    return normalized as MemorySection;
  }

  throw new Error(`Unknown memory section "${value}".`);
}

function normalizeMemoryRecordId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeMemoryText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    throw new Error("Memory text must be a non-empty string.");
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
