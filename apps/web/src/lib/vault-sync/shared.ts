import crypto from "node:crypto";

import type {
  HostedVaultSyncPayload,
  HostedVaultSyncSession,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type { HostedExecutionRunnerVaultSyncImport } from "@murphai/hosted-execution";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";

export const HOSTED_VAULT_SYNC_PAYLOAD_SCHEMA = "murph.hosted-vault-sync-payload.v1";
export const HOSTED_VAULT_SYNC_SESSION_TTL_MS = 10 * 60 * 1000;
export const HOSTED_VAULT_SYNC_MAX_BUNDLE_BASE64_LENGTH = 32 * 1024 * 1024;
export const HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES = [
  "committed",
  "committed_with_conflicts",
  "expired",
  "failed",
  "revoked",
] as const satisfies readonly HostedVaultSyncSessionStatus[];

const HOSTED_VAULT_SYNC_PAYLOAD_FIELD = "hosted-vault-sync.payload";
const HOSTED_VAULT_SYNC_PAIRING_CODE_LENGTH = 10;
const HOSTED_VAULT_SYNC_PAIRING_CODE_BYTES = 10;
const HOSTED_VAULT_SYNC_AGENT_TOKEN_BYTES = 32;

type VaultSyncClient = PrismaClient | Prisma.TransactionClient;

export type HostedVaultSyncSessionStatus =
  | "pending"
  | "exchanged"
  | "uploaded"
  | "queued"
  | "committed"
  | "committed_with_conflicts"
  | "failed"
  | "expired"
  | "revoked";

export interface HostedVaultSyncSessionView {
  agentCommand: string | null;
  createdAt: string;
  expiresAt: string;
  id: string;
  localManifestHash: string | null;
  queuedIngressEventId: string | null;
  sourceVaultId: string | null;
  sourceVaultTitle: string | null;
  status: HostedVaultSyncSessionStatus;
}

export function generateHostedVaultSyncSessionId(): string {
  return `vsi_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function generateHostedVaultSyncPairingCode(): string {
  let code = "";
  while (code.length < HOSTED_VAULT_SYNC_PAIRING_CODE_LENGTH) {
    code += crypto.randomBytes(HOSTED_VAULT_SYNC_PAIRING_CODE_BYTES)
      .toString("base64url")
      .replace(/[^a-z0-9]/giu, "");
  }
  const normalized = code.slice(0, HOSTED_VAULT_SYNC_PAIRING_CODE_LENGTH).toUpperCase();
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

export function normalizeHostedVaultSyncPairingCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

export function generateHostedVaultSyncAgentToken(): string {
  return `vst_${crypto.randomBytes(HOSTED_VAULT_SYNC_AGENT_TOKEN_BYTES).toString("base64url")}`;
}

export function hashHostedVaultSyncSecret(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildHostedVaultSyncAgentCommand(input: {
  appBaseUrl?: string | null;
  pairingCode: string;
}): string {
  const host = input.appBaseUrl ? ` --host ${shellQuote(input.appBaseUrl)}` : "";
  return `murph sync push --session ${shellQuote(input.pairingCode)}${host}`;
}

export function projectHostedVaultSyncSessionView(input: {
  appBaseUrl?: string | null;
  pairingCode?: string | null;
  session: Pick<HostedVaultSyncSession,
    | "createdAt"
    | "expiresAt"
    | "id"
    | "localManifestHash"
    | "queuedIngressEventId"
    | "revokedAt"
    | "sourceVaultId"
    | "sourceVaultTitle"
    | "status"
  >;
  now?: Date;
}): HostedVaultSyncSessionView {
  const now = input.now ?? new Date();
  const status = normalizeHostedVaultSyncSessionStatus(input.session, now);
  return {
    agentCommand: input.pairingCode && status === "pending"
      ? buildHostedVaultSyncAgentCommand({
          appBaseUrl: input.appBaseUrl,
          pairingCode: input.pairingCode,
        })
      : null,
    createdAt: input.session.createdAt.toISOString(),
    expiresAt: input.session.expiresAt.toISOString(),
    id: input.session.id,
    localManifestHash: input.session.localManifestHash,
    queuedIngressEventId: input.session.queuedIngressEventId,
    sourceVaultId: input.session.sourceVaultId,
    sourceVaultTitle: input.session.sourceVaultTitle,
    status,
  };
}

export function normalizeHostedVaultSyncSessionStatus(
  session: Pick<HostedVaultSyncSession, "expiresAt" | "revokedAt" | "status">,
  now = new Date(),
): HostedVaultSyncSessionStatus {
  if (session.revokedAt) {
    return "revoked";
  }
  const terminalOrRunnerOwnedStatus = new Set<string>([
    "queued",
    "committed",
    "committed_with_conflicts",
    "failed",
  ]);
  if (session.expiresAt <= now && !terminalOrRunnerOwnedStatus.has(session.status)) {
    return "expired";
  }
  return session.status as HostedVaultSyncSessionStatus;
}

export async function requireHostedVaultSyncAgentSession(input: {
  request: Request;
  sessionId: string;
  prisma?: VaultSyncClient;
}): Promise<HostedVaultSyncSession> {
  const token = readBearerToken(input.request);
  const prisma = input.prisma ?? getPrisma();
  const session = await prisma.hostedVaultSyncSession.findUnique({
    where: { id: input.sessionId },
  });
  const tokenHash = hashHostedVaultSyncSecret(token);
  if (
    !session
    || !session.agentTokenHash
    || !hostedVaultSyncSecretHashesEqual(session.agentTokenHash, tokenHash)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_SESSION_NOT_FOUND",
      httpStatus: 404,
      message: "That vault sync session is not available.",
    });
  }
  if (session.revokedAt || session.expiresAt <= new Date()) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_SESSION_EXPIRED",
      httpStatus: 410,
      message: "That vault sync session expired. Start a new sync from Settings.",
    });
  }
  return session;
}

function hostedVaultSyncSecretHashesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export async function upsertHostedVaultSyncPayload(input: {
  memberId: string;
  payload: HostedExecutionRunnerVaultSyncImport;
  prisma: VaultSyncClient;
  sessionId: string;
}): Promise<void> {
  const payloadEncrypted = encryptHostedWebNullableString({
    field: HOSTED_VAULT_SYNC_PAYLOAD_FIELD,
    memberId: input.memberId,
    value: JSON.stringify(input.payload),
  });
  if (!payloadEncrypted) {
    throw new TypeError("Hosted vault sync payload must not be empty.");
  }
  await input.prisma.hostedVaultSyncPayload.upsert({
    where: { sessionId: input.sessionId },
    create: {
      payloadEncrypted,
      payloadSchema: HOSTED_VAULT_SYNC_PAYLOAD_SCHEMA,
      sessionId: input.sessionId,
      memberId: input.memberId,
    },
    update: {
      payloadEncrypted,
      payloadSchema: HOSTED_VAULT_SYNC_PAYLOAD_SCHEMA,
    },
  });
}

export async function deleteHostedVaultSyncPayload(input: {
  memberId?: string | null;
  prisma: VaultSyncClient;
  sessionId: string;
}): Promise<void> {
  await input.prisma.hostedVaultSyncPayload.deleteMany({
    where: {
      sessionId: input.sessionId,
      ...(input.memberId ? { memberId: input.memberId } : {}),
    },
  });
}

export function isHostedVaultSyncPayloadTerminalStatus(status: string): boolean {
  return (HOSTED_VAULT_SYNC_PAYLOAD_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function projectHostedVaultSyncPayload(
  record: Pick<HostedVaultSyncPayload, "memberId" | "payloadEncrypted" | "payloadSchema" | "sessionId">,
): HostedExecutionRunnerVaultSyncImport {
  if (record.payloadSchema !== HOSTED_VAULT_SYNC_PAYLOAD_SCHEMA) {
    throw new TypeError("Hosted vault sync payload schema is invalid.");
  }
  const text = decryptHostedWebNullableString({
    field: HOSTED_VAULT_SYNC_PAYLOAD_FIELD,
    memberId: record.memberId,
    value: record.payloadEncrypted,
  });
  if (!text) {
    throw new TypeError("Hosted vault sync payload ciphertext must decrypt to an import payload.");
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted vault sync payload must be an object.");
  }
  const payload = value as Record<string, unknown>;
  return {
    bundleBase64: requireString(payload.bundleBase64, "bundleBase64"),
    sessionId: requireString(payload.sessionId, "sessionId"),
    ...(payload.sourceSchemaVersion === undefined
      ? {}
      : {
          sourceSchemaVersion: requireNullableString(
            payload.sourceSchemaVersion,
            "sourceSchemaVersion",
          ),
        }),
  };
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/iu.exec(authorization.trim());
  if (!match?.[1]) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SYNC_AUTH_REQUIRED",
      httpStatus: 401,
      message: "A vault sync session token is required.",
    });
  }
  return match[1];
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Hosted vault sync payload ${label} must be a non-empty string.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value, label);
}

function shellQuote(value: string): string {
  if (/^[a-z0-9_./:=-]+$/iu.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
