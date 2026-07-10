import { randomBytes } from "node:crypto";

import { deviceSyncError } from "@murphai/device-syncd/errors";

import type {
  HostedAgentSessionAuthResult,
  HostedAgentSessionRecord,
} from "../device-sync/prisma-store";
import { sha256Hex, toIsoTimestamp } from "../primitives";

export const IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX = "hbds_imessage_";
export const IMESSAGE_MINI_APP_CARD_ID = "privy-proof-v1";
export const IMESSAGE_MINI_APP_CREDENTIAL_TTL_MS = 24 * 60 * 60_000;

const IMESSAGE_MINI_APP_BEARER_TOKEN_PATTERN = /^hbds_imessage_[A-Za-z0-9_-]{43}$/u;
const IMESSAGE_MINI_APP_PROOF_CHOICES = ["morning", "afternoon", "evening"] as const;
const IMESSAGE_MINI_APP_PROOF_ACTION_KEYS = new Set([
  "schemaVersion",
  "cardId",
  "choice",
  "idempotencyKey",
]);
const IMESSAGE_MINI_APP_ENROLLMENT_KEYS = new Set(["schemaVersion"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type IMessageMiniAppProofChoice = typeof IMESSAGE_MINI_APP_PROOF_CHOICES[number];

export interface IMessageMiniAppSessionStore {
  authenticateAgentSessionByTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<HostedAgentSessionAuthResult>;
  createAgentSession(input: {
    user: { id: string };
    label?: string | null;
    tokenHash: string;
    now?: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord>;
  revokeAgentSession(input: {
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

export interface IMessageMiniAppProofAction {
  schemaVersion: 1;
  cardId: typeof IMESSAGE_MINI_APP_CARD_ID;
  choice: IMessageMiniAppProofChoice;
  idempotencyKey: string;
}

export class IMessageMiniAppService {
  readonly request: Request;
  readonly store: IMessageMiniAppSessionStore;

  constructor(input: { request: Request; store: IMessageMiniAppSessionStore }) {
    this.request = input.request;
    this.store = input.store;
  }

  async enroll(memberId: string): Promise<IMessageMiniAppCredentialResponse> {
    const token = `${IMESSAGE_MINI_APP_BEARER_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const now = toIsoTimestamp(new Date());
    const expiresAt = new Date(
      Date.parse(now) + IMESSAGE_MINI_APP_CREDENTIAL_TTL_MS,
    ).toISOString();
    const session = await this.store.createAgentSession({
      user: { id: memberId },
      label: "Murph Messages mini app",
      tokenHash: sha256Hex(token),
      now,
      expiresAt,
    });

    return {
      schemaVersion: 1,
      credential: {
        token,
        expiresAt: session.expiresAt,
      },
    };
  }

  async requireCredential(): Promise<HostedAgentSessionRecord> {
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

    const auth = await this.store.authenticateAgentSessionByTokenHash(
      sha256Hex(token),
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
    const revoked = await this.store.revokeAgentSession({
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

  private readBearerToken(): string | null {
    const parts = (this.request.headers.get("authorization") ?? "").trim().split(/\s+/u);
    return parts.length === 2 && parts[0]?.toLowerCase() === "bearer"
      ? parts[1] ?? null
      : null;
  }
}

export function validateIMessageMiniAppEnrollmentBody(
  body: Record<string, unknown>,
): void {
  rejectUnknownFields(body, IMESSAGE_MINI_APP_ENROLLMENT_KEYS);

  if (body.schemaVersion !== 1) {
    throw miniAppRequestInvalid("schemaVersion must be 1.");
  }
}

export function validateIMessageMiniAppProofAction(
  body: Record<string, unknown>,
): IMessageMiniAppProofAction {
  rejectUnknownFields(body, IMESSAGE_MINI_APP_PROOF_ACTION_KEYS);

  if (body.schemaVersion !== 1) {
    throw miniAppRequestInvalid("schemaVersion must be 1.");
  }
  if (body.cardId !== IMESSAGE_MINI_APP_CARD_ID) {
    throw miniAppRequestInvalid("cardId is not supported.");
  }
  if (
    !isIMessageMiniAppProofChoice(body.choice)
  ) {
    throw miniAppRequestInvalid("choice is not supported.");
  }
  if (typeof body.idempotencyKey !== "string" || !UUID_PATTERN.test(body.idempotencyKey)) {
    throw miniAppRequestInvalid("idempotencyKey must be a UUID.");
  }

  return {
    schemaVersion: 1,
    cardId: IMESSAGE_MINI_APP_CARD_ID,
    choice: body.choice,
    idempotencyKey: body.idempotencyKey,
  };
}

function isIMessageMiniAppProofChoice(
  value: unknown,
): value is IMessageMiniAppProofChoice {
  return typeof value === "string"
    && IMESSAGE_MINI_APP_PROOF_CHOICES.some((choice) => choice === value);
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
