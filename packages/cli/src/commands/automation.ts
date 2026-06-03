import { Cli, z } from "incur";

import {
  HostedCliBridgeRequestError,
  isHostedRuntimeProcessEnv,
  readHostedCliBridgeEnv,
  requestHostedCliAssistantCurrentRoute,
  type HostedCliAssistantCurrentRoute,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import {
  automationContinuityPolicyValues,
  automationRouteSchema,
  automationScaffoldPayloadSchema,
  automationScheduleSchema,
  automationScheduleKindValues,
  automationStatusValues,
  type AutomationRoute,
  type AutomationScaffoldPayload,
  type AutomationSchedule,
  type AutomationScheduleKind,
} from "@murphai/contracts";
import {
  looksLikePrivateAssistantRoutePlaceholder,
  readAssistantCurrentDeliveryRouteEnv,
  resolveAssistantDeliveryRouteWithCurrentRoute,
  stripPrivateAssistantRoutePlaceholders,
} from "@murphai/operator-config/assistant/current-delivery-route";
import {
  withBaseOptions,
} from "@murphai/operator-config/command-helpers";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  loadJsonInputObject,
  normalizeRepeatableFlagOption,
  textInputOptionSchema,
} from "@murphai/vault-usecases";
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
const dailyLocalTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

interface AutomationScheduleOptions {
  scheduleAt?: string;
  scheduleCron?: string;
  scheduleEveryMs?: number;
  scheduleKind: AutomationScheduleKind;
  scheduleLocalTime?: string;
}

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
    instructions: z.string().min(1),
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

export const automationSaveResultSchema = z.object({
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

function invalidAutomationOption(message: string): never {
  throw new VaultCliError("invalid_option", message);
}

function requireStringOption(
  value: string | undefined,
  optionName: string,
): string {
  if (typeof value === "string" && value.length > 0) return value;
  return invalidAutomationOption(`--${optionName} is required for this automation save mode.`);
}

function requireNumberOption(
  value: number | undefined,
  optionName: string,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return invalidAutomationOption(`--${optionName} is required for this automation save mode.`);
}

function buildAutomationScheduleFromOptions(
  options: AutomationScheduleOptions,
): AutomationSchedule {
  switch (options.scheduleKind) {
    case "at":
      return automationScheduleSchema.parse({
        kind: "at",
        at: requireStringOption(options.scheduleAt, "schedule-at"),
      });
    case "every":
      return automationScheduleSchema.parse({
        kind: "every",
        everyMs: requireNumberOption(options.scheduleEveryMs, "schedule-every-ms"),
      });
    case "cron":
      return automationScheduleSchema.parse({
        kind: "cron",
        expression: requireStringOption(options.scheduleCron, "schedule-cron"),
      });
    case "dailyLocal":
      return automationScheduleSchema.parse({
        kind: "dailyLocal",
        localTime: requireStringOption(options.scheduleLocalTime, "schedule-local-time"),
      });
  }
}

async function buildAutomationRouteFromOptions(input: {
  channel?: string;
  deliveryTarget?: string;
  identityId?: string;
  participantId?: string;
  threadId?: string;
}): Promise<AutomationRoute> {
  const currentRoute = await readAutomationSaveCurrentRoute(input);
  const route = stripPrivateAssistantRoutePlaceholders(
    resolveAssistantDeliveryRouteWithCurrentRoute({
      channel: input.channel,
      deliveryTarget: input.deliveryTarget,
      identityId: input.identityId,
      participantId: input.participantId,
      threadId: input.threadId,
    }, currentRoute),
  );
  const parsed = normalizeAutomationRouteFieldsForSave(route);

  assertAutomationRouteCanDeliver(parsed);
  return parsed;
}

async function readAutomationSaveCurrentRoute(input: {
  channel?: string;
  deliveryTarget?: string;
  participantId?: string;
  threadId?: string;
}): Promise<HostedCliAssistantCurrentRoute | null> {
  if (!automationSaveNeedsCurrentRoute(input)) {
    return null;
  }

  const bridge = readHostedCliBridgeEnv(process.env);
  if (bridge) {
    try {
      const response = await requestHostedCliAssistantCurrentRoute({ bridge });
      return response.route;
    } catch (error) {
      if (error instanceof HostedCliBridgeRequestError) {
        throw new VaultCliError(
          "invalid_option",
          "Unable to read the hosted assistant current delivery route.",
        );
      }
      throw error;
    }
  }

  if (isHostedRuntimeProcessEnv(process.env)) {
    return null;
  }

  return readAssistantCurrentDeliveryRouteEnv(process.env);
}

function automationSaveNeedsCurrentRoute(input: {
  channel?: string;
  deliveryTarget?: string;
  participantId?: string;
  threadId?: string;
}): boolean {
  const channel = normalizeAutomationRouteOption(input.channel);
  const deliveryTarget = normalizeAutomationRouteOption(input.deliveryTarget);
  if (!channel) {
    return true;
  }
  if (channel === "linq") {
    return !deliveryTarget;
  }
  return !deliveryTarget
    && !normalizeAutomationRouteOption(input.participantId)
    && !normalizeAutomationRouteOption(input.threadId);
}

function assertAutomationRouteCanDeliver(route: AutomationRoute): void {
  if (route.channel !== "linq") {
    return;
  }

  if (!route.deliveryTarget) {
    throw new VaultCliError(
      "invalid_option",
      "iMessage automation routes require an explicit delivery target. In assistant turns this is injected automatically; otherwise pass --delivery-target.",
    );
  }

  if (looksLikePrivateAssistantRoutePlaceholder(route.deliveryTarget)) {
    throw new VaultCliError(
      "invalid_option",
      "iMessage automation routes cannot use redacted conversation placeholders as delivery targets.",
    );
  }
}

function normalizeAutomationRouteForSave(route: AutomationRoute): AutomationRoute {
  const normalized = normalizeAutomationRouteFieldsForSave(route);
  assertAutomationRouteCanDeliver(normalized);
  return normalized;
}

function normalizeAutomationRouteFieldsForSave(route: unknown): AutomationRoute {
  const normalized = automationRouteSchema.parse(
    stripPrivateAssistantRoutePlaceholders(
      automationRouteSchema.parse(route),
    ),
  );
  if (normalized.channel !== "linq" || !normalized.deliveryTarget) {
    return normalized;
  }
  return {
    ...normalized,
    participantId: null,
    threadId: null,
  };
}

function normalizeAutomationRouteOption(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function registerAutomationCommands(cli: Cli.Cli) {
  const automation = Cli.create("automation", {
    description: "Canonical automation registry commands.",
  });

  automation.command("scaffold", {
    args: z.object({}),
    description: "Emit an advanced automation JSON payload template for import fallback use.",
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

  automation.command("save", {
    args: z.object({
      title: z.string().min(1).max(160).describe("Automation title."),
    }),
    description: "Create or update one automation from typed command fields.",
    examples: [
      {
        args: {
          title: "Daily mobility",
        },
        description: "Save a daily automation without a JSON payload.",
        options: {
          channel: "telegram",
          instructions: "Ask about mobility work and summarize the next step.",
          scheduleKind: "dailyLocal",
          scheduleLocalTime: "08:30",
          slug: "daily-mobility",
          vault: "./vault",
        },
      },
    ],
    hint: "Use automation import-json only when importing an advanced JSON payload from @file.json or stdin.",
    options: withBaseOptions({
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Optional existing automation id to update."),
      slug: z
        .string()
        .regex(automationSlugPattern)
        .optional()
        .describe("Optional stable lowercase kebab-case slug."),
      status: z.enum(automationStatusValues).optional().describe("Optional automation status."),
      summary: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe("Optional automation summary."),
      tags: z
        .array(z.string().min(1))
        .optional()
        .describe("Optional automation tags. Repeat --tags for multiple values."),
      continuityPolicy: z
        .enum(automationContinuityPolicyValues)
        .optional()
        .describe("Optional continuity policy for scheduled assistant context."),
      instructions: z
        .string()
        .min(1)
        .describe("Automation instructions to run on the schedule."),
      scheduleKind: z.enum(automationScheduleKindValues).describe("Schedule discriminator."),
      scheduleAt: z
        .string()
        .min(1)
        .optional()
        .describe("Required timestamp when --schedule-kind=at."),
      scheduleEveryMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Required positive millisecond interval when --schedule-kind=every."),
      scheduleCron: z
        .string()
        .min(1)
        .optional()
        .describe("Required cron expression when --schedule-kind=cron."),
      scheduleLocalTime: z
        .string()
        .regex(dailyLocalTimePattern, "Expected a 24-hour HH:MM time.")
        .optional()
        .describe("Required HH:MM local time when --schedule-kind=dailyLocal."),
      channel: z.string().min(1).optional().describe("Optional outbound route channel."),
      deliveryTarget: z
        .string()
        .min(1)
        .optional()
        .describe("Optional route delivery target."),
      identityId: z
        .string()
        .min(1)
        .optional()
        .describe("Optional route identity id."),
      participantId: z
        .string()
        .min(1)
        .optional()
        .describe("Optional route participant id."),
      threadId: z
        .string()
        .min(1)
        .optional()
        .describe("Optional route thread id."),
    }),
    output: automationSaveResultSchema,
    async run(context) {
      const input: AutomationScaffoldPayload = automationScaffoldPayloadSchema.parse({
        automationId: context.options.id,
        continuityPolicy: context.options.continuityPolicy,
        instructions: context.options.instructions,
        route: await buildAutomationRouteFromOptions({
          channel: context.options.channel,
          deliveryTarget: context.options.deliveryTarget,
          identityId: context.options.identityId,
          participantId: context.options.participantId,
          threadId: context.options.threadId,
        }),
        schedule: buildAutomationScheduleFromOptions(context.options),
        slug: context.options.slug,
        status: context.options.status,
        summary: context.options.summary,
        tags: normalizeRepeatableFlagOption(context.options.tags, "tags"),
        title: context.args.title,
      });
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
        .describe("Optional lexical filter across title, instructions, route, and metadata."),
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

  automation.command("import-json", {
    args: z.object({}),
    description: "Import or bulk-edit one automation from an advanced JSON payload.",
    hint: "Prefer automation save for canonical typed create/update usage.",
    options: withBaseOptions({
      input: textInputOptionSchema.describe(
        "Advanced automation payload in @file.json form or - for stdin.",
      ),
    }),
    output: automationSaveResultSchema,
    async run(context) {
      const input = automationScaffoldPayloadSchema.parse(
        await loadJsonInputObject(
          context.options.input,
          "automation payload",
        ),
      );
      const route = normalizeAutomationRouteForSave(input.route);
      const result = await upsertAutomation({
        ...input,
        route,
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
