import * as z from "@murphai/contracts/zod-runtime";

import { hostedComputerSafeSelectorSchema } from "./computer-use.ts";

export const HOSTED_RUNTIME_PROVIDER_SETUP_TOOL_PATH =
  "/api/internal/hosted-execution/provider-setup/tool";

const providerSchema = z.string().trim().min(1).max(80);
const setupIdSchema = z.string().trim().min(1).max(200);
const runIdSchema = z.string().trim().min(1).max(200);
const selectorSchema = hostedComputerSafeSelectorSchema;

const beginRequestSchema = z.object({
  action: z.literal("begin"),
  provider: providerSchema,
}).strict();

const captureRequestSchema = z.object({
  action: z.literal("capture"),
  clientIdSelector: selectorSchema,
  clientSecretSelector: selectorSchema,
  provider: providerSchema,
  revealSecretSelector: selectorSchema.nullable().default(null),
  runId: runIdSchema,
  setupId: setupIdSchema,
  submitSelector: selectorSchema.nullable().default(null),
}).strict();

const prepareDeleteRequestSchema = z.object({
  action: z.literal("prepare_delete"),
  provider: providerSchema,
}).strict();

const deleteRequestSchema = z.object({
  action: z.literal("delete"),
  confirmSelector: selectorSchema.nullable().default(null),
  deleteSelector: selectorSchema,
  provider: providerSchema,
  runId: runIdSchema,
  setupId: setupIdSchema,
}).strict();

export const hostedRuntimeProviderSetupToolRequestSchema = z.discriminatedUnion(
  "action",
  [
    beginRequestSchema,
    captureRequestSchema,
    prepareDeleteRequestSchema,
    deleteRequestSchema,
  ],
);

export type HostedRuntimeProviderSetupToolRequest = z.infer<
  typeof hostedRuntimeProviderSetupToolRequestSchema
>;

export function parseHostedRuntimeProviderSetupToolRequest(
  value: unknown,
): HostedRuntimeProviderSetupToolRequest {
  return hostedRuntimeProviderSetupToolRequestSchema.parse(value);
}
