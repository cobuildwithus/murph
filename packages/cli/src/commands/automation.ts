import { Cli, z } from "incur";

import {
  AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
  AUTOMATION_SUPPORT_SERIES_TAG_PREFIX,
  assistantReasoningEffortValues,
  automationAssistantTargetOverrideSchema,
  automationActiveUntilSchema,
  automationContinuityPolicyValues,
  automationPlannedOccurrenceOffsetMsSchema,
  automationDeviceActivityKindSchema,
  automationRouteSchema,
  automationScaffoldPayloadSchema,
  automationScheduleSchema,
  automationScheduleKindValues,
  automationSupportKindValues,
  automationTimeScheduleKindValues,
  automationStatusValues,
  buildAutomationSupportSeriesTag,
  type AutomationAssistantTargetOverride,
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
  reconcileAutomationSupportSeries,
  scaffoldAutomationPayload,
  upsertAutomation,
} from "@murphai/core";
import {
  listAutomationPage,
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

interface AutomationLifecycleOptions {
  activeUntil?: string;
  clearActiveUntil?: boolean;
}

interface AutomationRouteOptions {
  channel?: string;
  deliveryTarget?: string;
  identityId?: string;
  participantId?: string;
  threadId?: string;
}

interface AutomationAssistantTargetOverrideOptions {
  assistantTargetOverrideModel?: string;
  assistantTargetOverrideModelProvider?: string;
  assistantTargetOverrideReasoningEffort?: string;
}

interface AutomationAssistantTargetOverrideEditOptions
  extends AutomationAssistantTargetOverrideOptions {
  clearAssistantTargetOverride?: boolean;
}

export const automationRecordSchema = z
  .object({
    automationId: z.string().min(1),
    slug: z.string().regex(automationSlugPattern),
    title: z.string().min(1),
    status: z.enum(automationStatusValues),
    summary: z.string().min(1).nullable(),
    activeUntil: automationActiveUntilSchema.nullable().default(null),
    schedule: automationScheduleSchema,
    route: automationRouteSchema,
    assistantTargetOverride: automationAssistantTargetOverrideSchema.nullable(),
    supportKind: z.enum(automationSupportKindValues).nullable(),
    plannedOccurrenceOffsetMs: automationPlannedOccurrenceOffsetMsSchema
      .nullable()
      .default(null),
    continuityPolicy: z.enum(automationContinuityPolicyValues),
    tags: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
    scheduleAnchorAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1),
    instructions: z.string().min(1),
    relativePath: pathSchema,
    markdown: z.string().min(1),
  })
  .strict();

export const automationListItemSchema = automationRecordSchema
  .omit({
    instructions: true,
    markdown: true,
  })
  .strict();

export const automationListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: z.array(z.enum(automationStatusValues)).nullable(),
    text: z.string().nullable(),
    supportSeriesId: z.string().nullable(),
    cursor: z.string().nullable(),
    limit: z.number().int().positive().max(200),
  }),
  count: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
  items: z.array(automationListItemSchema),
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

export const automationSupportSeriesReconcileResultSchema = z.object({
  vault: pathSchema,
  supportSeriesId: z.string().min(1),
  supportSeriesTag: z.string().min(1),
  desiredAutomationIds: z.array(z.string().min(1)),
  matchedCount: z.number().int().nonnegative(),
  archivedCount: z.number().int().nonnegative(),
  unchangedCount: z.number().int().nonnegative(),
  missingDesiredAutomationIds: z.array(z.string().min(1)),
  auditPath: pathSchema.nullable(),
});

export function createAutomationScaffoldPayload(): z.infer<
  typeof automationScaffoldResultSchema
>["payload"] {
  return automationScaffoldPayloadSchema.parse(scaffoldAutomationPayload());
}

function automationListItem(
  record: z.infer<typeof automationRecordSchema>,
): z.infer<typeof automationListItemSchema> {
  const { instructions, markdown, ...item } = record;
  void instructions;
  void markdown;
  return item;
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

function buildAutomationActiveUntilPatch(
  options: AutomationLifecycleOptions,
): string | null | undefined {
  if (options.clearActiveUntil === true) {
    if (options.activeUntil !== undefined) {
      return invalidAutomationOption(
        "--clear-active-until cannot be combined with --active-until.",
      );
    }
    return null;
  }

  return options.activeUntil;
}

function requireAutomationSupportSeriesTagFromId(seriesId: string): string {
  try {
    return buildAutomationSupportSeriesTag(seriesId);
  } catch {
    return invalidAutomationOption(
      "Support series id must be 1-200 characters using letters, numbers, colon, period, underscore, or hyphen.",
    );
  }
}

function buildAutomationRouteFromOptions(
  input: AutomationRouteOptions,
): AutomationRoute {
  const explicit = stripPrivateAssistantRoutePlaceholders({
    channel: normalizeAutomationRouteOption(input.channel),
    deliveryTarget: normalizeAutomationRouteOption(input.deliveryTarget),
    identityId: normalizeAutomationRouteOption(input.identityId),
    participantId: normalizeAutomationRouteOption(input.participantId),
    threadId: normalizeAutomationRouteOption(input.threadId),
  });
  return automationRouteSchema.parse(
    resolveAssistantDeliveryRouteWithCurrentRoute(explicit, null),
  );
}

function assertAutomationRouteCanDeliver(route: AutomationRoute): void {
  const issue = getAssistantAutomationRouteDeliverabilityIssue(route, "local");
  if (issue) {
    throw new VaultCliError("invalid_option", issue.message);
  }
}

function automationStatusIsActive(status: AutomationScaffoldPayload["status"] | undefined): boolean {
  return status === undefined || status === "active";
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

function buildAutomationAssistantTargetOverrideFromOptions(
  input: AutomationAssistantTargetOverrideOptions,
): AutomationAssistantTargetOverride | undefined {
  const model = normalizeAutomationRouteOption(input.assistantTargetOverrideModel);
  const modelProvider = normalizeAutomationRouteOption(input.assistantTargetOverrideModelProvider);
  const reasoningEffort = normalizeAutomationRouteOption(input.assistantTargetOverrideReasoningEffort);
  const target = automationAssistantTargetOverrideSchema.parse({
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  });

  return Object.keys(target).length > 0 ? target : undefined;
}

function buildAutomationAssistantTargetOverridePatchFromOptions(
  input: AutomationAssistantTargetOverrideEditOptions & {
    existingAssistantTargetOverride?: AutomationAssistantTargetOverride | null;
  },
): AutomationAssistantTargetOverride | null | undefined {
  const target = buildAutomationAssistantTargetOverrideFromOptions(input);
  if (input.clearAssistantTargetOverride === true) {
    if (target !== undefined) {
      return invalidAutomationOption(
        "--clear-assistant-target-override cannot be combined with assistant target override fields.",
      );
    }
    return null;
  }

  if (target === undefined) {
    return undefined;
  }

  return automationAssistantTargetOverrideSchema.parse({
    ...(input.existingAssistantTargetOverride ?? {}),
    ...target,
  });
}

function buildAutomationSupportKindPatchFromOptions(input: {
  clearSupportKind?: boolean;
  supportKind?: (typeof automationSupportKindValues)[number];
}): (typeof automationSupportKindValues)[number] | null | undefined {
  if (input.clearSupportKind === true) {
    if (input.supportKind !== undefined) {
      return invalidAutomationOption(
        "--clear-support-kind cannot be combined with --support-kind.",
      );
    }
    return null;
  }
  return input.supportKind;
}

function buildAutomationPlannedOccurrenceOffsetPatchFromOptions(input: {
  clearPlannedOccurrenceOffset?: boolean;
  plannedOccurrenceOffsetMs?: number;
}): number | null | undefined {
  if (input.clearPlannedOccurrenceOffset === true) {
    if (input.plannedOccurrenceOffsetMs !== undefined) {
      return invalidAutomationOption(
        "--clear-planned-occurrence-offset cannot be combined with --planned-occurrence-offset-ms.",
      );
    }
    return null;
  }
  return input.plannedOccurrenceOffsetMs;
}

function normalizeAutomationTagOptions(input: {
  existingTags?: readonly string[];
  supportSeriesId?: string;
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
  const normalizedTags = values === undefined
    ? undefined
    : normalizeRepeatableFlagOption(
        values,
        input.tag === undefined ? "tags" : "tag",
      );
  assertNoRawAutomationSupportSeriesTags(normalizedTags);

  if (input.supportSeriesId === undefined) {
    const existingSupportSeriesTag = input.existingTags?.find((tag) =>
      tag.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX)
    );
    if (normalizedTags !== undefined && existingSupportSeriesTag !== undefined) {
      return [...normalizedTags, existingSupportSeriesTag];
    }
    return normalizedTags;
  }

  const supportSeriesTag = requireAutomationSupportSeriesTagFromId(
    input.supportSeriesId,
  );
  const baseTags = normalizedTags ?? input.existingTags ?? [];
  return [
    ...baseTags.filter((tag) => !tag.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX)),
    supportSeriesTag,
  ];
}

function assertNoRawAutomationSupportSeriesTags(
  tags: readonly string[] | undefined,
): void {
  if (tags?.includes(AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG)) {
    return invalidAutomationOption(
      `${AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG} is an internal reconciliation marker and cannot be set directly.`,
    );
  }
  if (tags?.some((tag) => tag.trim().startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX))) {
    return invalidAutomationOption(
      `Reserved ${AUTOMATION_SUPPORT_SERIES_TAG_PREFIX}<series-id> tags must be set with --support-series-id.`,
    );
  }
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
  activeUntil: automationActiveUntilSchema
    .optional()
    .describe("Exclusive automation end timestamp, including a one-shot retry deadline."),
  clearActiveUntil: z
    .boolean()
    .optional()
    .describe("Clear the automation end timestamp."),
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
    .describe("Optional ordinary automation tag. Repeat --tag; use --support-series-id for reserved ownership."),
  tags: z
    .array(z.string().min(1))
    .optional()
    .describe("Legacy alias for --tag ordinary values. Reserved support-series tags are rejected."),
  supportSeriesId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Assign the canonical support-series id; reserved raw tags are not accepted."),
  supportKind: z
    .enum(automationSupportKindValues)
    .optional()
    .describe("Persist the exact accepted support purpose for a plan-owned automation."),
  plannedOccurrenceOffsetMs: automationPlannedOccurrenceOffsetMsSchema
    .optional()
    .describe("Milliseconds from this reminder to the planned session occurrence."),
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
  assistantTargetOverrideModel: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Optional assistant model override for scheduled turns."),
  assistantTargetOverrideModelProvider: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Optional assistant model provider override for scheduled turns."),
  assistantTargetOverrideReasoningEffort: z
    .enum(assistantReasoningEffortValues)
    .optional()
    .describe("Optional assistant reasoning effort override for scheduled turns."),
};

const automationSaveOptionSchemas = {
  id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional existing automation id whose full definition will be replaced."),
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
  clearSupportKind: z
    .boolean()
    .optional()
    .describe("Clear persisted plan-support consent metadata."),
  clearPlannedOccurrenceOffset: z
    .boolean()
    .optional()
    .describe("Clear the planned session occurrence offset."),
  clearAssistantTargetOverride: z
    .boolean()
    .optional()
    .describe("Clear the stored assistant target override."),
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
    description: "Create one automation or intentionally replace its full definition from typed command fields.",
    examples: [
      {
        args: {
          title: "'Daily mobility'",
        },
        description: "Create a daily automation without a JSON payload.",
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
    hint: "Use automation edit for existing-record changes and automation set-status for lifecycle changes. Use automation import-json only for an advanced JSON full-definition replacement from @file.json or stdin.",
    options: withBaseOptions(automationSaveOptionSchemas),
    output: automationSaveResultSchema,
    async run(context) {
      const now = new Date().toISOString();
      const route = buildAutomationRouteFromOptions({
        channel: context.options.channel,
        deliveryTarget: context.options.deliveryTarget,
        identityId: context.options.identityId,
        participantId: context.options.participantId,
        threadId: context.options.threadId,
      });
      if (automationStatusIsActive(context.options.status)) {
        assertAutomationRouteCanDeliver(route);
      }
      const input: AutomationScaffoldPayload = automationScaffoldPayloadSchema.parse({
        activeUntil: buildAutomationActiveUntilPatch({
          activeUntil: context.options.activeUntil,
          clearActiveUntil: context.options.clearActiveUntil,
        }),
        automationId: context.options.id,
        continuityPolicy: context.options.continuityPolicy,
        assistantTargetOverride: buildAutomationAssistantTargetOverrideFromOptions({
          assistantTargetOverrideModel: context.options.assistantTargetOverrideModel,
          assistantTargetOverrideModelProvider: context.options.assistantTargetOverrideModelProvider,
          assistantTargetOverrideReasoningEffort: context.options.assistantTargetOverrideReasoningEffort,
        }),
        supportKind: context.options.supportKind,
        plannedOccurrenceOffsetMs: context.options.plannedOccurrenceOffsetMs,
        instructions: context.options.instructions,
        route,
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
          supportSeriesId: context.options.supportSeriesId,
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
        description: "Patch an automation continuity policy without resubmitting instructions, schedule, or route fields.",
        options: {
          continuityPolicy: "preserve",
          vault: "./vault",
        },
      },
    ],
    hint: "Use automation save when creating an automation or intentionally replacing the full typed automation shape.",
    options: withBaseOptions(automationEditOptionSchemas),
    output: automationSaveResultSchema,
    async run(context) {
      const now = new Date().toISOString();
      const existing = await showAutomation(context.options.vault, context.args.lookup);
      if (!existing) {
        throw new VaultCliError(
          "automation_not_found",
          "Automation was not found.",
        );
      }
      const routeOptions = {
        channel: context.options.channel,
        deliveryTarget: context.options.deliveryTarget,
        identityId: context.options.identityId,
        participantId: context.options.participantId,
        threadId: context.options.threadId,
      };
      const assistantTargetOverrideOptions = {
        assistantTargetOverrideModel: context.options.assistantTargetOverrideModel,
        assistantTargetOverrideModelProvider: context.options.assistantTargetOverrideModelProvider,
        assistantTargetOverrideReasoningEffort: context.options.assistantTargetOverrideReasoningEffort,
        clearAssistantTargetOverride: context.options.clearAssistantTargetOverride,
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
        ? buildAutomationRouteFromOptions(routeOptions)
        : undefined;
      if (
        (context.options.status ?? existing.status) === "active"
      ) {
        assertAutomationRouteCanDeliver(route ?? existing.route);
      }
      const assistantTargetOverride = buildAutomationAssistantTargetOverridePatchFromOptions({
        ...assistantTargetOverrideOptions,
        existingAssistantTargetOverride: existing.assistantTargetOverride,
      });
      const result = await patchAutomation({
        activeUntil: buildAutomationActiveUntilPatch({
          activeUntil: context.options.activeUntil,
          clearActiveUntil: context.options.clearActiveUntil,
        }),
        assistantTargetOverride,
        supportKind: buildAutomationSupportKindPatchFromOptions({
          clearSupportKind: context.options.clearSupportKind,
          supportKind: context.options.supportKind,
        }),
        plannedOccurrenceOffsetMs: buildAutomationPlannedOccurrenceOffsetPatchFromOptions({
          clearPlannedOccurrenceOffset: context.options.clearPlannedOccurrenceOffset,
          plannedOccurrenceOffsetMs: context.options.plannedOccurrenceOffsetMs,
        }),
        continuityPolicy: context.options.continuityPolicy,
        instructions: context.options.instructions,
        lookup: context.args.lookup,
        // Route flags replace the stored route.
        route,
        schedule: hasDefinedAutomationOption(scheduleOptions)
          ? buildAutomationScheduleFromOptions(scheduleOptions, { now })
          : undefined,
        slug: context.options.slug,
        status: context.options.status,
        summary: context.options.summary,
        tags: normalizeAutomationTagOptions({
          existingTags: existing.tags,
          supportSeriesId: context.options.supportSeriesId,
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
        assertAutomationRouteCanDeliver(existing.route);
      }

      const result = await patchAutomation({
        lookup: context.args.lookup,
        status: context.options.status,
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
      supportSeriesId: z
        .string()
        .min(1)
        .optional()
        .describe("Optional exact support-series id filter, for example experiment:exp_123."),
      cursor: z
        .string()
        .min(1)
        .optional()
        .describe("Continue an exact support-series listing after this automation id."),
      limit: z.number().int().positive().max(200).default(10),
    }),
    output: automationListResultSchema,
    async run(context) {
      if (context.options.cursor !== undefined && context.options.supportSeriesId === undefined) {
        return invalidAutomationOption(
          "--cursor requires --support-series-id so pagination uses immutable automation ids.",
        );
      }
      const supportSeriesId = context.options.supportSeriesId?.trim();
      const exactTag = supportSeriesId === undefined
        ? undefined
        : requireAutomationSupportSeriesTagFromId(supportSeriesId);
      const page = await listAutomationPage(context.options.vault, {
        cursor: context.options.cursor,
        exactTag,
        limit: context.options.limit,
        status: context.options.status,
        text: context.options.text,
      });

      return {
        vault: context.options.vault,
        filters: {
          status: context.options.status ?? null,
          text: context.options.text ?? null,
          supportSeriesId: supportSeriesId ?? null,
          cursor: context.options.cursor ?? null,
          limit: context.options.limit,
        },
        count: page.items.length,
        totalCount: page.totalCount,
        nextCursor: page.nextCursor,
        items: page.items.map((item) => automationListItem(item)),
      };
    },
  });

  automation.command("reconcile-support-series", {
    args: z.object({
      seriesId: z
        .string()
        .min(1)
        .describe("Canonical support-series id, for example experiment:exp_123."),
    }),
    description: "Archive support-series automations that are not in the desired active id set.",
    options: withBaseOptions({
      desiredAutomationId: z
        .array(z.string().min(1))
        .optional()
        .describe("Automation id to keep in the support series. Repeat for multiple ids; omit to archive the whole series."),
    }),
    output: automationSupportSeriesReconcileResultSchema,
    async run(context) {
      const supportSeriesId = context.args.seriesId.trim();
      const supportSeriesTag = requireAutomationSupportSeriesTagFromId(
        supportSeriesId,
      );
      const desiredAutomationIds = [...new Set(
        context.options.desiredAutomationId ?? [],
      )].sort((left, right) => left.localeCompare(right));
      const result = await reconcileAutomationSupportSeries({
        desiredAutomationIds,
        supportSeriesTag,
        vaultRoot: context.options.vault,
      });

      return {
        vault: context.options.vault,
        supportSeriesId,
        supportSeriesTag,
        desiredAutomationIds,
        matchedCount: result.matchedCount,
        archivedCount: result.archivedCount,
        unchangedCount: result.unchangedCount,
        missingDesiredAutomationIds: result.missingDesiredAutomationIds,
        auditPath: result.auditPath,
      };
    },
  });

  automation.command("import-json", {
    args: z.object({}),
    description: "Create one automation or intentionally replace its full definition from an advanced JSON payload.",
    hint: "Prefer automation save for typed creation or intentional full replacement. Use automation edit or automation set-status for ordinary existing-record changes.",
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
      assertNoRawAutomationSupportSeriesTags(input.tags);
      const route = normalizeAutomationRouteFieldsForSave(input.route);
      if (automationStatusIsActive(input.status)) {
        assertAutomationRouteCanDeliver(route);
      }
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
