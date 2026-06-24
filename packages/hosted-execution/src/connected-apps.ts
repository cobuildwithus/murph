import { z } from "zod";

export const HOSTED_CONNECTED_APPS_PATH = "/api/internal/connected-apps";

export const hostedConnectedAppsToolkitSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u);

export const hostedConnectedAppsAliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(64);

export const hostedConnectedAppsAccountSelectorSchema = z
  .string()
  .trim()
  .min(1)
  .max(256);

export const hostedConnectedAppsToolSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);

const hostedConnectedAppsListInputSchema = z
  .object({
    action: z.literal("list"),
    toolkit: hostedConnectedAppsToolkitSchema.optional(),
  })
  .strict();

const hostedConnectedAppsConnectInputSchema = z
  .object({
    action: z.literal("connect"),
    alias: hostedConnectedAppsAliasSchema.optional(),
    toolkit: hostedConnectedAppsToolkitSchema,
  })
  .strict();

const hostedConnectedAppsRenameInputSchema = z
  .object({
    account: hostedConnectedAppsAccountSelectorSchema,
    action: z.literal("rename"),
    alias: hostedConnectedAppsAliasSchema,
  })
  .strict();

const hostedConnectedAppsDisconnectInputSchema = z
  .object({
    account: hostedConnectedAppsAccountSelectorSchema,
    action: z.literal("disconnect"),
  })
  .strict();

export const hostedConnectedAppsManageInputSchema = z.discriminatedUnion("action", [
  hostedConnectedAppsListInputSchema,
  hostedConnectedAppsConnectInputSchema,
  hostedConnectedAppsRenameInputSchema,
  hostedConnectedAppsDisconnectInputSchema,
]);

export const hostedConnectedAppsSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    toolkits: z.array(hostedConnectedAppsToolkitSchema).min(1).max(16).optional(),
  })
  .strict();

export const hostedConnectedAppsExecuteInputSchema = z
  .object({
    account: hostedConnectedAppsAccountSelectorSchema.optional(),
    arguments: z.record(z.string(), z.unknown()).default({}),
    toolSlug: hostedConnectedAppsToolSlugSchema,
    userConfirmed: z.literal(true).optional(),
  })
  .strict();

export const hostedConnectedAppsRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      input: hostedConnectedAppsManageInputSchema,
      operation: z.literal("manage"),
    })
    .strict(),
  z
    .object({
      input: hostedConnectedAppsSearchInputSchema,
      operation: z.literal("search"),
    })
    .strict(),
  z
    .object({
      input: hostedConnectedAppsExecuteInputSchema,
      operation: z.literal("execute"),
    })
    .strict(),
]);

export const hostedConnectedAppsResponseSchema = z
  .object({
    result: z.unknown(),
  })
  .strict();

export type HostedConnectedAppsManageInput = z.infer<
  typeof hostedConnectedAppsManageInputSchema
>;
export type HostedConnectedAppsSearchInput = z.infer<
  typeof hostedConnectedAppsSearchInputSchema
>;
export type HostedConnectedAppsExecuteInput = z.infer<
  typeof hostedConnectedAppsExecuteInputSchema
>;
export type HostedConnectedAppsRequest = z.infer<typeof hostedConnectedAppsRequestSchema>;
export type HostedConnectedAppsResponse = z.infer<typeof hostedConnectedAppsResponseSchema>;
