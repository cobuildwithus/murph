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
  applicationRootSelector: selectorSchema,
  clientIdSelector: selectorSchema,
  clientSecretSelector: selectorSchema,
  ownershipMarkerSelector: selectorSchema,
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
  applicationRootSelector: selectorSchema,
  completionSelector: selectorSchema.nullable().default(null),
  confirmSelector: selectorSchema.nullable().default(null),
  deleteSelector: selectorSchema,
  ownershipMarkerSelector: selectorSchema,
  provider: providerSchema,
  runId: runIdSchema,
  setupId: setupIdSchema,
}).strict();

const confirmMissingRequestSchema = z.object({
  action: z.literal("confirm_missing"),
  applicationsRootSelector: selectorSchema,
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
    confirmMissingRequestSchema,
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
