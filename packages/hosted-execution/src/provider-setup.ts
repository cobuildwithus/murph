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
export const HOSTED_PROVIDER_SETUP_APPLICATION_NAME_FIRST_WORDS = [
  "Amber",
  "Azure",
  "Brisk",
  "Cobalt",
  "Coral",
  "Golden",
  "Indigo",
  "Lunar",
  "Misty",
  "Quiet",
  "Silver",
  "Solar",
  "Swift",
  "Verdant",
  "Violet",
  "Warm",
] as const;
export const HOSTED_PROVIDER_SETUP_APPLICATION_NAME_SECOND_WORDS = [
  "Brook",
  "Canyon",
  "Cedar",
  "Comet",
  "Creek",
  "Dune",
  "Fern",
  "Grove",
  "Harbor",
  "Meadow",
  "Ridge",
  "River",
  "Summit",
  "Trail",
  "Vale",
  "Willow",
] as const;
const applicationNameBasePattern = new RegExp(
  `^(?:${HOSTED_PROVIDER_SETUP_APPLICATION_NAME_FIRST_WORDS.join("|")}) `
    + `(?:${HOSTED_PROVIDER_SETUP_APPLICATION_NAME_SECOND_WORDS.join("|")})$`,
  "u",
);
const applicationNamePattern = new RegExp(
  `^(?:${HOSTED_PROVIDER_SETUP_APPLICATION_NAME_FIRST_WORDS.join("|")}) `
    + `(?:${HOSTED_PROVIDER_SETUP_APPLICATION_NAME_SECOND_WORDS.join("|")}) [0-9]{6}$`,
  "u",
);
const applicationNameSchema = z.string().trim().regex(applicationNamePattern);
const applicationNameProposalSchema = z.string().trim().refine(
  (value) => applicationNameBasePattern.test(value) || applicationNamePattern.test(value),
);

export function normalizeHostedProviderSetupApplicationName(
  value: string,
): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return applicationNameSchema.safeParse(normalized).success ? normalized : null;
}

export function normalizeHostedProviderSetupApplicationNameProposal(
  value: string,
): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return applicationNameProposalSchema.safeParse(normalized).success
    ? normalized.split(" ").slice(0, 2).join(" ")
    : null;
}

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
  applicationName: applicationNameProposalSchema.nullable().default(null),
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
  clientIdSelector: selectorSchema,
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
