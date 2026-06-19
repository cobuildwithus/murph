import { Cli, z } from "incur";

import {
  HostedCliBridgeRequestError,
  readHostedCliBridgeEnv,
  requestHostedCliAssistantCurrentRoute,
  type HostedCliAssistantCurrentRoute,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import {
  automationContinuityPolicyValues,
  automationDeviceActivityKindSchema,
  automationRouteSchema,
  automationScaffoldPayloadSchema,
  automationScheduleSchema,
  automationScheduleKindValues,
  automationTimeScheduleKindValues,
  automationStatusValues,
  type AutomationRoute,
  type AutomationScaffoldPayload,
  type AutomationDeviceActivityKind,
  type AutomationDeviceActivitySource,
  type AutomationSchedule,
  type AutomationScheduleKind,
  type AutomationTimeScheduleKind,
} from "@murphai/contracts";
import {
  getAssistantAutomationRouteDeliverabilityIssue,
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
  patchAutomation,
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
  activityKind?: string;
  deviceSource?: AutomationDeviceActivitySource;
  scheduleAt?: string;
  scheduleCron?: string;
  scheduleEveryMs?: number;
  scheduleKind?: AutomationTimeScheduleKind;
  scheduleLocalTime?: string;
  triggerAt?: string;
  triggerCron?: string;
  triggerEveryMs?: number;
  triggerKind?: AutomationScheduleKind;
  triggerLocalTime?: string;
}

interface AutomationRouteOptions {
  channel?: string;
  deliveryTarget?: string;
  identityId?: string;
  participantId?: string;
  threadId?: string;
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
  return invalidAutomationOption(`--${optionName} is required for this automation command mode.`);
}

function requireNumberOption(
  value: number | undefined,
  optionName: string,
): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return invalidAutomationOption(`--${optionName} is required for this automation command mode.`);
}

function resolveAutomationTriggerKind(options: AutomationScheduleOptions): AutomationScheduleKind {
  if (options.triggerKind && options.scheduleKind && options.triggerKind !== options.scheduleKind) {
    return invalidAutomationOption("--trigger-kind and --schedule-kind must match when both are provided.");
  }

  return options.triggerKind ?? options.scheduleKind ?? invalidAutomationOption(
    "--trigger-kind is required. Legacy --schedule-kind is still accepted as an alias.",
  );
}

function buildAutomationScheduleFromOptions(
  options: AutomationScheduleOptions,
  defaults: { now: string },
): AutomationSchedule {
  const kind = resolveAutomationTriggerKind(options);
  if (kind !== "deviceActivity" && (options.deviceSource || options.activityKind)) {
    return invalidAutomationOption(
      "--device-source and --activity-kind can only be used with --trigger-kind=deviceActivity.",
    );
  }

  switch (kind) {
    case "at":
      return automationScheduleSchema.parse({
        kind: "at",
        at: requireStringOption(options.triggerAt ?? options.scheduleAt, "trigger-at"),
      });
    case "every":
      return automationScheduleSchema.parse({
        kind: "every",
        everyMs: requireNumberOption(options.triggerEveryMs ?? options.scheduleEveryMs, "trigger-every-ms"),
      });
    case "cron":
      return automationScheduleSchema.parse({
        kind: "cron",
        expression: requireStringOption(options.triggerCron ?? options.scheduleCron, "trigger-cron"),
      });
    case "dailyLocal":
      return automationScheduleSchema.parse({
        kind: "dailyLocal",
        localTime: requireStringOption(options.triggerLocalTime ?? options.scheduleLocalTime, "trigger-local-time"),
      });
    case "deviceActivity":
      return automationScheduleSchema.parse({
        kind: "deviceActivity",
        after: defaults.now,
        ...(options.deviceSource ? { source: options.deviceSource } : {}),
        ...(options.activityKind ? { activityKind: normalizeDeviceActivityKindOption(options.activityKind) } : {}),
      });
  }
}

function hasDefinedAutomationOption(options: object): boolean {
  return Object.values(options).some((value) => value !== undefined);
}

// Only save/create may inherit the hosted assistant's current conversation as
// the route; edit always requires a complete explicit route.
async function buildAutomationSaveRouteFromOptions(input: AutomationRouteOptions): Promise<AutomationRoute> {
  return buildAutomationRouteFromOptions(input, await readAutomationSaveCurrentRoute(input));
}

function buildAutomationRouteFromOptions(
  input: AutomationRouteOptions,
  currentRoute: HostedCliAssistantCurrentRoute | null,
): AutomationRoute {
  // Strip redacted placeholders from the model-typed flags before merging:
  // the current route comes from the hosted bridge, not model text, and its
  // locators are trusted as-is (hosted linq locators are hid_-blinded by
  // design, the same values session bindings persist).
  const explicit = stripPrivateAssistantRoutePlaceholders({
    channel: normalizeAutomationRouteOption(input.channel),
    deliveryTarget: normalizeAutomationRouteOption(input.deliveryTarget),
    identityId: normalizeAutomationRouteOption(input.identityId),
    participantId: normalizeAutomationRouteOption(input.participantId),
    threadId: normalizeAutomationRouteOption(input.threadId),
  });
  const parsed = automationRouteSchema.parse(
    resolveAssistantDeliveryRouteWithCurrentRoute(explicit, currentRoute),
  );

  assertAutomationRouteCanDeliver(parsed);
  return parsed;
}

async function readAutomationSaveCurrentRoute(input: AutomationRouteOptions): Promise<HostedCliAssistantCurrentRoute | null> {
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

  return null;
}

// The current route both fills a fully omitted route and enriches an explicit
// same-conversation target with its missing conversation locators, so it is
// needed whenever any of those fields is still unset.
function automationSaveNeedsCurrentRoute(input: AutomationRouteOptions): boolean {
  return !normalizeAutomationRouteOption(input.channel)
    || !normalizeAutomationRouteOption(input.identityId)
    || !normalizeAutomationRouteOption(input.participantId)
    || !normalizeAutomationRouteOption(input.threadId);
}

function assertAutomationRouteCanDeliver(
  route: AutomationRoute,
  options: {
    allowEmailThreadDelivery?: boolean;
    allowLinqThreadDelivery?: boolean;
  } = {},
): void {
  const issue = getAssistantAutomationRouteDeliverabilityIssue(route, options);
  if (issue) {
    throw new VaultCliError("invalid_option", issue.message);
  }
}

function assertActiveAutomationRouteCanDeliver(route: AutomationRoute): void {
  assertAutomationRouteCanDeliver(route, {
    allowEmailThreadDelivery: true,
    allowLinqThreadDelivery: true,
  });
}

function normalizeAutomationRouteForSave(route: AutomationRoute): AutomationRoute {
  const normalized = normalizeAutomationRouteFieldsForSave(route);
  assertAutomationRouteCanDeliver(normalized);
  return normalized;
}

function normalizeAutomationRouteFieldsForSave(route: unknown): AutomationRoute {
  return automationRouteSchema.parse(
    stripPrivateAssistantRoutePlaceholders(
      automationRouteSchema.parse(route),
    ),
  );
}

function normalizeAutomationRouteOption(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeAutomationTagOptions(input: {
  tag?: readonly string[];
  tags?: readonly string[];
}): string[] | undefined {
  if (input.tag !== undefined && input.tags !== undefined) {
    throw new VaultCliError(
      "invalid_option",
      "Use --tag or legacy --tags, not both.",
    );
  }

  const values = input.tag ?? input.tags;
  if (values === undefined) {
    return undefined;
  }

  return normalizeRepeatableFlagOption(
    values,
    input.tag === undefined ? "tags" : "tag",
  );
}

function normalizeDeviceActivityKindOption(
  value: string | undefined,
): AutomationDeviceActivityKind | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const parsed = automationDeviceActivityKindSchema.safeParse(normalized);
  if (!parsed.success) {
    return invalidAutomationOption(
      "--activity-kind must contain at least one letter or number and normalize to a lowercase kebab-case device activity kind.",
    );
  }

  return parsed.data;
}

const automationSharedOptionSchemas = {
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
  tag: z
    .array(z.string().min(1))
    .optional()
    .describe("Optional automation tag. Repeat --tag for multiple values."),
  tags: z
    .array(z.string().min(1))
    .optional()
    .describe("Legacy alias for --tag. Repeat --tags for multiple values. Do not comma-delimit multiple tags."),
  continuityPolicy: z
    .enum(automationContinuityPolicyValues)
    .optional()
    .describe("Optional continuity policy for scheduled assistant context."),
  triggerKind: z.enum(automationScheduleKindValues).optional().describe("Automation trigger discriminator."),
  triggerAt: z
    .string()
    .min(1)
    .optional()
    .describe("Required timestamp when --trigger-kind=at."),
  triggerEveryMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Required positive millisecond interval when --trigger-kind=every."),
  triggerCron: z
    .string()
    .min(1)
    .optional()
    .describe("Required cron expression when --trigger-kind=cron."),
  triggerLocalTime: z
    .string()
    .regex(dailyLocalTimePattern, "Expected a 24-hour HH:MM time.")
    .optional()
    .describe("Required HH:MM local time when --trigger-kind=dailyLocal."),
  deviceSource: z.enum(["whoop", "whoop_v2"]).optional().describe("Optional device activity source filter."),
  activityKind: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Optional device activity/resource kind filter, e.g. sleep, basketball, dance, surfing, walk, strength-training, workout."),
  scheduleKind: z.enum(automationTimeScheduleKindValues).optional().describe("Legacy alias for time-based --trigger-kind values."),
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
};

const automationSaveOptionSchemas = {
  id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional existing automation id to update."),
  ...automationSharedOptionSchemas,
  instructions: z
    .string()
    .min(1)
    .describe("Automation instructions to run on the schedule."),
};

const automationEditOptionSchemas = {
  title: z
    .string()
    .min(1)
    .max(160)
    .optional()
    .describe("Optional automation title."),
  ...automationSharedOptionSchemas,
  instructions: z
    .string()
    .min(1)
    .optional()
    .describe("Optional automation instructions."),
};

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
          title: "'Daily mobility'",
        },
        description: "Save a daily automation without a JSON payload.",
        options: {
          channel: "telegram",
          deliveryTarget: "telegram_thread_real",
          instructions: "'Ask about mobility work and summarize the next step.'",
          scheduleKind: "dailyLocal",
          scheduleLocalTime: "08:30",
          slug: "daily-mobility",
          vault: "./vault",
        },
      },
    ],
    hint: "Use automation import-json only when importing an advanced JSON payload from @file.json or stdin.",
    options: withBaseOptions(automationSaveOptionSchemas),
    output: automationSaveResultSchema,
    async run(context) {
      const now = new Date().toISOString();
      const input: AutomationScaffoldPayload = automationScaffoldPayloadSchema.parse({
        automationId: context.options.id,
        continuityPolicy: context.options.continuityPolicy,
        instructions: context.options.instructions,
        route: await buildAutomationSaveRouteFromOptions({
          channel: context.options.channel,
          deliveryTarget: context.options.deliveryTarget,
          identityId: context.options.identityId,
          participantId: context.options.participantId,
          threadId: context.options.threadId,
        }),
        schedule: buildAutomationScheduleFromOptions({
          activityKind: context.options.activityKind,
          deviceSource: context.options.deviceSource,
          scheduleAt: context.options.scheduleAt,
          scheduleCron: context.options.scheduleCron,
          scheduleEveryMs: context.options.scheduleEveryMs,
          scheduleKind: context.options.scheduleKind,
          scheduleLocalTime: context.options.scheduleLocalTime,
          triggerAt: context.options.triggerAt,
          triggerCron: context.options.triggerCron,
          triggerEveryMs: context.options.triggerEveryMs,
          triggerKind: context.options.triggerKind,
          triggerLocalTime: context.options.triggerLocalTime,
        }, { now }),
        slug: context.options.slug,
        status: context.options.status,
        summary: context.options.summary,
        tags: normalizeAutomationTagOptions({
          tag: context.options.tag,
          tags: context.options.tags,
        }),
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

  automation.command("edit", {
    args: z.object({
      lookup: z.string().min(1).describe("Existing automation id or slug to edit."),
    }),
    description: "Patch one existing automation from typed command fields.",
    examples: [
      {
        args: {
          lookup: "daily-mobility",
        },
        description: "Update an automation continuity policy without resubmitting instructions, schedule, or route fields.",
        options: {
          continuityPolicy: "preserve",
          vault: "./vault",
        },
      },
    ],
    hint: "Use automation save when creating an automation or replacing the full typed automation shape.",
    options: withBaseOptions(automationEditOptionSchemas),
    output: automationSaveResultSchema,
    async run(context) {
      const now = new Date().toISOString();
      const routeOptions = {
        channel: context.options.channel,
        deliveryTarget: context.options.deliveryTarget,
        identityId: context.options.identityId,
        participantId: context.options.participantId,
        threadId: context.options.threadId,
      };
      const scheduleOptions = {
        activityKind: context.options.activityKind,
        deviceSource: context.options.deviceSource,
        scheduleAt: context.options.scheduleAt,
        scheduleCron: context.options.scheduleCron,
        scheduleEveryMs: context.options.scheduleEveryMs,
        scheduleKind: context.options.scheduleKind,
        scheduleLocalTime: context.options.scheduleLocalTime,
        triggerAt: context.options.triggerAt,
        triggerCron: context.options.triggerCron,
        triggerEveryMs: context.options.triggerEveryMs,
        triggerKind: context.options.triggerKind,
        triggerLocalTime: context.options.triggerLocalTime,
      };
      const route = hasDefinedAutomationOption(routeOptions)
        ? buildAutomationRouteFromOptions(routeOptions, null)
        : undefined;
      if (context.options.status === "active" && route === undefined) {
        const existing = await showAutomation(context.options.vault, context.args.lookup);
        if (!existing) {
          throw new VaultCliError(
            "automation_not_found",
            "Automation was not found.",
          );
        }
        assertActiveAutomationRouteCanDeliver(existing.route);
      }
      const result = await patchAutomation({
        continuityPolicy: context.options.continuityPolicy,
        instructions: context.options.instructions,
        lookup: context.args.lookup,
        // Route flags replace the stored route wholesale: a route names one
        // conversation, so it is never merged field-wise or inherited from the
        // assistant's current conversation.
        route,
        schedule: hasDefinedAutomationOption(scheduleOptions)
          ? buildAutomationScheduleFromOptions(scheduleOptions, { now })
          : undefined,
        slug: context.options.slug,
        status: context.options.status,
        summary: context.options.summary,
        tags: normalizeAutomationTagOptions({
          tag: context.options.tag,
          tags: context.options.tags,
        }),
        title: context.options.title,
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

  automation.command("set-status", {
    args: z.object({
      lookup: z.string().min(1).describe("Automation id or slug to update."),
    }),
    description: "Update one automation status while preserving its existing definition.",
    options: withBaseOptions({
      status: z.enum(automationStatusValues).describe("New automation status."),
    }),
    output: automationSaveResultSchema,
    async run(context) {
      const existing = await showAutomation(context.options.vault, context.args.lookup);
      if (!existing) {
        throw new VaultCliError(
          "automation_not_found",
          "Automation was not found.",
        );
      }
      if (context.options.status === "active") {
        assertActiveAutomationRouteCanDeliver(existing.route);
      }

      const result = await upsertAutomation({
        automationId: existing.automationId,
        continuityPolicy: existing.continuityPolicy,
        instructions: existing.instructions,
        route: existing.route,
        schedule: existing.schedule,
        slug: existing.slug,
        status: context.options.status,
        summary: existing.summary ?? undefined,
        tags: existing.tags,
        title: existing.title,
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
