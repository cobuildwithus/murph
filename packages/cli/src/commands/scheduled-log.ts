import { Cli, z } from "incur";

import {
  scheduleIntentSchema,
  scheduledLogActionSchema,
  scheduledLogScaffoldPayloadSchema,
  scheduledLogStatusValues,
  type ScheduledLogScaffoldPayload,
  type ScheduledLogStatus,
} from "@murphai/contracts";
import {
  buildScheduledLogMarkdownPreview,
  scaffoldScheduledLogPayload,
  setScheduledLogStatus,
  upsertScheduledLog,
} from "@murphai/core";
import {
  listScheduledLogs,
  showScheduledLog,
} from "@murphai/query";
import { withBaseOptions } from "@murphai/operator-config/command-helpers";
import { pathSchema } from "@murphai/operator-config/vault-cli-contracts";
import { loadJsonInputObject, textInputOptionSchema } from "@murphai/vault-usecases";

const scheduledLogSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const scheduledLogRecordSchema = z
  .object({
    scheduledLogId: z.string().min(1),
    slug: z.string().regex(scheduledLogSlugPattern),
    title: z.string().min(1),
    status: z.enum(scheduledLogStatusValues),
    summary: z.string().min(1).nullable(),
    schedule: scheduleIntentSchema,
    action: scheduledLogActionSchema,
    tags: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    body: z.string(),
    relativePath: pathSchema,
    markdown: z.string().min(1),
  })
  .strict();

export const scheduledLogListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: z.array(z.enum(scheduledLogStatusValues)).nullable(),
    text: z.string().nullable(),
    limit: z.number().int().positive().max(200),
  }),
  count: z.number().int().nonnegative(),
  items: z.array(scheduledLogRecordSchema),
});

export const scheduledLogShowResultSchema = z.object({
  vault: pathSchema,
  scheduledLog: scheduledLogRecordSchema.nullable(),
});

export const scheduledLogUpsertResultSchema = z.object({
  vault: pathSchema,
  scheduledLogId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
});

export const scheduledLogScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal("scheduled-log"),
  payload: scheduledLogScaffoldPayloadSchema,
  markdown: z.string().min(1),
});

export const scheduledLogStatusResultSchema = z.object({
  vault: pathSchema,
  scheduledLogId: z.string().min(1),
  lookupId: z.string().min(1),
  status: z.enum(scheduledLogStatusValues),
});

export function createScheduledLogScaffoldPayload(): ScheduledLogScaffoldPayload {
  return scheduledLogScaffoldPayloadSchema.parse(scaffoldScheduledLogPayload());
}

export function registerScheduledLogCommands(cli: Cli.Cli) {
  const scheduledLog = Cli.create("scheduled-log", {
    description: "Canonical scheduled auto-log registry commands.",
  });

  scheduledLog.command("scaffold", {
    args: z.object({}),
    description: "Emit a scheduled-log payload template for `scheduled-log upsert`.",
    options: withBaseOptions(),
    output: scheduledLogScaffoldResultSchema,
    run(context) {
      const payload = createScheduledLogScaffoldPayload();
      return {
        vault: context.options.vault,
        noun: "scheduled-log" as const,
        payload,
        markdown: buildScheduledLogMarkdownPreview(payload),
      };
    },
  });

  scheduledLog.command("show", {
    args: z.object({
      lookup: z.string().min(1).describe("Scheduled log id or slug to show."),
    }),
    description: "Show one scheduled log by id or slug.",
    options: withBaseOptions(),
    output: scheduledLogShowResultSchema,
    async run(context) {
      return {
        vault: context.options.vault,
        scheduledLog: await showScheduledLog(context.options.vault, context.args.lookup),
      };
    },
  });

  scheduledLog.command("list", {
    args: z.object({}),
    description: "List scheduled logs with optional filters.",
    options: withBaseOptions({
      status: z
        .array(z.enum(scheduledLogStatusValues))
        .optional()
        .describe("Optional repeated status filter."),
      text: z
        .string()
        .min(1)
        .optional()
        .describe("Optional lexical filter across title, action, schedule, and body."),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: scheduledLogListResultSchema,
    async run(context) {
      const items = await listScheduledLogs(context.options.vault, {
        limit: context.options.limit,
        status: context.options.status,
        text: context.options.text,
      });

      return {
        vault: context.options.vault,
        filters: {
          status: context.options.status ?? null,
          text: context.options.text ?? null,
          limit: context.options.limit,
        },
        count: items.length,
        items,
      };
    },
  });

  scheduledLog.command("upsert", {
    args: z.object({}),
    description: "Create or update one scheduled log from a JSON payload.",
    options: withBaseOptions({
      input: textInputOptionSchema.describe(
        "Scheduled-log payload in @file.json form or - for stdin.",
      ),
    }),
    output: scheduledLogUpsertResultSchema,
    async run(context) {
      const rawInput = await loadJsonInputObject(
        context.options.input,
        "scheduled-log payload",
      );
      const input = scheduledLogScaffoldPayloadSchema.parse(rawInput);
      const result = await upsertScheduledLog({
        ...input,
        vaultRoot: context.options.vault,
      });

      return {
        vault: context.options.vault,
        scheduledLogId: result.record.scheduledLogId,
        lookupId: result.record.slug,
        path: result.record.relativePath,
        created: result.created,
      };
    },
  });

  for (const [commandName, status] of [
    ["pause", "paused"],
    ["resume", "active"],
    ["archive", "archived"],
  ] as const satisfies ReadonlyArray<readonly [string, ScheduledLogStatus]>) {
    scheduledLog.command(commandName, {
      args: z.object({
        lookup: z.string().min(1).describe("Scheduled log id or slug to update."),
      }),
      description: `${commandName[0]?.toUpperCase() ?? ""}${commandName.slice(1)} a scheduled log.`,
      options: withBaseOptions(),
      output: scheduledLogStatusResultSchema,
      async run(context) {
        const existing = await showScheduledLog(context.options.vault, context.args.lookup);
        if (!existing) {
          throw new Error(`Scheduled log "${context.args.lookup}" was not found.`);
        }
        const result = await setScheduledLogStatus({
          vaultRoot: context.options.vault,
          scheduledLogId: existing.scheduledLogId,
          status,
        });

        return {
          vault: context.options.vault,
          scheduledLogId: result.record.scheduledLogId,
          lookupId: result.record.slug,
          status: result.record.status,
        };
      },
    });
  }

  cli.command(scheduledLog);
}
