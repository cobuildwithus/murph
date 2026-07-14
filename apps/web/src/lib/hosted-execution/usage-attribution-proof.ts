import { createHmac, timingSafeEqual } from "node:crypto";
import type { HostedRuntimeUsageAttribution } from "@murphai/hosted-execution/runtime-control";

export const HOSTED_USAGE_ATTRIBUTION_SIGNING_SECRET_ENV =
  "HOSTED_USAGE_ATTRIBUTION_SIGNING_SECRET";
export const HOSTED_USAGE_CAUSAL_ATTRIBUTION_ENABLED_ENV =
  "HOSTED_USAGE_CAUSAL_ATTRIBUTION_ENABLED";

export function isHostedUsageCausalAttributionEnabled(
  source: Record<string, string | undefined> = process.env,
): boolean {
  return source[HOSTED_USAGE_CAUSAL_ATTRIBUTION_ENABLED_ENV] === "1";
}

type UnsignedHostedRuntimeUsageAttribution =
  | Omit<Extract<HostedRuntimeUsageAttribution, { kind: "family" }>, "proof">
  | Omit<Extract<HostedRuntimeUsageAttribution, { kind: "period" }>, "proof">;

function requireSigningSecret(source: NodeJS.ProcessEnv): string {
  const secret = source[HOSTED_USAGE_ATTRIBUTION_SIGNING_SECRET_ENV]?.trim();
  if (!secret) {
    throw new Error(
      `${HOSTED_USAGE_ATTRIBUTION_SIGNING_SECRET_ENV} is required for causal usage attribution.`,
    );
  }
  return secret;
}

function stripProof(
  attribution: HostedRuntimeUsageAttribution,
): UnsignedHostedRuntimeUsageAttribution {
  if (attribution.kind === "family") {
    return {
      groupId: attribution.groupId,
      kind: attribution.kind,
    };
  }
  return {
    allowanceSource: attribution.allowanceSource,
    billingPlanCode: attribution.billingPlanCode,
    kind: attribution.kind,
    limitUsdMicros: attribution.limitUsdMicros,
    periodEnd: attribution.periodEnd,
    periodStart: attribution.periodStart,
  };
}

function serializeProofPayload(input: {
  attribution: UnsignedHostedRuntimeUsageAttribution;
  userId: string;
}): string {
  return JSON.stringify({
    attribution: input.attribution,
    schema: "hosted_usage_attribution_proof_v1",
    userId: input.userId,
  });
}

function createProof(input: {
  attribution: UnsignedHostedRuntimeUsageAttribution;
  source: NodeJS.ProcessEnv;
  userId: string;
}): string {
  return createHmac("sha256", requireSigningSecret(input.source))
    .update(serializeProofPayload(input), "utf8")
    .digest("base64url");
}

export function signHostedRuntimeUsageAttribution(input: {
  attribution: HostedRuntimeUsageAttribution;
  source?: NodeJS.ProcessEnv;
  userId: string;
}): HostedRuntimeUsageAttribution {
  const attribution = stripProof(input.attribution);
  return {
    ...attribution,
    proof: createProof({
      attribution,
      source: input.source ?? process.env,
      userId: input.userId,
    }),
  };
}

export function verifyHostedRuntimeUsageAttribution(input: {
  attribution: HostedRuntimeUsageAttribution;
  source?: NodeJS.ProcessEnv;
  userId: string;
}): UnsignedHostedRuntimeUsageAttribution {
  const providedProof = input.attribution.proof;
  if (!providedProof) {
    throw new TypeError("Hosted runtime usage attribution proof is required.");
  }
  const attribution = stripProof(input.attribution);
  const expectedProof = createProof({
    attribution,
    source: input.source ?? process.env,
    userId: input.userId,
  });
  const expected = Buffer.from(expectedProof, "utf8");
  const provided = Buffer.from(providedProof, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new TypeError("Hosted runtime usage attribution proof is invalid.");
  }
  return attribution;
}
