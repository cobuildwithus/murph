import { Cli, z } from "incur";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import {
  MEMORY_DISPLAY_NAME_MAX_LENGTH,
  MemoryDocumentParseError,
  memoryDocumentSnapshotSchema,
  memoryRecordSchema,
  memorySectionSchema,
  type MemorySection,
} from "@murphai/contracts";
import {
  forgetMemory,
  getMemoryRecord,
  MemoryPersistenceError,
  MemoryRecordNotFoundError,
  readMemoryDocument,
  setMemoryDisplayName,
  updateMemory,
  upsertMemory,
} from "@murphai/core";

const vaultOptionSchema = z.object({
  vault: z.string().min(1).describe("Vault root."),
});

const memoryMutationOptionsSchema = vaultOptionSchema.extend({
  compact: z.boolean().optional().describe(
    "Return the mutation outcome and exact affected record without the full memory document.",
  ),
});

const memoryUpsertOptionsSchema = memoryMutationOptionsSchema.extend({
  section: memorySectionSchema.describe("Memory section to write into."),
});

const memoryUpdateOptionsSchema = memoryMutationOptionsSchema.extend({
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

const fullMemoryUpsertResultSchema = z.object({
  vault: z.string().min(1),
  created: z.boolean(),
  document: memoryDocumentSnapshotSchema,
  memory: memoryRecordSchema,
});

const memoryUpsertResultSchema = z.union([
  fullMemoryUpsertResultSchema,
  fullMemoryUpsertResultSchema.omit({ vault: true, document: true }),
]);

const fullMemoryForgetResultSchema = z.object({
  vault: z.string().min(1),
  existed: z.boolean(),
  document: memoryDocumentSnapshotSchema,
  memory: memoryRecordSchema.nullable(),
});

const memoryForgetResultSchema = z.union([
  fullMemoryForgetResultSchema,
  fullMemoryForgetResultSchema.omit({ vault: true, document: true }),
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
    options: memoryMutationOptionsSchema,
    output: memoryUpsertResultSchema,
    async run({ args, options }) {
      return runMemoryCommand(async () => {
        const result = await setMemoryDisplayName(options.vault, {
          displayName: args.displayName,
        });
        return {
          ...(options.compact ? {} : { vault: options.vault, document: result.document }),
          created: result.created,
          memory: result.record,
        };
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
          ...(options.compact ? {} : { vault: options.vault, document: result.document }),
          created: result.created,
          memory: result.record,
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
          ...(options.compact ? {} : { vault: options.vault, document: result.document }),
          created: false,
          memory: result.record,
        };
      });
    },
  });

  memory.command("forget", {
    description: "Delete one canonical memory record by id.",
    args: z.object({
      memoryId: memoryIdArgSchema,
    }),
    options: memoryMutationOptionsSchema,
    output: memoryForgetResultSchema,
    async run({ args, options }) {
      return runMemoryCommand(async () => {
        const result = await forgetMemory(options.vault, {
          recordId: args.memoryId,
        });
        return {
          ...(options.compact ? {} : { vault: options.vault, document: result.document }),
          existed: result.existed,
          memory: result.record,
        };
      });
    },
  });

  cli.command(memory);
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
