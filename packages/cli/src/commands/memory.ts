import { Cli, z } from "incur";

import {
  memoryDocumentSnapshotSchema,
  memoryRecordSchema,
  memorySectionSchema,
  type MemorySection,
} from "@murphai/contracts";
import {
  forgetMemory,
  getMemoryRecord,
  readMemoryDocument,
  updateMemory,
  upsertMemory,
} from "@murphai/core";

const vaultOptionSchema = z.object({
  vault: z.string().min(1).describe("Vault root."),
});

const memoryUpsertOptionsSchema = vaultOptionSchema.extend({
  section: memorySectionSchema.describe("Memory section to write into."),
});

const memoryUpdateOptionsSchema = vaultOptionSchema.extend({
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

const memoryShowResultSchema = z.object({
  vault: z.string().min(1),
  document: memoryDocumentSnapshotSchema,
  memory: memoryRecordSchema.nullable(),
});

const memoryUpsertResultSchema = z.object({
  vault: z.string().min(1),
  created: z.boolean(),
  document: memoryDocumentSnapshotSchema,
  memory: memoryRecordSchema,
});

const memoryForgetResultSchema = z.object({
  vault: z.string().min(1),
  existed: z.boolean(),
  document: memoryDocumentSnapshotSchema,
  memory: memoryRecordSchema.nullable(),
});

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
    options: vaultOptionSchema,
    output: memoryShowResultSchema,
    async run({ args, options }) {
      const document = await readMemoryDocument(options.vault);
      const memory = args.memoryId ? await getMemoryRecord(options.vault, args.memoryId) : null;
      return {
        vault: options.vault,
        document,
        memory,
      };
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
      const result = await upsertMemory(options.vault, {
        section: options.section as MemorySection,
        text: args.text,
      });
      return {
        vault: options.vault,
        created: result.created,
        document: result.document,
        memory: result.record,
      };
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
      const result = await updateMemory(options.vault, {
        recordId: args.memoryId,
        section: options.section ?? null,
        text: args.text,
      });
      return {
        vault: options.vault,
        created: false,
        document: result.document,
        memory: result.record,
      };
    },
  });

  memory.command("forget", {
    description: "Delete one canonical memory record by id.",
    args: z.object({
      memoryId: memoryIdArgSchema,
    }),
    options: vaultOptionSchema,
    output: memoryForgetResultSchema,
    async run({ args, options }) {
      const result = await forgetMemory(options.vault, {
        recordId: args.memoryId,
      });
      return {
        vault: options.vault,
        existed: result.existed,
        document: result.document,
        memory: result.record,
      };
    },
  });

  cli.command(memory);
}
