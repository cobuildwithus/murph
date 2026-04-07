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
  upsertMemory,
} from "@murphai/core";

const vaultOptionSchema = z.object({
  vault: z.string().min(1).describe("Vault root."),
});

const memoryUpsertOptionsSchema = vaultOptionSchema.extend({
  section: memorySectionSchema.describe("Memory section to write into."),
  memoryId: z.string().min(1).optional().describe("Optional existing memory id to update."),
});

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
      memoryId: z.string().min(1).optional(),
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
    description: "Add or update one canonical memory record.",
    args: z.object({
      text: z.string().min(1),
    }),
    options: memoryUpsertOptionsSchema,
    output: memoryUpsertResultSchema,
    async run({ args, options }) {
      const result = await upsertMemory(options.vault, {
        recordId: options.memoryId ?? null,
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

  memory.command("forget", {
    description: "Delete one canonical memory record by id.",
    args: z.object({
      memoryId: z.string().min(1),
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
