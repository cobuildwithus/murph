import { deviceSyncError } from "@murphai/device-syncd/public-ingress";

import type { AuthenticatedHostedUser } from "./device-sync/auth";
import {
  generateHostedAgentBearerToken,
  type HostedAgentSessionAuthResult,
  type HostedAgentSessionRecord,
} from "./device-sync/prisma-store";
import { sha256Hex, toIsoTimestamp } from "./device-sync/shared";

const HOSTED_AGENT_SESSION_TTL_MS = 24 * 60 * 60_000;

export interface HostedAgentSessionStore {
  authenticateAgentSessionByTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<HostedAgentSessionAuthResult>;
  createAgentSession(input: {
    user: HostedAgentUser;
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
  rotateAgentSession(input: {
    sessionId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord>;
}

export type HostedAgentUser = AuthenticatedHostedUser;

export interface HostedAgentSessionBearer {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  bearerToken: string;
}

interface HostedAgentSessionErrorMessages {
  required: string;
  expired: string;
  invalid: string;
}

export class HostedAgentSessionService {
  readonly request: Request;
  readonly store: HostedAgentSessionStore;
  readonly pairPath: string;
  readonly messages: Partial<HostedAgentSessionErrorMessages>;

  constructor(input: {
    request: Request;
    store: HostedAgentSessionStore;
    pairPath: string;
    messages?: Partial<HostedAgentSessionErrorMessages>;
  }) {
    this.request = input.request;
    this.store = input.store;
    this.pairPath = input.pairPath;
    this.messages = input.messages ?? {};
  }

  async requireAgentSession(): Promise<HostedAgentSessionRecord> {
    const header = this.request.headers.get("authorization") ?? "";
    const [scheme, rawToken] = header.split(/\s+/u);

    if (scheme?.toLowerCase() !== "bearer" || !rawToken) {
      throw createHostedAgentAuthRequiredError(this.pairPath, this.messages.required);
    }

    const auth = await this.store.authenticateAgentSessionByTokenHash(
      sha256Hex(rawToken),
      toIsoTimestamp(new Date()),
    );

    if (auth.status === "active" && auth.session) {
      return auth.session;
    }

    if (auth.status === "expired") {
      throw createHostedAgentAuthExpiredError(this.messages.expired);
    }

    if (auth.status === "revoked" || auth.status === "missing") {
      throw createHostedAgentAuthInvalidError(this.messages.invalid);
    }

    throw createHostedAgentAuthInvalidError(this.messages.invalid);
  }

  async createAgentSession(
    user: HostedAgentUser,
    label: string | null,
  ): Promise<{
    agent: { id: string; label: string | null; createdAt: string; expiresAt: string };
    token: string;
  }> {
    const token = generateHostedAgentBearerToken();
    const now = toIsoTimestamp(new Date());
    const session = await this.store.createAgentSession({
      user,
      label,
      tokenHash: token.tokenHash,
      now,
      expiresAt: resolveHostedAgentSessionExpiry(now),
    });

    return {
      agent: {
        id: session.id,
        label: session.label,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
      token: token.token,
    };
  }

  async revokeAgentSession(
    session: HostedAgentSessionRecord,
  ): Promise<{
    agentSession: {
      id: string;
      revokedAt: string;
      revokeReason: string | null;
    };
  }> {
    const now = toIsoTimestamp(new Date());
    const revoked = await this.store.revokeAgentSession({
      sessionId: session.id,
      now,
      reason: "agent_request",
    });

    if (!revoked?.revokedAt) {
      throw createHostedAgentAuthInvalidError(this.messages.invalid);
    }

    return {
      agentSession: {
        id: revoked.id,
        revokedAt: revoked.revokedAt,
        revokeReason: revoked.revokeReason,
      },
    };
  }

  async rotateAgentSession(
    session: HostedAgentSessionRecord,
    now: string,
  ): Promise<HostedAgentSessionBearer> {
    const token = generateHostedAgentBearerToken();
    const rotated = await this.store.rotateAgentSession({
      sessionId: session.id,
      tokenHash: token.tokenHash,
      now,
      expiresAt: resolveHostedAgentSessionExpiry(now),
    });

    return {
      id: rotated.id,
      label: rotated.label,
      createdAt: rotated.createdAt,
      expiresAt: rotated.expiresAt,
      bearerToken: token.token,
    };
  }
}

function createHostedAgentAuthRequiredError(pairPath: string, message?: string) {
  return deviceSyncError({
    code: "AGENT_AUTH_REQUIRED",
    message: message ?? `Hosted agent routes require a bearer token created by ${pairPath}.`,
    retryable: false,
    httpStatus: 401,
  });
}

function createHostedAgentAuthExpiredError(message?: string) {
  return deviceSyncError({
    code: "AGENT_AUTH_EXPIRED",
    message:
      message
      ?? "Hosted agent bearer token expired. Pair again or keep using the most recent bearer issued for this session.",
    retryable: false,
    httpStatus: 401,
  });
}

function createHostedAgentAuthInvalidError(message?: string) {
  return deviceSyncError({
    code: "AGENT_AUTH_INVALID",
    message: message ?? "Hosted agent bearer token is invalid or revoked.",
    retryable: false,
    httpStatus: 401,
  });
}

function resolveHostedAgentSessionExpiry(now: string): string {
  return new Date(Date.parse(now) + HOSTED_AGENT_SESSION_TTL_MS).toISOString();
}
