import { createHash, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  type MemberActionRequestV1,
  memberActionRequestV1Schema,
} from "@murphai/contracts";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import type {
  HostedAgentSessionAuthResult,
  HostedAgentSessionRecord,
} from "../device-sync/prisma-store";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "../hosted-onboarding/shared";
import {
  assertHostedHistoricalLaunchConsentGranted,
  assertHostedLaunchRequiredConsentGranted,
} from "../legal/consent";
import { sha256Hex, toIsoTimestamp } from "../primitives";

export const IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX = "hbds_imessage_";
export const IMESSAGE_MINI_APP_RENEWAL_BEARER_TOKEN_PREFIX = "hbds_imessage_renew_";
export const IMESSAGE_MINI_APP_CREDENTIAL_TTL_MS = 24 * 60 * 60_000;

const IMESSAGE_MINI_APP_BEARER_TOKEN_PATTERN = /^hbds_imessage_[A-Za-z0-9_-]{43}$/u;
const IMESSAGE_MINI_APP_RENEWAL_BEARER_TOKEN_PATTERN =
  /^hbds_imessage_renew_[A-Za-z0-9_-]{43}$/u;
const IMESSAGE_MINI_APP_SESSION_ID_PREFIX = "dsa_imessage_";
const IMESSAGE_MINI_APP_SESSION_ID_SCOPE = "murph:imessage-mini-app:session:v1";
const IMESSAGE_MINI_APP_TOKEN_HASH_SCOPE = "murph:imessage-mini-app:v1";
const IMESSAGE_MINI_APP_RENEWAL_TOKEN_HASH_SCOPE =
  "murph:imessage-mini-app:renewal:v1";
const IMESSAGE_MINI_APP_ACTION_DERIVATION_SCOPE =
  "murph:imessage-mini-app:action:v2";
const IMESSAGE_MINI_APP_ENROLLMENT_KEYS = new Set(["schemaVersion"]);
const IMESSAGE_MINI_APP_RENEWAL_KEYS = new Set(["schemaVersion"]);
const IMESSAGE_MINI_APP_ACTION_CLOCK_SKEW_MS = 5 * 60_000;
const IMESSAGE_MINI_APP_RENEWAL_ROTATION_LEEWAY_MS = 5 * 60_000;

export interface IMessageMiniAppSessionStore {
  authenticateAgentSessionByTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<HostedAgentSessionAuthResult>;
}

export interface IMessageMiniAppCredentialResponse {
  schemaVersion: 1;
  credential: {
    token: string;
    expiresAt: string;
    renewalToken: string;
  };
}

export async function issueIMessageMiniAppEnrollment(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<IMessageMiniAppCredentialResponse> {
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await lockHostedMemberSponsoredAccessRows(tx, input.memberId);
    await assertActiveHostedMemberAccessAllowed({
      memberId: input.memberId,
      prisma: tx,
    });
    await assertHostedLaunchRequiredConsentGranted({
      memberId: input.memberId,
      prisma: tx,
    });

    return mintIMessageMiniAppCredential({
      memberId: input.memberId,
      prisma: tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export class IMessageMiniAppService {
  readonly request: Request;
  readonly store: IMessageMiniAppSessionStore;

  constructor(input: { request: Request; store: IMessageMiniAppSessionStore }) {
    this.request = input.request;
    this.store = input.store;
  }

  async requireCredential(): Promise<HostedAgentSessionRecord> {
    const token = this.requireBearerToken();

    const auth = await this.store.authenticateAgentSessionByTokenHash(
      hashIMessageMiniAppBearerToken(token),
      toIsoTimestamp(new Date()),
    );

    if (auth.status === "active" && auth.session) {
      return auth.session;
    }

    if (auth.status === "expired") {
      throw miniAppAuthError(
        "IMESSAGE_MINI_APP_AUTH_EXPIRED",
        "Murph Messages authorization expired. Enable it again from the Murph app.",
      );
    }

    throw miniAppAuthError(
      "IMESSAGE_MINI_APP_AUTH_INVALID",
      "Murph Messages authorization is invalid or revoked. Enable it again from the Murph app.",
    );
  }

  private requireBearerToken(): string {
    const token = this.readBearerToken();

    if (!token) {
      throw miniAppAuthError(
        "IMESSAGE_MINI_APP_AUTH_REQUIRED",
        "Enable Murph Messages from the Murph app before continuing.",
      );
    }

    if (!IMESSAGE_MINI_APP_BEARER_TOKEN_PATTERN.test(token)) {
      throw miniAppAuthError(
        "IMESSAGE_MINI_APP_AUTH_INVALID",
        "Murph Messages authorization is invalid or revoked. Enable it again from the Murph app.",
      );
    }

    return token;
  }

  private readBearerToken(): string | null {
    return readBearerToken(this.request);
  }
}

async function mintIMessageMiniAppCredential(input: {
  memberId: string;
  prisma: Pick<Prisma.TransactionClient, "deviceAgentSession">;
}): Promise<IMessageMiniAppCredentialResponse> {
  const renewalToken = generateIMessageMiniAppRenewalToken();
  const now = toIsoTimestamp(new Date());
  const expiresAt = new Date(
    Date.parse(now) + IMESSAGE_MINI_APP_CREDENTIAL_TTL_MS,
  ).toISOString();
  const token = deriveIMessageMiniAppActionToken(renewalToken, expiresAt);
  const nowDate = new Date(now);
  const expiresAtDate = new Date(expiresAt);
  const sessionId = imessageMiniAppSessionId(input.memberId);
  const tokenHash = hashIMessageMiniAppBearerToken(token);
  const imessageRenewalTokenHash = hashIMessageMiniAppRenewalToken(renewalToken);
  const session = await input.prisma.deviceAgentSession.upsert({
    where: {
      id: sessionId,
    },
    create: {
      id: sessionId,
      userId: input.memberId,
      label: "Murph Messages mini app",
      tokenHash,
      imessageRenewalTokenHash,
      createdAt: nowDate,
      updatedAt: nowDate,
      expiresAt: expiresAtDate,
      lastSeenAt: nowDate,
    },
    update: {
      userId: input.memberId,
      label: "Murph Messages mini app",
      tokenHash,
      imessageRenewalTokenHash,
      createdAt: nowDate,
      updatedAt: nowDate,
      expiresAt: expiresAtDate,
      lastSeenAt: nowDate,
      revokedAt: null,
      revokeReason: null,
      replacedBySessionId: null,
    },
  });

  return {
    schemaVersion: 1,
    credential: {
      token,
      expiresAt: session.expiresAt.toISOString(),
      renewalToken,
    },
  };
}

export async function renewIMessageMiniAppCredential(input: {
  now?: Date;
  prisma: PrismaClient;
  request: Request;
}): Promise<IMessageMiniAppCredentialResponse> {
  const renewalToken = requireIMessageMiniAppRenewalToken(input.request);
  const renewalTokenHash = hashIMessageMiniAppRenewalToken(renewalToken);
  const candidate = await input.prisma.deviceAgentSession.findUnique({
    where: { imessageRenewalTokenHash: renewalTokenHash },
    select: { userId: true },
  });
  if (!candidate) {
    throw invalidIMessageMiniAppAuthorization();
  }

  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, candidate.userId);
    await lockHostedMemberSponsoredAccessRows(tx, candidate.userId);

    const session = await tx.deviceAgentSession.findUnique({
      where: { id: imessageMiniAppSessionId(candidate.userId) },
    });
    if (!session || !isCurrentIMessageMiniAppRenewal({
      renewalToken,
      renewalTokenHash,
      session,
    })) {
      throw invalidIMessageMiniAppAuthorization();
    }

    await assertActiveHostedMemberAccessAllowed({
      memberId: candidate.userId,
      prisma: tx,
    });
    await assertHostedHistoricalLaunchConsentGranted({
      memberId: candidate.userId,
      prisma: tx,
    });

    const now = toIsoTimestamp(input.now ?? new Date());
    const currentExpiresAt = session.expiresAt.toISOString();
    if (
      session.expiresAt.getTime()
      > Date.parse(now) + IMESSAGE_MINI_APP_RENEWAL_ROTATION_LEEWAY_MS
    ) {
      return credentialResponse({
        expiresAt: currentExpiresAt,
        renewalToken,
      });
    }

    const expiresAt = new Date(
      Date.parse(now) + IMESSAGE_MINI_APP_CREDENTIAL_TTL_MS,
    ).toISOString();
    const token = deriveIMessageMiniAppActionToken(renewalToken, expiresAt);
    const rotated = await tx.deviceAgentSession.updateMany({
      where: {
        id: session.id,
        tokenHash: session.tokenHash,
        imessageRenewalTokenHash: renewalTokenHash,
        revokedAt: null,
      },
      data: {
        tokenHash: hashIMessageMiniAppBearerToken(token),
        expiresAt: new Date(expiresAt),
        lastSeenAt: new Date(now),
        updatedAt: new Date(now),
      },
    });
    if (rotated.count !== 1) {
      throw invalidIMessageMiniAppAuthorization();
    }

    return {
      schemaVersion: 1,
      credential: {
        expiresAt,
        renewalToken,
        token,
      },
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function revokeIMessageMiniAppCredential(input: {
  prisma: PrismaClient;
  request: Request;
}): Promise<{ schemaVersion: 1; revoked: true }> {
  const credential = requireIMessageMiniAppLifecycleCredential(input.request);
  const now = toIsoTimestamp(new Date());

  const session = credential.kind === "action"
    ? await input.prisma.deviceAgentSession.findUnique({
        where: { tokenHash: hashIMessageMiniAppBearerToken(credential.token) },
      })
    : await input.prisma.deviceAgentSession.findUnique({
        where: {
          imessageRenewalTokenHash: hashIMessageMiniAppRenewalToken(credential.token),
        },
      });
  if (!session || session.id !== imessageMiniAppSessionId(session.userId)) {
    throw invalidIMessageMiniAppAuthorization();
  }

  const where = credential.kind === "action"
    ? {
        id: session.id,
        tokenHash: hashIMessageMiniAppBearerToken(credential.token),
        revokedAt: null,
      }
    : {
        id: session.id,
        tokenHash: hashIMessageMiniAppBearerToken(
          deriveIMessageMiniAppActionToken(
            credential.token,
            session.expiresAt.toISOString(),
          ),
        ),
        imessageRenewalTokenHash: hashIMessageMiniAppRenewalToken(credential.token),
        revokedAt: null,
      };
  const revoked = await input.prisma.deviceAgentSession.updateMany({
    where,
    data: {
      revokedAt: new Date(now),
      revokeReason: "imessage_app_request",
      updatedAt: new Date(now),
    },
  });
  if (revoked.count !== 1) {
    throw invalidIMessageMiniAppAuthorization();
  }

  return { schemaVersion: 1, revoked: true };
}

function credentialResponse(input: {
  expiresAt: string;
  renewalToken: string;
}): IMessageMiniAppCredentialResponse {
  return {
    schemaVersion: 1,
    credential: {
      expiresAt: input.expiresAt,
      renewalToken: input.renewalToken,
      token: deriveIMessageMiniAppActionToken(
        input.renewalToken,
        input.expiresAt,
      ),
    },
  };
}

function isCurrentIMessageMiniAppRenewal(input: {
  renewalToken: string;
  renewalTokenHash: string;
  session: {
    expiresAt: Date;
    imessageRenewalTokenHash: string | null;
    revokedAt: Date | null;
    tokenHash: string;
  };
}): boolean {
  if (
    input.session.revokedAt
    || input.session.imessageRenewalTokenHash !== input.renewalTokenHash
  ) {
    return false;
  }

  const expectedActionToken = deriveIMessageMiniAppActionToken(
    input.renewalToken,
    input.session.expiresAt.toISOString(),
  );
  return input.session.tokenHash === hashIMessageMiniAppBearerToken(expectedActionToken);
}

function imessageMiniAppSessionId(memberId: string): string {
  return `${IMESSAGE_MINI_APP_SESSION_ID_PREFIX}${sha256Hex(
    `${IMESSAGE_MINI_APP_SESSION_ID_SCOPE}\0${memberId}`,
  )}`;
}

function hashIMessageMiniAppBearerToken(token: string): string {
  return sha256Hex(`${IMESSAGE_MINI_APP_TOKEN_HASH_SCOPE}\0${token}`);
}

function generateIMessageMiniAppRenewalToken(): string {
  return `${IMESSAGE_MINI_APP_RENEWAL_BEARER_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

function deriveIMessageMiniAppActionToken(
  renewalToken: string,
  expiresAt: string,
): string {
  const digest = createHash("sha256")
    .update(`${IMESSAGE_MINI_APP_ACTION_DERIVATION_SCOPE}\0${renewalToken}\0${expiresAt}`)
    .digest("base64url");
  return `${IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX}${digest}`;
}

function hashIMessageMiniAppRenewalToken(token: string): string {
  return sha256Hex(`${IMESSAGE_MINI_APP_RENEWAL_TOKEN_HASH_SCOPE}\0${token}`);
}

function readBearerToken(request: Request): string | null {
  const parts = (request.headers.get("authorization") ?? "").trim().split(/\s+/u);
  return parts.length === 2 && parts[0]?.toLowerCase() === "bearer"
    ? parts[1] ?? null
    : null;
}

function requireIMessageMiniAppRenewalToken(request: Request): string {
  const token = readBearerToken(request);
  if (!token) {
    throw miniAppAuthError(
      "IMESSAGE_MINI_APP_AUTH_REQUIRED",
      "Enable Murph Messages from the Murph app before continuing.",
    );
  }
  if (!IMESSAGE_MINI_APP_RENEWAL_BEARER_TOKEN_PATTERN.test(token)) {
    throw invalidIMessageMiniAppAuthorization();
  }
  return token;
}

function requireIMessageMiniAppLifecycleCredential(
  request: Request,
): { kind: "action" | "renewal"; token: string } {
  const token = readBearerToken(request);
  if (!token) {
    throw miniAppAuthError(
      "IMESSAGE_MINI_APP_AUTH_REQUIRED",
      "Enable Murph Messages from the Murph app before continuing.",
    );
  }
  if (IMESSAGE_MINI_APP_BEARER_TOKEN_PATTERN.test(token)) {
    return { kind: "action", token };
  }
  if (IMESSAGE_MINI_APP_RENEWAL_BEARER_TOKEN_PATTERN.test(token)) {
    return { kind: "renewal", token };
  }
  throw invalidIMessageMiniAppAuthorization();
}

function invalidIMessageMiniAppAuthorization() {
  return miniAppAuthError(
    "IMESSAGE_MINI_APP_AUTH_INVALID",
    "Murph Messages authorization is invalid or revoked. Enable it again from the Murph app.",
  );
}

export function validateIMessageMiniAppEnrollmentBody(
  body: Record<string, unknown>,
): void {
  rejectUnknownFields(body, IMESSAGE_MINI_APP_ENROLLMENT_KEYS);

  if (body.schemaVersion !== 1) {
    throw miniAppRequestInvalid("schemaVersion must be 1.");
  }
}

export function validateIMessageMiniAppRenewalBody(
  body: Record<string, unknown>,
): void {
  rejectUnknownFields(body, IMESSAGE_MINI_APP_RENEWAL_KEYS);

  if (body.schemaVersion !== 1) {
    throw miniAppRequestInvalid("schemaVersion must be 1.");
  }
}

export function validateIMessageMiniAppMemberAction(
  body: Record<string, unknown>,
  now = new Date(),
): MemberActionRequestV1 {
  const parsed = memberActionRequestV1Schema.safeParse(body);
  if (!parsed.success) {
    throw miniAppRequestInvalid("Member action request is invalid.");
  }

  const requestedAt = Date.parse(parsed.data.requestedAt);
  if (
    requestedAt < now.getTime() - IMESSAGE_MINI_APP_CREDENTIAL_TTL_MS
    || requestedAt > now.getTime() + IMESSAGE_MINI_APP_ACTION_CLOCK_SKEW_MS
  ) {
    throw miniAppRequestInvalid("Member action request timestamp is outside the accepted window.");
  }

  return parsed.data;
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw miniAppRequestInvalid("Request contains unsupported fields.");
  }
}

function miniAppRequestInvalid(message: string) {
  return deviceSyncError({
    code: "IMESSAGE_MINI_APP_REQUEST_INVALID",
    message,
    retryable: false,
    httpStatus: 400,
  });
}

function miniAppAuthError(code: string, message: string) {
  return deviceSyncError({
    code,
    message,
    retryable: false,
    httpStatus: 401,
  });
}
