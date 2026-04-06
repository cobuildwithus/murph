import { Cli, z } from "incur";

import {
  automationContinuityPolicyValues,
  automationRouteSchema,
  automationScaffoldPayloadSchema,
  automationScheduleSchema,
  automationStatusValues,
  type AutomationScaffoldPayload,
} from "@murphai/contracts";
import {
  withBaseOptions,
} from "@murphai/operator-config/command-helpers";
import { loadJsonInputObject, textInputOptionSchema } from "@murphai/vault-inbox/json-input";
import {
  pathSchema,
} from "@murphai/operator-config/vault-cli-contracts";
import {
  scaffoldAutomationPayload,
  upsertAutomation,
} from "@murphai/core";
import {
  listAutomations,
  showAutomation,
} from "@murphai/query";
const automationSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const automationRecordSchema = z
  .object({
    automationId: z.string().min(1),
    slug: z.string().regex(automationSlugPattern),
    title: z.string().min(1),
    status: z.enum(automationStatusValues),
    summary: z.string().min(1).nullable(),
    schedule: automationScheduleSchema,
    route: automationRouteSchema,
    continuityPolicy: z.enum(automationContinuityPolicyValues),
    tags: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    prompt: z.string().min(1),
    relativePath: pathSchema,
    markdown: z.string().min(1),
  })
  .strict();

export const automationListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: z.array(z.enum(automationStatusValues)).nullable(),
    text: z.string().nullable(),
    limit: z.number().int().positive().max(200),
  }),
  count: z.number().int().nonnegative(),
  items: z.array(automationRecordSchema),
});

export const automationShowResultSchema = z.object({
  vault: pathSchema,
  automation: automationRecordSchema.nullable(),
});

export const automationUpsertResultSchema = z.object({
  vault: pathSchema,
  automationId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
});

export const automationScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal("automation"),
  payload: automationScaffoldPayloadSchema,
});

export function createAutomationScaffoldPayload(): z.infer<
  typeof automationScaffoldResultSchema
>["payload"] {
  return automationScaffoldPayloadSchema.parse(scaffoldAutomationPayload());
}

export function registerAutomationCommands(cli: Cli.Cli) {
  const automation = Cli.create("automation", {
    description: "Canonical automation registry commands.",
  });

  automation.command("scaffold", {
    args: z.object({}),
    description: "Emit a canonical automation payload template for `automation upsert`.",
    options: withBaseOptions(),
    output: automationScaffoldResultSchema,
    run(context) {
      return {
        vault: context.options.vault,
        noun: "automation" as const,
        payload: createAutomationScaffoldPayload(),
      };
    },
  });

  automation.command("show", {
    args: z.object({
      lookup: z.string().min(1).describe("Automation id or slug to show."),
    }),
    description: "Show one automation record by id or slug.",
    options: withBaseOptions(),
    output: automationShowResultSchema,
    async run(context) {
      return {
        vault: context.options.vault,
        automation: await showAutomation(context.options.vault, context.args.lookup),
      };
    },
  });

  automation.command("list", {
    args: z.object({}),
    description: "List automation records with optional filters.",
    options: withBaseOptions({
      status: z
        .array(z.enum(automationStatusValues))
        .optional()
        .describe("Optional repeated status filter."),
      text: z
        .string()
        .min(1)
        .optional()
        .describe("Optional lexical filter across title, prompt, route, and metadata."),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: automationListResultSchema,
    async run(context) {
      const items = await listAutomations(context.options.vault, {
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

  automation.command("upsert", {
    args: z.object({}),
    description: "Create or update one automation record from a JSON payload.",
    options: withBaseOptions({
      input: textInputOptionSchema.describe(
        "Automation payload in @file.json form or - for stdin.",
      ),
    }),
    output: automationUpsertResultSchema,
    async run(context) {
      const input = automationScaffoldPayloadSchema.parse(
        (await loadJsonInputObject(
          context.options.input,
          "automation payload",
        )) as AutomationScaffoldPayload,
      );
      const result = await upsertAutomation({
        ...input,
        vaultRoot: context.options.vault,
      });

      return {
        vault: context.options.vault,
        automationId: result.record.automationId,
        lookupId: result.record.slug,
        path: result.record.relativePath,
        created: result.created,
      };
    },
  });

  cli.command(automation);
}
