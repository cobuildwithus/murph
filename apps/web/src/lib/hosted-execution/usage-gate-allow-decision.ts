import {
  buildHostedAiUsageAllowDecisionBody,
  signHostedAiUsageAllowDecision,
  type HostedAiUsageAllowDecision,
} from "@murphai/hosted-execution/runtime-control";

const HOSTED_AI_USAGE_ALLOW_DECISION_TTL_MS = 30_000;
const DEFAULT_HOSTED_AI_USAGE_ALLOW_DECISION_KEY_ID = "v1";

type EnvSource = Readonly<Record<string, string | undefined>>;

export async function createHostedAiUsageAllowDecision(input: {
  memberId: string;
  now?: Date;
  source?: EnvSource;
}): Promise<HostedAiUsageAllowDecision | null> {
  const environment = readHostedAiUsageAllowDecisionSigningEnvironment(input.source);
  if (!environment) {
    return null;
  }

  const issuedAt = input.now ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + HOSTED_AI_USAGE_ALLOW_DECISION_TTL_MS);
  return await signHostedAiUsageAllowDecision({
    body: buildHostedAiUsageAllowDecisionBody({
      expiresAt,
      issuedAt,
      nonce: createHostedAiUsageAllowDecisionNonce(),
      userId: input.memberId,
    }),
    keyId: environment.keyId,
    secret: environment.secret,
  });
}

function readHostedAiUsageAllowDecisionSigningEnvironment(
  source: EnvSource = process.env,
): { keyId: string; secret: string } | null {
  const secret = normalizeOptionalString(
    source.HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_SECRET,
  );
  if (!secret) {
    return null;
  }

  return {
    keyId:
      normalizeOptionalString(source.HOSTED_AI_USAGE_GATE_ALLOW_SIGNING_KEY_ID)
      ?? DEFAULT_HOSTED_AI_USAGE_ALLOW_DECISION_KEY_ID,
    secret,
  };
}

function createHostedAiUsageAllowDecisionNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
