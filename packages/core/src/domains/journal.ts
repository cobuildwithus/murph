import type { JournalDayFrontmatter } from "@murph/contracts";
import { journalDayFrontmatterSchema } from "@murph/contracts";

import { FRONTMATTER_SCHEMA_VERSIONS, VAULT_LAYOUT } from "../constants.ts";
import { emitAuditRecord } from "../audit.ts";
import { VaultError } from "../errors.ts";
import { stringifyFrontmatterDocument } from "../frontmatter.ts";
import { writeVaultTextFile } from "../fs.ts";
import { loadVault } from "../vault.ts";
import { defaultTimeZone, toLocalDayKey } from "../time.ts";

import {
  appendMarkdownParagraph,
  readValidatedFrontmatterDocument,
  runLoadedCanonicalWrite,
  sortStrings,
  uniqueTrimmedStringList,
  validateContract,
} from "./shared.ts";

import type { DateInput } from "../types.ts";

type JournalMutationKey = "eventIds" | "sampleStreams";
type JournalMutationOperation = "link" | "unlink";

export interface EnsureJournalDayInput {
  vaultRoot: string;
  date?: DateInput;
}

export interface EnsureJournalDayResult {
  created: boolean;
  relativePath: string;
  auditPath?: string;
}

interface AppendJournalInput {
  vaultRoot: string;
  date: string;
  text: string;
}

interface AppendJournalResult {
  relativePath: string;
  created: boolean;
  updated: true;
}

interface MutateJournalLinksInput {
  vaultRoot: string;
  date: string;
  key: JournalMutationKey;
  values: string[];
  operation: JournalMutationOperation;
}

interface MutateJournalLinksResult {
  relativePath: string;
  created: boolean;
  changed: number;
  eventIds: string[];
  sampleStreams: string[];
}

function validateJournalFrontmatter(
  value: unknown,
  relativePath = "journal",
): JournalDayFrontmatter {
  return validateContract(
    journalDayFrontmatterSchema,
    value,
    "JOURNAL_FRONTMATTER_INVALID",
    `Journal frontmatter for "${relativePath}" is invalid.`,
    {
      relativePath,
    },
  );
}

export async function readJournalDayFrontmatterDocument(
  vaultRoot: string,
  relativePath: string,
): Promise<{
  rawDocument: string;
  document: {
    attributes: JournalDayFrontmatter;
    body: string;
  };
}> {
  return readValidatedFrontmatterDocument(
    vaultRoot,
    relativePath,
    journalDayFrontmatterSchema,
    "JOURNAL_FRONTMATTER_INVALID",
    `Journal frontmatter for "${relativePath}" is invalid.`,
  );
}

export async function ensureJournalDay({
  vaultRoot,
  date,
}: EnsureJournalDayInput): Promise<EnsureJournalDayResult> {
  const vault = await loadVault({ vaultRoot });
  const day = toLocalDayKey(date, vault.metadata.timezone ?? defaultTimeZone(), "date");
  const [year] = day.split("-");
  const relativePath = `${VAULT_LAYOUT.journalDirectory}/${year}/${day}.md`;
  const attributes = validateContract(
    journalDayFrontmatterSchema,
    {
      schemaVersion: FRONTMATTER_SCHEMA_VERSIONS.journalDay,
      docType: "journal_day",
      dayKey: day,
      eventIds: [],
      sampleStreams: [],
    },
    "FRONTMATTER_INVALID",
    "Journal frontmatter failed contract validation before write.",
  );

  try {
    await writeVaultTextFile(
      vaultRoot,
      relativePath,
      stringifyFrontmatterDocument({
        attributes: { ...attributes },
        body: `# ${day}\n\n## Summary\n\n`,
      }),
      { overwrite: false },
    );
  } catch (error) {
    if (error instanceof VaultError && error.code === "VAULT_FILE_EXISTS") {
      return {
        created: false,
        relativePath,
      };
    }

    throw error;
  }

  const audit = await emitAuditRecord({
    vaultRoot,
    action: "journal_ensure",
    commandName: "core.ensureJournalDay",
    summary: `Ensured journal page for ${day}.`,
    occurredAt: `${day}T00:00:00.000Z`,
    files: [relativePath],
  });

  return {
    created: true,
    relativePath,
    auditPath: audit.relativePath,
  };
}

export async function appendJournal(input: AppendJournalInput): Promise<AppendJournalResult> {
  const ensured = await ensureJournalDay({
    vaultRoot: input.vaultRoot,
    date: input.date,
  });
  const { document } = await readJournalDayFrontmatterDocument(
    input.vaultRoot,
    ensured.relativePath,
  );
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: document.attributes,
    body: appendMarkdownParagraph(document.body, input.text),
  });

  return runLoadedCanonicalWrite<AppendJournalResult>({
    vaultRoot: input.vaultRoot,
    operationType: "journal_append_text",
    summary: `Append journal text for ${input.date}`,
    occurredAt: `${input.date}T00:00:00.000Z`,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(ensured.relativePath, nextMarkdown, {
        overwrite: true,
      });

      return {
        relativePath: ensured.relativePath,
        created: ensured.created,
        updated: true,
      };
    },
  });
}

async function mutateJournalLinks(
  input: MutateJournalLinksInput,
): Promise<MutateJournalLinksResult> {
  const ensured =
    input.operation === "link"
      ? await ensureJournalDay({
          vaultRoot: input.vaultRoot,
          date: input.date,
        })
      : null;
  const relativePath =
    ensured?.relativePath ?? `${VAULT_LAYOUT.journalDirectory}/${input.date.slice(0, 4)}/${input.date}.md`;

  let document: {
    attributes: JournalDayFrontmatter;
    body: string;
  };
  try {
    ({ document } = await readJournalDayFrontmatterDocument(input.vaultRoot, relativePath));
  } catch (error) {
    if (error instanceof VaultError && error.code === "VAULT_FILE_MISSING") {
      throw new VaultError("JOURNAL_DAY_MISSING", `No journal day found for "${input.date}".`);
    }

    throw error;
  }

  const currentValues = new Set<string>(document.attributes[input.key]);
  let changed = 0;

  for (const value of uniqueTrimmedStringList(input.values) ?? []) {
    if (input.operation === "link") {
      if (!currentValues.has(value)) {
        currentValues.add(value);
        changed += 1;
      }
      continue;
    }

    if (currentValues.delete(value)) {
      changed += 1;
    }
  }

  const nextAttributes = validateJournalFrontmatter(
    {
      ...document.attributes,
      [input.key]: sortStrings([...currentValues]),
    },
    relativePath,
  );
  const nextMarkdown = stringifyFrontmatterDocument({
    attributes: nextAttributes,
    body: document.body,
  });

  return runLoadedCanonicalWrite<MutateJournalLinksResult>({
    vaultRoot: input.vaultRoot,
    operationType: input.operation === "link" ? "journal_link" : "journal_unlink",
    summary: `${input.operation === "link" ? "Link" : "Unlink"} journal ${input.key} for ${input.date}`,
    occurredAt: `${input.date}T00:00:00.000Z`,
    mutate: async ({ batch }) => {
      await batch.stageTextWrite(relativePath, nextMarkdown, {
        overwrite: true,
      });

      return {
        relativePath,
        created: ensured?.created ?? false,
        changed,
        eventIds: nextAttributes.eventIds,
        sampleStreams: nextAttributes.sampleStreams,
      };
    },
  });
}

export async function linkJournalEventIds(
  input: Omit<MutateJournalLinksInput, "key" | "operation">,
): Promise<MutateJournalLinksResult> {
  return mutateJournalLinks({
    ...input,
    key: "eventIds",
    operation: "link",
  });
}

export async function unlinkJournalEventIds(
  input: Omit<MutateJournalLinksInput, "key" | "operation">,
): Promise<MutateJournalLinksResult> {
  return mutateJournalLinks({
    ...input,
    key: "eventIds",
    operation: "unlink",
  });
}

export async function linkJournalStreams(
  input: Omit<MutateJournalLinksInput, "key" | "operation">,
): Promise<MutateJournalLinksResult> {
  return mutateJournalLinks({
    ...input,
    key: "sampleStreams",
    operation: "link",
  });
}

export async function unlinkJournalStreams(
  input: Omit<MutateJournalLinksInput, "key" | "operation">,
): Promise<MutateJournalLinksResult> {
  return mutateJournalLinks({
    ...input,
    key: "sampleStreams",
    operation: "unlink",
  });
}
