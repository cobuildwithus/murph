import type { JournalDayFrontmatter } from "@murphai/contracts";
import { journalDayFrontmatterSchema } from "@murphai/contracts";

import { FRONTMATTER_SCHEMA_VERSIONS, VAULT_LAYOUT } from "../constants.ts";
import { VaultError } from "../errors.ts";
import { stringifyFrontmatterDocument } from "../frontmatter.ts";
import {
  resolveDatedMarkdownDocumentTarget,
  stageMarkdownDocumentWrite,
  writeCanonicalMarkdownDocument,
} from "../markdown-documents.ts";
import { defaultTimeZone, toLocalDayKey } from "../time.ts";
import { loadVault } from "../vault.ts";
import { commitAuditedCanonicalWrite } from "../audited-write.ts";

import {
  appendMarkdownParagraph,
  readValidatedFrontmatterDocument,
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
  const target = resolveDatedMarkdownDocumentTarget({
    directory: VAULT_LAYOUT.journalDirectory,
    dayKey: day,
    created: true,
  });
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
    const result = await writeCanonicalMarkdownDocument({
      vaultRoot,
      operationType: "journal_ensure",
      summary: `Ensure journal page for ${day}`,
      occurredAt: `${day}T00:00:00.000Z`,
      target,
      markdown: stringifyFrontmatterDocument({
        attributes: { ...attributes },
        body: `# ${day}\n\n## Summary\n\n`,
      }),
      overwrite: false,
      audit: {
        action: "journal_ensure",
        commandName: "core.ensureJournalDay",
        summary: `Ensured journal page for ${day}.`,
        occurredAt: `${day}T00:00:00.000Z`,
      },
    });

    return {
      created: true,
      relativePath: target.relativePath,
      auditPath: result.auditPath,
    };
  } catch (error) {
    if (error instanceof VaultError && error.code === "VAULT_FILE_EXISTS") {
      return {
        created: false,
        relativePath: target.relativePath,
      };
    }

    throw error;
  }
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

  const result = await commitAuditedCanonicalWrite<AppendJournalResult>({
    vaultRoot: input.vaultRoot,
    operationType: "journal_append_text",
    summary: `Append journal text for ${input.date}`,
    occurredAt: `${input.date}T00:00:00.000Z`,
    audit: {
      action: "journal_append",
      commandName: "core.appendJournal",
      summary: `Appended journal text for ${input.date}.`,
    },
    mutate: async ({ batch }) => {
      const write = await stageMarkdownDocumentWrite(
        batch,
        resolveDatedMarkdownDocumentTarget({
          directory: VAULT_LAYOUT.journalDirectory,
          dayKey: input.date,
          created: ensured.created,
        }),
        nextMarkdown,
        {
          overwrite: true,
        },
      );

      return {
        result: {
          relativePath: ensured.relativePath,
          created: ensured.created,
          updated: true,
        },
        changes: write.changes,
      };
    },
  });

  return result.result;
}

async function mutateJournalLinks(
  input: MutateJournalLinksInput,
): Promise<MutateJournalLinksResult> {
  const values = normalizeJournalLinkValues(input);
  const ensured =
    input.operation === "link"
      ? await ensureJournalDay({
          vaultRoot: input.vaultRoot,
          date: input.date,
        })
      : null;
  const relativePath =
    ensured?.relativePath ??
    resolveDatedMarkdownDocumentTarget({
      directory: VAULT_LAYOUT.journalDirectory,
      dayKey: input.date,
      created: false,
    }).relativePath;

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

  for (const value of values) {
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

  const result = await commitAuditedCanonicalWrite<MutateJournalLinksResult>({
    vaultRoot: input.vaultRoot,
    operationType: input.operation === "link" ? "journal_link" : "journal_unlink",
    summary: `${input.operation === "link" ? "Link" : "Unlink"} journal ${input.key} for ${input.date}`,
    occurredAt: `${input.date}T00:00:00.000Z`,
    audit: {
      action: input.operation === "link" ? "journal_link" : "journal_unlink",
      commandName:
        input.key === "eventIds"
          ? input.operation === "link"
            ? "core.linkJournalEventIds"
            : "core.unlinkJournalEventIds"
          : input.operation === "link"
            ? "core.linkJournalStreams"
            : "core.unlinkJournalStreams",
      summary:
        input.operation === "link"
          ? `Linked journal ${input.key} for ${input.date}.`
          : `Unlinked journal ${input.key} for ${input.date}.`,
    },
    mutate: async ({ batch }) => {
      const write = await stageMarkdownDocumentWrite(
        batch,
        resolveDatedMarkdownDocumentTarget({
          directory: VAULT_LAYOUT.journalDirectory,
          dayKey: input.date,
          created: ensured?.created ?? false,
        }),
        nextMarkdown,
        {
          overwrite: true,
        },
      );

      return {
        result: {
          relativePath,
          created: ensured?.created ?? false,
          changed,
          eventIds: nextAttributes.eventIds,
          sampleStreams: nextAttributes.sampleStreams,
        },
        changes: write.changes,
      };
    },
  });

  return result.result;
}

function normalizeJournalLinkValues(input: MutateJournalLinksInput): string[] {
  const values = uniqueTrimmedStringList(input.values);
  if (!values) {
    throw new VaultError(
      "VAULT_INVALID_INPUT",
      `Journal ${input.key} requires at least one value.`,
    );
  }

  const attributes = validateContract(
    journalDayFrontmatterSchema,
    {
      schemaVersion: FRONTMATTER_SCHEMA_VERSIONS.journalDay,
      docType: "journal_day",
      dayKey: "2000-01-01",
      eventIds: input.key === "eventIds" ? values : [],
      sampleStreams: input.key === "sampleStreams" ? values : [],
    },
    "JOURNAL_LINK_INVALID",
    `Journal ${input.key} for "${input.date}" contains invalid values.`,
    {
      key: input.key,
      operation: input.operation,
    },
  );

  return attributes[input.key];
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
