import { Cli, z } from "incur";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import {
  MEMORY_DISPLAY_NAME_MAX_LENGTH,
  MemoryDocumentParseError,
  memoryDocumentSnapshotSchema,
  memoryRecordSchema,
  memorySectionSchema,
  memoryDemographicsSchema,
  type MemoryDocumentSnapshot,
  type MemoryRecord,
  type MemorySection,
} from "@murphai/contracts";
import {
  forgetMemory,
  getMemoryRecord,
  MemoryPersistenceError,
  MemoryRecordNotFoundError,
  readMemoryDocument,
  setMemoryDisplayName,
  setMemoryDemographics,
  updateMemory,
  upsertMemory,
} from "@murphai/core";

const vaultOptionSchema = z.object({
  vault: z.string().min(1).describe("Vault root."),
});

const memoryMutationOptionsSchema = vaultOptionSchema.extend({
  compact: z.boolean().optional().describe(
    "Accepted for compatibility; memory writes are already compact.",
  ),
});

const memoryWriteOptionsSchema = memoryMutationOptionsSchema.extend({
  full: z.boolean().optional().describe(
    "Also return the full memory document and the affected record's storage metadata.",
  ),
});

const memoryUpsertOptionsSchema = memoryWriteOptionsSchema.extend({
  section: memorySectionSchema.describe("Memory section to write into."),
});

const memoryUpdateOptionsSchema = memoryWriteOptionsSchema.extend({
  section: memorySectionSchema.optional().describe(
    "Optional replacement memory section. Defaults to the current section.",
  ),
});

const memoryIdArgSchema = z
  .string()
  .min(1)
  .describe("Canonical memory record id.");

const memoryTextArgSchema = z
  .string()
  .min(1)
  .describe("Memory text to store in the canonical memory document.");

const memoryDisplayNameArgSchema = z
  .string()
  .min(1)
  .max(MEMORY_DISPLAY_NAME_MAX_LENGTH)
  .describe("Preferred display name to store in canonical memory.");

const compactMemoryRecordSchema = memoryRecordSchema.pick({
  id: true,
  section: true,
  text: true,
});

const compactMemoryDocumentSchema = z.object({
  exists: z.boolean(),
  records: z.array(compactMemoryRecordSchema),
});

const fullMemoryShowResultSchema = z.object({
  vault: z.string().min(1),
  document: memoryDocumentSnapshotSchema,
  memory: memoryRecordSchema.nullable(),
});

const compactMemoryShowResultSchema = z.object({
  document: compactMemoryDocumentSchema,
  memory: compactMemoryRecordSchema.nullable(),
});

const memoryRecordOnlyResultSchema = z.object({
  memory: memoryRecordSchema,
});

const memoryShowResultSchema = z.union([
  fullMemoryShowResultSchema,
  compactMemoryShowResultSchema,
  memoryRecordOnlyResultSchema,
]);

const memoryShowOptionsSchema = vaultOptionSchema.extend({
  recordOnly: z.boolean().optional().describe(
    "Return only the exact requested record, including its verification metadata. Requires a memory id; omit for complete memory context.",
  ),
  compact: z.boolean().optional().describe(
    "Return only document existence plus each record's id, section, and text.",
  ),
});

const memoryUpsertResultSchema = z.union([
  z.object({
    created: z.boolean(),
    memory: compactMemoryRecordSchema,
  }),
  z.object({
    created: z.boolean(),
    document: memoryDocumentSnapshotSchema,
    memory: memoryRecordSchema,
  }),
]);

const memoryForgetResultSchema = z.union([
  z.object({
    existed: z.boolean(),
    memory: compactMemoryRecordSchema.nullable(),
  }),
  z.object({
    existed: z.boolean(),
    document: memoryDocumentSnapshotSchema,
    memory: memoryRecordSchema.nullable(),
  }),
]);

export function registerMemoryCommands(cli: Cli.Cli) {
  const memory = Cli.create("memory", {
    description: "Canonical first-class memory document commands.",
  });

  memory.command("show", {
    description: "Show the canonical memory document or one memory record.",
    args: z.object({
      memoryId: memoryIdArgSchema
        .optional()
        .describe("Optional canonical memory record id to show; omit to return the whole memory document."),
    }),
    options: memoryShowOptionsSchema,
    output: memoryShowResultSchema,
    async run({ args, options }) {
      return runMemoryCommand(async () => {
        if (options.recordOnly && !args.memoryId) {
          throw new VaultCliError("invalid_option", "--record-only requires a memory id.", {
            retryable: false,
            stage: "validation",
          });
        }
        const memory = args.memoryId ? await getMemoryRecord(options.vault, args.memoryId) : null;
        if (args.memoryId && !memory) {
          throw new MemoryRecordNotFoundError();
        }

        if (options.recordOnly && memory) {
          return { memory };
        }
        const document = await readMemoryDocument(options.vault);
        if (options.compact) {
          return {
            document: {
              exists: document.exists,
              records: document.records.map(({ id, section, text }) => ({
                id,
                section,
                text,
              })),
            },
            memory: memory
              ? {
                  id: memory.id,
                  section: memory.section,
                  text: memory.text,
                }
              : null,
          };
        }

        return {
          vault: options.vault,
          document,
          memory,
        };
      });
    },
  });

  memory.command("set-name", {
    description: "Set the user's preferred display name in canonical memory.",
    args: z.object({
      displayName: memoryDisplayNameArgSchema,
    }),
    options: memoryWriteOptionsSchema,
    output: memoryUpsertResultSchema,
    async run({ args, options }) {
      return runMemoryCommand(async () => {
        const result = await setMemoryDisplayName(options.vault, {
          displayName: args.displayName,
        });
        return {
          created: result.created,
          ...memoryWriteReceipt(options.full, result.document, result.record),
        };
      });
    },
  });

  memory.command("set-demographics", {
    description: "Save explicitly stated birth year, dated age, or biological sex in Identity memory. Never infer sex from gender.",
    args: z.object({}),
    options: memoryMutationOptionsSchema.extend({
      birthYear: z.number().int().min(1900).max(9999).optional().describe("Explicit birth year; omit to preserve."),
      age: z.number().int().min(13).max(120).optional().describe("Stated age; requires --as-of and excludes --birth-year."),
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional().describe("Source statement date, not the processing date."),
      biologicalSex: z.enum(["female", "male"]).optional().describe("Only explicitly stated biological sex."),
      clearBirth: z.boolean().optional().describe("Explicitly clear all birth facts, including saved DOB."),
      clearSex: z.boolean().optional().describe("Explicitly clear biological sex."),
    }),
    output: z.object({
      status: z.enum(["applied", "unchanged", "rejected"]),
      reason: z.literal("demographics_unresolved").nullable(),
      demographics: memoryDemographicsSchema,
    }),
    async run({ options }) {
      return runMemoryCommand(async () => {
        if ((options.age !== undefined && !options.asOf)
          || (options.clearBirth && (options.age !== undefined || options.birthYear !== undefined))
          || (options.clearSex && options.biologicalSex !== undefined)) {
          throw new VaultCliError("invalid_option", "Age requires --as-of; clearing excludes a replacement value.", {
            retryable: false, stage: "validation",
          });
        }
        return setMemoryDemographics(options.vault, {
          birthYear: options.clearBirth ? null : options.birthYear,
          age: options.age,
          biologicalSex: options.clearSex ? null : options.biologicalSex,
          asOf: options.asOf,
        });
      });
    },
  });

  memory.command("upsert", {
    description: "Add one new canonical memory record.",
    args: z.object({
      text: memoryTextArgSchema,
    }),
    options: memoryUpsertOptionsSchema,
    output: memoryUpsertResultSchema,
    async run({ args, options }) {
      return runMemoryCommand(async () => {
        const result = await upsertMemory(options.vault, {
          section: options.section as MemorySection,
          text: args.text,
        });
        return {
          created: result.created,
          ...memoryWriteReceipt(options.full, result.document, result.record),
        };
      });
    },
  });

  memory.command("update", {
    description: "Update one existing canonical memory record by id.",
    args: z.object({
      memoryId: memoryIdArgSchema,
      text: memoryTextArgSchema,
    }),
    options: memoryUpdateOptionsSchema,
    output: memoryUpsertResultSchema,
    async run({ args, options }) {
      return runMemoryCommand(async () => {
        const result = await updateMemory(options.vault, {
          recordId: args.memoryId,
          section: options.section ?? null,
          text: args.text,
        });
        return {
          created: false,
          ...memoryWriteReceipt(options.full, result.document, result.record),
        };
      });
    },
  });

  memory.command("forget", {
    description: "Delete one canonical memory record by id.",
    args: z.object({
      memoryId: memoryIdArgSchema,
    }),
    options: memoryWriteOptionsSchema,
    output: memoryForgetResultSchema,
    async run({ args, options }) {
      return runMemoryCommand(async () => {
        const result = await forgetMemory(options.vault, {
          recordId: args.memoryId,
        });
        return {
          existed: result.existed,
          ...memoryWriteReceipt(options.full, result.document, result.record),
        };
      });
    },
  });

  cli.command(memory);
}

// The record is the readback; the whole document grows with memory, so it is opt-in.
function memoryWriteReceipt<TRecord extends MemoryRecord | null>(
  full: boolean | undefined,
  document: MemoryDocumentSnapshot,
  record: TRecord,
) {
  if (full) {
    return { document, memory: record };
  }
  return {
    memory: record && { id: record.id, section: record.section, text: record.text },
  };
}

async function runMemoryCommand<TResult>(run: () => Promise<TResult>): Promise<TResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof VaultCliError) {
      throw error;
    }
    if (error instanceof MemoryDocumentParseError) {
      const { field, issue, lineNumber, sourcePath } = error.details;
      const location = lineNumber === undefined ? sourcePath : `${sourcePath}:${lineNumber}`;
      throw new VaultCliError(
        "memory_document_invalid",
        `Canonical memory document ${location} could not be read.`,
        {
          retryable: false,
          issue,
          sourcePath,
          stage: "read",
          ...(lineNumber ? { lineNumber } : {}),
          ...(field
            ? {
                issues: [{
                  publicPath: [field],
                  code: "custom",
                }],
              }
            : {}),
        },
      );
    }
    if (error instanceof MemoryRecordNotFoundError) {
      throw new VaultCliError(
        "memory_not_found",
        "The requested canonical memory record does not exist.",
        { retryable: false, stage: "read" },
      );
    }
    if (error instanceof MemoryPersistenceError) {
      throw new VaultCliError(
        "memory_persistence_invalid",
        "The canonical memory write completed but could not be verified. Inspect canonical memory before deciding whether another write is necessary.",
        { retryable: false, stage: "persistence" },
      );
    }
    throw error;
  }
}
