import { randomBytes } from "node:crypto";

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
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { sha256Hex, toIsoTimestamp } from "../primitives";

export const IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX = "hbds_imessage_";
export const IMESSAGE_MINI_APP_CREDENTIAL_TTL_MS = 24 * 60 * 60_000;

const IMESSAGE_MINI_APP_BEARER_TOKEN_PATTERN = /^hbds_imessage_[A-Za-z0-9_-]{43}$/u;
const IMESSAGE_MINI_APP_SESSION_ID_PREFIX = "dsa_imessage_";
const IMESSAGE_MINI_APP_SESSION_ID_SCOPE = "murph:imessage-mini-app:session:v1";
const IMESSAGE_MINI_APP_TOKEN_HASH_SCOPE = "murph:imessage-mini-app:v1";
const IMESSAGE_MINI_APP_ENROLLMENT_KEYS = new Set(["schemaVersion"]);
const IMESSAGE_MINI_APP_ACTION_CLOCK_SKEW_MS = 5 * 60_000;

export interface IMessageMiniAppSessionStore {
  authenticateAgentSessionByTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<HostedAgentSessionAuthResult>;
  revokeAgentSession(input: {
    expectedTokenHash: string;
    sessionId: string;
    now: string;
    reason: string;
    replacedBySessionId?: string | null;
  }): Promise<HostedAgentSessionRecord | null>;
}

export interface IMessageMiniAppCredentialResponse {
  schemaVersion: 1;
  credential: {
    token: string;
    expiresAt: string;
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

  async revoke(session: HostedAgentSessionRecord): Promise<{ schemaVersion: 1; revoked: true }> {
    const token = this.requireBearerToken();
    const revoked = await this.store.revokeAgentSession({
      expectedTokenHash: hashIMessageMiniAppBearerToken(token),
      sessionId: session.id,
      now: toIsoTimestamp(new Date()),
      reason: "imessage_app_request",
    });

    if (!revoked?.revokedAt) {
      throw miniAppAuthError(
        "IMESSAGE_MINI_APP_AUTH_INVALID",
        "Murph Messages authorization is invalid or revoked. Enable it again from the Murph app.",
      );
    }

    return { schemaVersion: 1, revoked: true };
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
    const parts = (this.request.headers.get("authorization") ?? "").trim().split(/\s+/u);
    return parts.length === 2 && parts[0]?.toLowerCase() === "bearer"
      ? parts[1] ?? null
      : null;
  }
}

async function mintIMessageMiniAppCredential(input: {
  memberId: string;
  prisma: Pick<Prisma.TransactionClient, "deviceAgentSession">;
}): Promise<IMessageMiniAppCredentialResponse> {
  const token = `${IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = toIsoTimestamp(new Date());
  const expiresAt = new Date(
    Date.parse(now) + IMESSAGE_MINI_APP_CREDENTIAL_TTL_MS,
  ).toISOString();
  const nowDate = new Date(now);
  const expiresAtDate = new Date(expiresAt);
  const sessionId = imessageMiniAppSessionId(input.memberId);
  const tokenHash = hashIMessageMiniAppBearerToken(token);
  const session = await input.prisma.deviceAgentSession.upsert({
    where: {
      id: sessionId,
    },
    create: {
      id: sessionId,
      userId: input.memberId,
      label: "Murph Messages mini app",
      tokenHash,
      createdAt: nowDate,
      updatedAt: nowDate,
      expiresAt: expiresAtDate,
      lastSeenAt: nowDate,
    },
    update: {
      userId: input.memberId,
      label: "Murph Messages mini app",
      tokenHash,
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
    },
  };
}

function imessageMiniAppSessionId(memberId: string): string {
  return `${IMESSAGE_MINI_APP_SESSION_ID_PREFIX}${sha256Hex(
    `${IMESSAGE_MINI_APP_SESSION_ID_SCOPE}\0${memberId}`,
  )}`;
}

function hashIMessageMiniAppBearerToken(token: string): string {
  return sha256Hex(`${IMESSAGE_MINI_APP_TOKEN_HASH_SCOPE}\0${token}`);
}

export function validateIMessageMiniAppEnrollmentBody(
  body: Record<string, unknown>,
): void {
  rejectUnknownFields(body, IMESSAGE_MINI_APP_ENROLLMENT_KEYS);

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
