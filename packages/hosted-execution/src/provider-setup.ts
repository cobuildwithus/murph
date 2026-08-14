import * as z from "@murphai/contracts/zod-runtime";

import { hostedComputerSafeSelectorSchema } from "./computer-use.ts";

export const HOSTED_RUNTIME_PROVIDER_SETUP_TOOL_PATH =
  "/api/internal/hosted-execution/provider-setup/tool";
export const HOSTED_RUNTIME_PROVIDER_SETUP_CONTINUATION_VALIDATE_PATH =
  "/api/internal/hosted-execution/provider-setup/continuation/validate";

const providerSchema = z.string().trim().min(1).max(80);
const setupIdSchema = z.string().trim().min(1).max(200);
const runIdSchema = z.string().trim().min(1).max(200);
const selectorSchema = hostedComputerSafeSelectorSchema;
const setupVersionSchema = z.number().int().positive();
const applicationNameSchema = z.string().trim().min(3).max(80);

export const hostedRuntimeProviderSetupContinuationValidateRequestSchema = z.object({
  provider: providerSchema,
  setupId: setupIdSchema,
  setupVersion: setupVersionSchema,
}).strict();

export const hostedRuntimeProviderSetupContinuationValidateResponseSchema = z.object({
  accepted: z.boolean(),
}).strict();

export type HostedRuntimeProviderSetupContinuationValidateRequest = z.infer<
  typeof hostedRuntimeProviderSetupContinuationValidateRequestSchema
>;

export function parseHostedRuntimeProviderSetupContinuationValidateRequest(
  value: unknown,
): HostedRuntimeProviderSetupContinuationValidateRequest {
  return hostedRuntimeProviderSetupContinuationValidateRequestSchema.parse(value);
}

const beginRequestSchema = z.object({
  action: z.literal("begin"),
  provider: providerSchema,
}).strict();

const captureRequestSchema = z.object({
  action: z.literal("capture"),
  applicationName: applicationNameSchema.nullable().default(null),
  applicationNameSelector: selectorSchema,
  clientIdSelector: selectorSchema,
  clientSecretSelector: selectorSchema,
  provider: providerSchema,
  revealSecretSelector: selectorSchema.nullable().default(null),
  runId: runIdSchema,
  setupId: setupIdSchema,
  submitSelector: selectorSchema,
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
