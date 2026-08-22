import type { HabitatFrontmatter, HabitatIndicatorValue } from "@murphai/contracts";
import {
  CONTRACT_SCHEMA_VERSION,
  expectedHabitatAspectRelativePath,
  getHabitatIndicatorDefinition,
  habitatFrontmatterSchema,
  normalizeHabitatCityOrRegion,
  requireHabitatAspectDefinition,
  validateHabitatIndicatorValue,
} from "@murphai/contracts";

import { ID_PREFIXES, VAULT_LAYOUT } from "../constants.ts";
import { parseFrontmatterDocument } from "../frontmatter.ts";
import { generateRecordId } from "../ids.ts";
import {
  compactObject,
  ensureMarkdownHeading,
  normalizeOptionalText,
  validateContract,
} from "../domains/shared.ts";
import {
  loadMarkdownRegistryDocuments,
  readRegistryRecord,
  resolveMarkdownRegistryUpsertTarget,
  writeMarkdownRegistryRecord,
} from "../registry/markdown.ts";
import { VaultError } from "../errors.ts";
import {
  acquireCanonicalWriteLock,
  withCanonicalWriteLockScope,
} from "../operations/canonical-write-lock.ts";
import { loadVault } from "../vault.ts";

import type { FrontmatterObject } from "../types.ts";

export interface HabitatRecord extends HabitatFrontmatter {
  relativePath: string;
  markdown: string;
  body: string;
}

export interface ReadHabitatAspectInput {
  vaultRoot: string;
  habitatId?: string;
  slug?: string;
}

export interface UpsertHabitatAspectInput {
  vaultRoot: string;
  /** Catalog aspect id, e.g. "sleep-environment"; also the record slug. */
  aspect: string;
  /**
   * Indicator values to merge into the aspect. Explicit null clears an
   * indicator back to unknown; omitted indicators keep their stored value.
   */
  indicators?: Record<string, HabitatIndicatorValue>;
  /** Concise member-facing context to merge by indicator. Null clears a note. */
  indicatorNotes?: Record<string, string | null>;
  /** ISO date stamped on every indicator set in this call. */
  recordedAt?: string;
  note?: string;
  body?: string;
}

export interface UpsertHabitatAspectResult {
  habitatId: string;
  aspect: string;
  relativePath: string;
  created: boolean;
  indicators: Record<string, HabitatIndicatorValue>;
}

function validateHabitatFrontmatter(
  value: unknown,
  relativePath: string,
): HabitatFrontmatter {
  return validateContract(
    habitatFrontmatterSchema,
    value,
    "HABITAT_FRONTMATTER_INVALID",
    "Habitat frontmatter is invalid.",
    { relativePath },
  );
}

function assertHabitatPathOwnership(
  frontmatter: HabitatFrontmatter,
  relativePath: string,
): void {
  const expectedRelativePath = expectedHabitatAspectRelativePath(frontmatter.aspect);

  if (relativePath !== expectedRelativePath) {
    throw new VaultError(
      "HABITAT_FRONTMATTER_INVALID",
      `Habitat aspect "${frontmatter.aspect}" must be stored at ${expectedRelativePath}.`,
      {
        aspect: frontmatter.aspect,
        expectedRelativePath,
        relativePath,
      },
    );
  }
}

function parseHabitatRecord(
  attributes: FrontmatterObject,
  relativePath: string,
  markdown: string,
): HabitatRecord {
  const frontmatter = validateHabitatFrontmatter(attributes, relativePath);
  assertHabitatPathOwnership(frontmatter, relativePath);
  const document = parseFrontmatterDocument(markdown);
  return {
    ...frontmatter,
    relativePath,
    markdown,
    body: document.body,
  };
}

async function loadHabitatRecords(vaultRoot: string): Promise<HabitatRecord[]> {
  const records = await loadMarkdownRegistryDocuments({
    vaultRoot,
    directory: VAULT_LAYOUT.habitatDirectory,
    recordFromParts: parseHabitatRecord,
    isExpectedRecord: (record) =>
      record.docType === "habitat" &&
      record.schemaVersion === CONTRACT_SCHEMA_VERSION.habitatFrontmatter,
    invalidCode: "HABITAT_FRONTMATTER_INVALID",
    invalidMessage: "Habitat frontmatter is invalid.",
  });

  return records.sort((left, right) => left.aspect.localeCompare(right.aspect));
}

function mergeIndicators(
  existing: HabitatFrontmatter["indicators"] | undefined,
  updates: Record<string, HabitatIndicatorValue> | undefined,
  existingDates: Record<string, string> | undefined,
  recordedAt: string | undefined,
): {
  indicators: Record<string, HabitatIndicatorValue>;
  indicatorRecordedAt: Record<string, string> | undefined;
} {
  const indicators: Record<string, HabitatIndicatorValue> = { ...existing };
  const dates: Record<string, string> = { ...existingDates };

  for (const [indicatorId, value] of Object.entries(updates ?? {})) {
    if (value === null) {
      delete indicators[indicatorId];
      delete dates[indicatorId];
      continue;
    }

    indicators[indicatorId] = value;
    if (recordedAt) {
      dates[indicatorId] = recordedAt;
    }
  }

  return {
    indicators,
    indicatorRecordedAt: Object.keys(dates).length > 0 ? dates : undefined,
  };
}

function mergeIndicatorNotes(
  existing: HabitatFrontmatter["indicatorNotes"] | undefined,
  updates: Record<string, string | null> | undefined,
  indicators: Readonly<Record<string, HabitatIndicatorValue>>,
): Record<string, string> | undefined {
  const notes: Record<string, string> = { ...existing };

  for (const [indicatorId, note] of Object.entries(updates ?? {})) {
    const normalized = normalizeOptionalText(note);
    if (!normalized || !(indicatorId in indicators)) {
      delete notes[indicatorId];
      continue;
    }
    notes[indicatorId] = normalized;
  }

  for (const indicatorId of Object.keys(notes)) {
    if (!(indicatorId in indicators)) {
      delete notes[indicatorId];
    }
  }

  return Object.keys(notes).length > 0 ? notes : undefined;
}

function hasStoredIndicatorUpdates(
  updates: Record<string, HabitatIndicatorValue> | undefined,
): boolean {
  return Object.values(updates ?? {}).some((value) => value !== null);
}

function assertRecordedAtForStoredIndicatorUpdates(
  updates: Record<string, HabitatIndicatorValue> | undefined,
  recordedAt: string | undefined,
): void {
  if (!hasStoredIndicatorUpdates(updates)) {
    return;
  }

  if (!recordedAt) {
    throw new VaultError(
      "HABITAT_RECORDED_AT_REQUIRED",
      "Habitat indicator writes require recordedAt so coverage can detect stale values.",
    );
  }
}

function assertValidStoredIndicatorUpdates(
  aspect: string,
  updates: Record<string, HabitatIndicatorValue> | undefined,
): void {
  for (const [indicatorId, value] of Object.entries(updates ?? {})) {
    if (value === null) {
      continue;
    }

    const definition = getHabitatIndicatorDefinition(aspect, indicatorId);
    if (!definition) {
      throw new VaultError(
        "HABITAT_FRONTMATTER_INVALID",
        `Indicator "${indicatorId}" is not part of habitat aspect "${aspect}".`,
      );
    }

    const issue = validateHabitatIndicatorValue(definition, value);
    if (issue) {
      throw new VaultError(
        "HABITAT_FRONTMATTER_INVALID",
        issue,
        { aspect, indicatorId },
      );
    }
    if (
      aspect === "home-location"
      && indicatorId === "location"
      && value !== null
      && value !== "declined"
      && normalizeHabitatCityOrRegion(value) === null
    ) {
      throw new VaultError(
        "HABITAT_FRONTMATTER_INVALID",
        "Location must be a city or approximate region, not a precise address.",
        { aspect, indicatorId },
      );
    }
  }
}

function assertValidIndicatorNoteUpdates(
  aspect: string,
  updates: Record<string, string | null> | undefined,
): void {
  for (const indicatorId of Object.keys(updates ?? {})) {
    if (!getHabitatIndicatorDefinition(aspect, indicatorId)) {
      throw new VaultError(
        "HABITAT_FRONTMATTER_INVALID",
        `Indicator note "${indicatorId}" is not part of habitat aspect "${aspect}".`,
        { aspect, indicatorId },
      );
    }
  }
}

export async function upsertHabitatAspect(
  input: UpsertHabitatAspectInput,
): Promise<UpsertHabitatAspectResult> {
  await loadVault({ vaultRoot: input.vaultRoot });
  return await withCanonicalWriteLockScope(input.vaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(input.vaultRoot);

    try {
      return await upsertHabitatAspectLocked(input);
    } finally {
      await lock.release();
    }
  });
}

async function upsertHabitatAspectLocked(
  input: UpsertHabitatAspectInput,
): Promise<UpsertHabitatAspectResult> {
  const aspectDefinition = requireHabitatAspectDefinition(input.aspect);
  const recordedAt = normalizeOptionalText(input.recordedAt) ?? undefined;
  const existingRecords = await loadHabitatRecords(input.vaultRoot);
  assertValidStoredIndicatorUpdates(aspectDefinition.id, input.indicators);
  assertValidIndicatorNoteUpdates(aspectDefinition.id, input.indicatorNotes);
  assertRecordedAtForStoredIndicatorUpdates(input.indicators, recordedAt);
  const existingRecord =
    existingRecords.find((record) => record.aspect === aspectDefinition.id) ?? null;
  const target = resolveMarkdownRegistryUpsertTarget({
    existingRecord,
    recordId: existingRecord?.habitatId,
    requestedSlug: aspectDefinition.id,
    defaultSlug: aspectDefinition.id,
    allowSlugUpdate: false,
    directory: VAULT_LAYOUT.habitatDirectory,
    getRecordId: (record) => record.habitatId,
    getRecordSlug: (record) => record.slug,
    getRecordRelativePath: (record) => record.relativePath,
    createRecordId: () => generateRecordId(ID_PREFIXES.habitat),
  });
  const merged = mergeIndicators(
    existingRecord?.indicators,
    input.indicators,
    existingRecord?.indicatorRecordedAt,
    recordedAt,
  );
  const indicatorNotes = mergeIndicatorNotes(
    existingRecord?.indicatorNotes,
    input.indicatorNotes,
    merged.indicators,
  );
  const note = normalizeOptionalText(input.note) ?? existingRecord?.note ?? undefined;
  const nextAttributes = validateHabitatFrontmatter(
    compactObject({
      schemaVersion: CONTRACT_SCHEMA_VERSION.habitatFrontmatter,
      docType: "habitat",
      habitatId: target.recordId,
      slug: target.slug,
      title: aspectDefinition.title,
      status: "active",
      domain: aspectDefinition.domain,
      aspect: aspectDefinition.id,
      indicators: merged.indicators,
      indicatorNotes,
      indicatorRecordedAt: merged.indicatorRecordedAt,
      note,
    }),
    target.relativePath,
  );
  const body =
    typeof input.body === "string" && input.body.trim().length > 0
      ? ensureMarkdownHeading(input.body, aspectDefinition.title)
      : typeof existingRecord?.body === "string" && existingRecord.body.trim().length > 0
        ? ensureMarkdownHeading(existingRecord.body, aspectDefinition.title)
        : `# ${aspectDefinition.title}\n`;
  const { record } = await writeMarkdownRegistryRecord({
    vaultRoot: input.vaultRoot,
    target,
    attributes: nextAttributes as FrontmatterObject,
    body,
    recordFromParts: parseHabitatRecord,
    operationType: "habitat_upsert",
    summary: `Upsert habitat aspect ${aspectDefinition.id}`,
    audit: {
      action: "habitat_upsert",
      commandName: "core.upsertHabitatAspect",
      summary: `Upserted habitat aspect ${aspectDefinition.id}.`,
      targetIds: [target.recordId],
    },
  });

  return {
    habitatId: record.habitatId,
    aspect: record.aspect,
    relativePath: record.relativePath,
    created: target.created,
    indicators: record.indicators,
  };
}

export async function listHabitatAspects(vaultRoot: string): Promise<HabitatRecord[]> {
  return loadHabitatRecords(vaultRoot);
}

export async function readHabitatAspect({
  vaultRoot,
  habitatId,
  slug,
}: ReadHabitatAspectInput): Promise<HabitatRecord> {
  return readRegistryRecord({
    records: await loadHabitatRecords(vaultRoot),
    recordId: habitatId,
    slug,
    getRecordId: (record) => record.habitatId,
    getRecordSlug: (record) => record.slug,
    readMissingCode: "HABITAT_MISSING",
    readMissingMessage: "Habitat aspect was not found.",
  });
}
