import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import { PrismaHostedWebInternalRequestNonceStore, type HostedWebInternalRequestNonceStore } from "../hosted-execution/internal-request-nonces";
import { deleteHostedLinqProductionCanaryAccountData } from "../hosted-privacy/account-data-service";
import { getPrisma } from "../prisma";
import { normalizeNullableString } from "../primitives";
import { hostedOnboardingError } from "./errors";
import { lookupHostedMemberIdentityByPhoneNumber } from "./hosted-member-identity-store";
import { resetHostedLinqFirstContactAdmissionForCanaryTx } from "./linq-first-contact-admission";
import { createHostedLinqParticipantContact } from "./linq-participant-contact";
import {
  readHostedLinqProductionCanaryPhoneNumber,
  type HostedLinqProductionCanaryEnvironment,
} from "./linq-production-canary";
import { LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE } from "./linq-production-canary-contract";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const githubKeys = createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`), {
  timeoutDuration: 5_000,
  cacheMaxAge: 600_000,
});

export type HostedLinqProductionCanaryResetResult = {
  accountDeleted: boolean;
  admissionBudgetCount: number;
  admissionDecisionCount: number;
  deliveryClaimCount: number;
};

export async function resetHostedLinqProductionCanary(input: {
  phoneNumber: string;
  prisma: PrismaClient;
  request: Request;
}): Promise<HostedLinqProductionCanaryResetResult> {
  const participantContact = createHostedLinqParticipantContact({
    kind: "phone",
    value: input.phoneNumber,
  });
  if (!participantContact) {
    throwHostedLinqProductionCanaryConfigurationError();
  }

  const admission = await input.prisma.$transaction((tx) =>
    resetHostedLinqFirstContactAdmissionForCanaryTx({
      participantContact,
      tx,
    })
  );
  const identity = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
    projection: "core",
  });
  if (identity) {
    await deleteHostedLinqProductionCanaryAccountData({
      memberId: identity.core.id,
      prisma: input.prisma,
      request: input.request,
    });
  }

  return {
    accountDeleted: identity !== null,
    ...admission,
  };
}

export async function requireHostedLinqProductionCanaryResetRequest(
  request: Request,
  source: HostedLinqProductionCanaryEnvironment = process.env,
  dependencies: { keyResolver?: JWTVerifyGetKey; nonceStore?: HostedWebInternalRequestNonceStore; now?: () => number } = {},
): Promise<string> {
  const phoneNumber = readHostedLinqProductionCanaryPhoneNumber(source);
  if (!phoneNumber) {
    throwHostedLinqProductionCanaryConfigurationError();
  }

  const providedSecret = readBearerToken(
    request.headers.get("authorization"),
  );
  if (!providedSecret || providedSecret.length > 16_384) throwUnauthorized();

  const now = dependencies.now ?? Date.now;
  const verified = await verifyCanaryToken(providedSecret, dependencies.keyResolver ?? githubKeys, now);

  if (request.method === "POST") {
    const url = new URL(request.url);
    const store = dependencies.nonceStore ?? new PrismaHostedWebInternalRequestNonceStore(getPrisma());
    const admitted = await store.consumeHostedCallbackRequestNonce({
      nonceHash: createHash("sha256").update(`${GITHUB_OIDC_ISSUER}\n${verified.jti}`).digest("hex"),
      userId: "github-actions:linq-production-canary",
      method: request.method,
      path: url.pathname,
      search: url.search,
      now: new Date(now()).toISOString(),
      expiresAt: verified.expiresAt,
    });
    if (!admitted) throwUnauthorized();
  }

  return phoneNumber;
}

async function verifyCanaryToken(token: string, keyResolver: JWTVerifyGetKey, now: () => number) {
  const { payload } = await jwtVerify(token, keyResolver, {
    algorithms: ["RS256"],
    issuer: GITHUB_OIDC_ISSUER,
    audience: LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE,
    requiredClaims: ["exp", "iat", "nbf", "jti"],
    clockTolerance: 5,
    currentDate: new Date(now()),
  }).catch(() => { throwUnauthorized(); });
  if (
    payload.aud !== LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE
    || payload.repository_owner !== "cobuildwithus"
    || payload.repository !== "cobuildwithus/murph"
    || payload.workflow_ref !== "cobuildwithus/murph/.github/workflows/linq-production-canary.yml@refs/heads/main"
    || payload.ref !== "refs/heads/main"
    // The job runs in the protected-branch `production` GitHub environment.
    || payload.environment !== "production"
    || payload.sub !== "repo:cobuildwithus/murph:environment:production"
    || (payload.event_name !== "schedule" && payload.event_name !== "workflow_dispatch")
    || typeof payload.jti !== "string" || !payload.jti.trim() || payload.jti.length > 256
    || typeof payload.iat !== "number" || payload.iat * 1_000 > now() + 5_000
    || typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp)
    // Do not extend expiry beyond the nonce retention boundary with clock skew.
    || payload.exp * 1_000 <= now() || !Number.isFinite(new Date(payload.exp * 1_000).getTime())
  ) throwUnauthorized();

  return { jti: payload.jti, expiresAt: new Date(payload.exp * 1_000).toISOString() };
}

function throwUnauthorized(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_PRODUCTION_CANARY_UNAUTHORIZED",
    httpStatus: 401,
    message: "Unauthorized production canary reset request.",
  });
}

function readBearerToken(value: string | null): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized?.startsWith("Bearer ")) {
    return null;
  }
  return normalizeNullableString(normalized.slice("Bearer ".length));
}

function throwHostedLinqProductionCanaryConfigurationError(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_PRODUCTION_CANARY_CONFIGURATION_REQUIRED",
    httpStatus: 503,
    message: "The production canary reset is not configured.",
  });
}
