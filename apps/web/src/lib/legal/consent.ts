import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  type HostedConsentGrant,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";

export const HOSTED_TERMS_OF_SERVICE_VERSION = "2026-07-23";
export const HOSTED_PRIVACY_POLICY_VERSION = "2026-07-23";
export const HOSTED_CONSUMER_HEALTH_DATA_NOTICE_VERSION = "2026-07-23";
export const HOSTED_HEALTH_AI_SAFETY_DISCLOSURE_VERSION = "2026-07-23";

export const HOSTED_CONSENT_DOCUMENTS = [
  {
    id: "terms-of-service",
    title: "Murph Terms of Service",
    version: HOSTED_TERMS_OF_SERVICE_VERSION,
    href: "/legal/terms",
    pdfHref: "/legal/terms.pdf",
  },
  {
    id: "privacy-policy",
    title: "Murph Privacy Policy",
    version: HOSTED_PRIVACY_POLICY_VERSION,
    href: "/legal/privacy",
    pdfHref: "/legal/privacy.pdf",
  },
  {
    id: "consumer-health-data-notice",
    title: "Murph Consumer Health Data Notice",
    version: HOSTED_CONSUMER_HEALTH_DATA_NOTICE_VERSION,
    href: "/consumer-health-data-privacy-policy",
    pdfHref: "/legal/consumer-health-data-notice.pdf",
  },
  {
    id: "health-ai-safety-disclosure",
    title: "Murph Health AI Safety Disclosure",
    version: HOSTED_HEALTH_AI_SAFETY_DISCLOSURE_VERSION,
    href: "/legal/health-ai-safety-disclosure",
    pdfHref: "/legal/health-ai-safety-disclosure.pdf",
  },
] as const;

export const HOSTED_HEALTH_DATA_CONSENT_SCOPE = "launch.health-data" as const;

// Launch scopes preserve historical acceptance of the required documents. The
// legal agreement remains immutable, while health-data consent can be withdrawn
// for all future hosted processing without deleting the member account.
export const HOSTED_CONSENT_SCOPES = [
  {
    scope: "launch.legal",
    label: "Terms, privacy, and AI disclosure",
    revocable: false,
    documentIds: [
      "terms-of-service",
      "privacy-policy",
      "health-ai-safety-disclosure",
    ],
  },
  {
    scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
    label: "Health data notice and processing authorization",
    revocable: true,
    documentIds: [
      "consumer-health-data-notice",
    ],
  },
  {
    scope: "feature.health-ai",
    label: "Health AI processing consent",
    revocable: true,
    documentIds: [
      "privacy-policy",
      "consumer-health-data-notice",
      "health-ai-safety-disclosure",
    ],
  },
  {
    scope: "feature.health-commons-contribution",
    label: "Health Commons contribution consent",
    revocable: true,
    documentIds: [
      "terms-of-service",
      "privacy-policy",
      "consumer-health-data-notice",
    ],
  },
  {
    scope: "feature.connected-health-source",
    label: "Connected health source consent",
    revocable: true,
    documentIds: [
      "privacy-policy",
      "consumer-health-data-notice",
    ],
  },
] as const;

export type HostedConsentDocumentId = typeof HOSTED_CONSENT_DOCUMENTS[number]["id"];
export type HostedConsentScope = typeof HOSTED_CONSENT_SCOPES[number]["scope"];
export type HostedConsentLaunchScope = Extract<HostedConsentScope, `launch.${string}`>;
export type HostedConsentGrantStatus = "granted" | "revoked";
export type HostedConsentEventAction = "accepted" | "declined" | "granted" | "revoked";

const HOSTED_LAUNCH_SCOPES: readonly HostedConsentLaunchScope[] = ["launch.legal", "launch.health-data"];

export interface HostedConsentDocumentSnapshot {
  href: string;
  id: HostedConsentDocumentId;
  pdfHref: string;
  title: string;
  version: string;
}

export interface HostedConsentGrantSnapshot {
  documentVersions: Record<string, string>;
  grantedAt: string;
  lastEventId: string | null;
  revokedAt: string | null;
  scope: string;
  source: string;
  status: HostedConsentGrantStatus;
  updatedAt: string;
}

export interface HostedConsentScopeStatus {
  current: boolean;
  documents: HostedConsentDocumentSnapshot[];
  grant: HostedConsentGrantSnapshot | null;
  granted: boolean;
  label: string;
  missingDocuments: HostedConsentDocumentSnapshot[];
  revocable: boolean;
  scope: HostedConsentScope;
}

export interface HostedConsentLaunchScopeStatus {
  granted: boolean;
  missingDocuments: HostedConsentDocumentSnapshot[];
  scope: HostedConsentLaunchScope;
}

export interface HostedConsentStatus {
  documents: HostedConsentDocumentSnapshot[];
  generatedAt: string;
  launchGranted: boolean;
  launchScopes: HostedConsentLaunchScopeStatus[];
  ok: true;
  scopes: HostedConsentScopeStatus[];
  schema: "murph.hosted-consent-status.v1";
}

export interface HostedConsentAcceptRequest {
  acceptedDocumentVersions: Record<string, string>;
  scope: HostedConsentScope;
  source: string;
}

export interface HostedConsentRevokeRequest {
  scope: HostedConsentScope;
  source: string;
}

type HostedConsentPrismaClient = PrismaClient | Prisma.TransactionClient;

const DEFAULT_CONSENT_SOURCE = "hosted-web";
const MAX_CONSENT_DOCUMENT_ID_LENGTH = 80;
const MAX_CONSENT_DOCUMENT_VERSION_LENGTH = 40;
const MAX_CONSENT_SOURCE_LENGTH = 80;

export function parseHostedConsentAcceptRequest(
  body: Record<string, unknown>,
): HostedConsentAcceptRequest {
  const scope = parseHostedConsentScope(body.scope);
  const acceptedDocumentVersions = parseSubmittedDocumentVersions(
    body.acceptedDocumentVersions,
  );
  const normalizedDocumentVersions = normalizeSubmittedDocumentVersionsForScope({
    documentVersions: acceptedDocumentVersions,
    scope,
  });

  return {
    acceptedDocumentVersions: normalizedDocumentVersions,
    scope,
    source: normalizeConsentSource(body.source),
  };
}

export function parseHostedConsentRevokeRequest(
  body: Record<string, unknown>,
): HostedConsentRevokeRequest {
  const scope = parseHostedConsentScope(body.scope);
  const scopeDefinition = getHostedConsentScopeDefinition(scope);

  if (!scopeDefinition.revocable) {
    throw hostedOnboardingError({
      code: "CONSENT_SCOPE_NOT_REVOCABLE",
      httpStatus: 400,
      message: "The launch legal agreement cannot be revoked through this endpoint.",
    });
  }

  return {
    scope,
    source: normalizeConsentSource(body.source),
  };
}

export function buildCurrentHostedConsentDocumentVersions(
  scope: HostedConsentScope,
): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const document of getHostedConsentDocumentsForScope(scope)) {
    versions[document.id] = document.version;
  }
  return versions;
}

export async function readHostedConsentStatus(input: {
  memberId: string;
  now?: Date;
  prisma: HostedConsentPrismaClient;
}): Promise<HostedConsentStatus> {
  const grants = await input.prisma.hostedConsentGrant.findMany({
    orderBy: [{ scope: "asc" }],
    where: { memberId: input.memberId },
  });

  return buildHostedConsentStatus({
    grants: grants.map(projectHostedConsentGrant),
    now: input.now ?? new Date(),
  });
}

export async function recordHostedLaunchRequiredConsent(input: {
  acceptedDocumentVersions?: Record<string, string>;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  scope: HostedConsentLaunchScope;
  source?: string;
}): Promise<HostedConsentStatus> {
  return recordHostedConsentGrant({
    action: "accepted",
    acceptedDocumentVersions: input.acceptedDocumentVersions,
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
    scope: input.scope,
    source: input.source,
  });
}

export async function recordHostedLaunchConsentDecline(input: {
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  sessionId: string;
  source?: string;
}): Promise<HostedConsentLaunchScope[]> {
  const source = normalizeConsentSource(input.source);
  const now = input.now ?? new Date();

  return input.prisma.$transaction(async (tx) => {
    const grants = await tx.hostedConsentGrant.findMany({
      orderBy: [{ scope: "asc" }],
      where: { memberId: input.memberId },
    });
    const status = buildHostedConsentStatus({
      grants: grants.map(projectHostedConsentGrant),
      now,
    });
    const declinedScopes = status.launchScopes
      .filter((scope) => !scope.granted)
      .map((scope) => scope.scope);

    if (declinedScopes.length === 0) {
      return [];
    }

    await tx.hostedConsentEvent.createMany({
      data: declinedScopes.map((scope) => ({
        action: "declined",
        createdAt: now,
        documentVersionsJson: buildCurrentHostedConsentDocumentVersions(scope),
        id: buildHostedConsentDeclineEventId({
          memberId: input.memberId,
          scope,
          sessionId: input.sessionId,
        }),
        memberId: input.memberId,
        scope,
        source,
      })),
      skipDuplicates: true,
    });

    return declinedScopes;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function grantHostedOptionalFeatureConsent(input: {
  acceptedDocumentVersions?: Record<string, string>;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  scope: Exclude<HostedConsentScope, HostedConsentLaunchScope>;
  source?: string;
}): Promise<HostedConsentStatus> {
  return recordHostedConsentGrant({
    action: "granted",
    acceptedDocumentVersions: input.acceptedDocumentVersions,
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
    scope: input.scope,
    source: input.source,
  });
}

export async function recordHostedConsentGrant(input: {
  acceptedDocumentVersions?: Record<string, string>;
  action?: Extract<HostedConsentEventAction, "accepted" | "granted">;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  scope: HostedConsentScope;
  source?: string;
}): Promise<HostedConsentStatus> {
  const scopeDefinition = getHostedConsentScopeDefinition(input.scope);
  const source = normalizeConsentSource(input.source);
  const documentVersions = input.acceptedDocumentVersions
    ? normalizeSubmittedDocumentVersionsForScope({
        documentVersions: input.acceptedDocumentVersions,
        scope: input.scope,
      })
    : buildCurrentHostedConsentDocumentVersions(input.scope);

  const now = input.now ?? new Date();
  const action = input.action
    ?? (scopeDefinition.revocable ? "granted" : "accepted");

  await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const event = await tx.hostedConsentEvent.create({
      data: {
        action,
        createdAt: now,
        documentVersionsJson: documentVersions,
        id: generateHostedConsentEventId(),
        memberId: input.memberId,
        scope: input.scope,
        source,
      },
    });

    await tx.hostedConsentGrant.upsert({
      create: {
        createdAt: now,
        documentVersionsJson: documentVersions,
        grantedAt: now,
        lastEventId: event.id,
        memberId: input.memberId,
        scope: input.scope,
        source,
        status: "granted",
        updatedAt: now,
      },
      update: {
        documentVersionsJson: documentVersions,
        grantedAt: now,
        lastEventId: event.id,
        revokedAt: null,
        source,
        status: "granted",
        updatedAt: now,
      },
      where: {
        memberId_scope: {
          memberId: input.memberId,
          scope: input.scope,
        },
      },
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return readHostedConsentStatus({
    memberId: input.memberId,
    now,
    prisma: input.prisma,
  });
}

export async function revokeHostedConsentScope(input: {
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  scope: HostedConsentScope;
  source?: string;
}): Promise<HostedConsentStatus> {
  const scopeDefinition = getHostedConsentScopeDefinition(input.scope);
  if (!scopeDefinition.revocable) {
    throw hostedOnboardingError({
      code: "CONSENT_SCOPE_NOT_REVOCABLE",
      httpStatus: 400,
      message: "The launch legal agreement cannot be revoked through this endpoint.",
    });
  }

  const source = normalizeConsentSource(input.source);
  const now = input.now ?? new Date();

  await input.prisma.$transaction(async (tx) => {
    // Health-processing admissions use this same member row as their
    // serialization fence. Once this lock is acquired, every later admission
    // must observe the committed revocation before it can persist new work.
    await lockHostedMemberRow(tx, input.memberId);
    const existingGrant = await tx.hostedConsentGrant.findUnique({
      where: {
        memberId_scope: {
          memberId: input.memberId,
          scope: input.scope,
        },
      },
    });
    const documentVersions = existingGrant
      ? parseDocumentVersionsJson(existingGrant.documentVersionsJson)
      : buildCurrentHostedConsentDocumentVersions(input.scope);

    const event = await tx.hostedConsentEvent.create({
      data: {
        action: "revoked",
        createdAt: now,
        documentVersionsJson: documentVersions,
        id: generateHostedConsentEventId(),
        memberId: input.memberId,
        scope: input.scope,
        source,
      },
    });

    if (existingGrant) {
      await tx.hostedConsentGrant.update({
        data: {
          documentVersionsJson: documentVersions,
          grantedAt: existingGrant.grantedAt,
          lastEventId: event.id,
          revokedAt: now,
          source,
          status: "revoked",
          updatedAt: now,
        },
        where: {
          memberId_scope: {
            memberId: input.memberId,
            scope: input.scope,
          },
        },
      });
    }
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return readHostedConsentStatus({
    memberId: input.memberId,
    now,
    prisma: input.prisma,
  });
}

export async function assertHostedConsentScopeGranted(input: {
  memberId: string;
  prisma: HostedConsentPrismaClient;
  scope: HostedConsentScope;
}): Promise<void> {
  const status = await readHostedConsentStatus({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const scopeStatus = status.scopes.find((candidate) => candidate.scope === input.scope);

  if (!scopeStatus?.granted) {
    throw hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      details: {
        missingDocumentIds: scopeStatus?.missingDocuments.map((document) => document.id) ?? [],
        scope: input.scope,
      },
      httpStatus: 403,
      message: "Accept the current Murph legal consent before continuing.",
    });
  }
}

export async function assertHostedLaunchRequiredConsentGranted(input: {
  memberId: string;
  prisma: HostedConsentPrismaClient;
}): Promise<void> {
  const status = await readHostedConsentStatus({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!status.launchGranted) {
    const missingScopes = status.launchScopes
      .filter((s) => !s.granted)
      .map((s) => s.scope);
    throw hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      details: { missingScopes },
      httpStatus: 403,
      message: "Accept the current Murph legal consent before continuing.",
    });
  }
}

export async function assertHostedHistoricalLaunchConsentGranted(input: {
  memberId: string;
  prisma: HostedConsentPrismaClient;
}): Promise<void> {
  const status = await readHostedConsentStatus({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  const missingScopes = getMissingHistoricalLaunchConsentScopes(status);

  if (missingScopes.length > 0) {
    throw hostedOnboardingError({
      code: "HOSTED_CONSENT_REQUIRED",
      details: { missingScopes },
      httpStatus: 403,
      message: "Accept the Murph legal consent before continuing.",
    });
  }
}

export function hasHostedHistoricalLaunchConsent(
  status: HostedConsentStatus,
): boolean {
  return getMissingHistoricalLaunchConsentScopes(status).length === 0;
}

export type HostedHealthDataConsentState = HostedConsentGrantStatus | "missing";

export function resolveHostedHealthDataConsentState(
  grants: readonly { scope: string; status: string }[] | null | undefined,
): HostedHealthDataConsentState {
  const grant = grants?.find(
    (candidate) => candidate.scope === HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  );
  if (grant?.status === "granted" || grant?.status === "revoked") {
    return grant.status;
  }
  return "missing";
}

/**
 * Set-based form of the explicit-withdrawal rule. A missing historical grant
 * remains compatible with legacy members; only a persisted revocation denies
 * health-data processing.
 */
export function hostedHealthDataConsentNotRevokedWhere(): Prisma.HostedMemberWhereInput {
  return {
    consentGrants: {
      none: {
        scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
        status: "revoked",
      },
    },
  };
}

export async function readHostedHealthDataConsentState(input: {
  memberId: string;
  prisma: HostedConsentPrismaClient;
}): Promise<HostedHealthDataConsentState> {
  const grant = await input.prisma.hostedConsentGrant.findUnique({
    select: {
      scope: true,
      status: true,
    },
    where: {
      memberId_scope: {
        memberId: input.memberId,
        scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
      },
    },
  });

  return resolveHostedHealthDataConsentState(grant ? [grant] : []);
}

export function buildHostedConsentStatus(input: {
  grants: HostedConsentGrantSnapshot[];
  now: Date;
}): HostedConsentStatus {
  const grantsByScope = new Map(input.grants.map((grant) => [grant.scope, grant]));
  const scopes = HOSTED_CONSENT_SCOPES.map((scopeDefinition) => {
    const grant = grantsByScope.get(scopeDefinition.scope) ?? null;
    const documents = getHostedConsentDocumentsForScope(scopeDefinition.scope);
    const missingDocuments = getMissingConsentDocuments({
      documents,
      grant,
    });
    const current = missingDocuments.length === 0;

    return {
      current,
      documents,
      grant,
      granted: grant?.status === "granted" && current,
      label: scopeDefinition.label,
      missingDocuments,
      revocable: scopeDefinition.revocable,
      scope: scopeDefinition.scope,
    };
  });

  const launchScopes: HostedConsentLaunchScopeStatus[] = HOSTED_LAUNCH_SCOPES.map((launchScope) => {
    const scopeStatus = scopes.find((s) => s.scope === launchScope);
    return {
      granted: scopeStatus?.granted ?? false,
      missingDocuments: scopeStatus?.missingDocuments ?? getHostedConsentDocumentsForScope(launchScope),
      scope: launchScope,
    };
  });

  return {
    documents: HOSTED_CONSENT_DOCUMENTS.map(projectHostedConsentDocument),
    generatedAt: input.now.toISOString(),
    launchGranted: launchScopes.every((s) => s.granted),
    launchScopes,
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes,
  };
}

function getMissingHistoricalLaunchConsentScopes(
  status: HostedConsentStatus,
): HostedConsentLaunchScope[] {
  return HOSTED_LAUNCH_SCOPES.filter((launchScope) => {
    const scopeStatus = status.scopes.find((candidate) => (
      candidate.scope === launchScope
    ));
    return scopeStatus?.grant?.status !== "granted";
  });
}

function parseHostedConsentScope(value: unknown): HostedConsentScope {
  if (typeof value !== "string") {
    throw hostedOnboardingError({
      code: "CONSENT_SCOPE_REQUIRED",
      httpStatus: 400,
      message: "Consent scope is required.",
    });
  }

  const scope = HOSTED_CONSENT_SCOPES.find((candidate) => candidate.scope === value);
  if (!scope) {
    throw hostedOnboardingError({
      code: "CONSENT_SCOPE_UNSUPPORTED",
      httpStatus: 400,
      message: "Consent scope is not supported.",
    });
  }

  return scope.scope;
}

function getHostedConsentScopeDefinition(scope: HostedConsentScope) {
  return HOSTED_CONSENT_SCOPES.find((candidate) => candidate.scope === scope)
    ?? HOSTED_CONSENT_SCOPES[0];
}

function getHostedConsentDocumentsForScope(
  scope: HostedConsentScope,
): HostedConsentDocumentSnapshot[] {
  const scopeDefinition = getHostedConsentScopeDefinition(scope);
  return scopeDefinition.documentIds.map((documentId) => {
    const document = HOSTED_CONSENT_DOCUMENTS.find((candidate) => candidate.id === documentId);
    if (!document) {
      throw new Error(`Hosted consent document is not registered: ${documentId}`);
    }
    return projectHostedConsentDocument(document);
  });
}

function projectHostedConsentDocument(
  document: typeof HOSTED_CONSENT_DOCUMENTS[number],
): HostedConsentDocumentSnapshot {
  return {
    href: document.href,
    id: document.id,
    pdfHref: document.pdfHref,
    title: document.title,
    version: document.version,
  };
}

function parseSubmittedDocumentVersions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw hostedOnboardingError({
      code: "CONSENT_DOCUMENT_VERSIONS_REQUIRED",
      httpStatus: 400,
      message: "Accepted legal document versions are required.",
    });
  }

  const documentVersions: Record<string, string> = {};
  for (const [documentId, version] of Object.entries(value)) {
    if (documentId.length > MAX_CONSENT_DOCUMENT_ID_LENGTH) {
      throw hostedOnboardingError({
        code: "CONSENT_DOCUMENT_VERSIONS_INVALID",
        httpStatus: 400,
        message: "Accepted legal document versions are invalid.",
      });
    }
    if (typeof version === "string" && version.trim().length > 0) {
      const normalizedVersion = version.trim();
      if (normalizedVersion.length > MAX_CONSENT_DOCUMENT_VERSION_LENGTH) {
        throw hostedOnboardingError({
          code: "CONSENT_DOCUMENT_VERSIONS_INVALID",
          httpStatus: 400,
          message: "Accepted legal document versions are invalid.",
        });
      }
      documentVersions[documentId] = normalizedVersion;
    }
  }
  return documentVersions;
}

function normalizeSubmittedDocumentVersionsForScope(input: {
  documentVersions: Record<string, string>;
  scope: HostedConsentScope;
}): Record<string, string> {
  const expected = buildCurrentHostedConsentDocumentVersions(input.scope);
  const unknownDocumentIds = Object.keys(input.documentVersions)
    .filter((documentId) => !Object.prototype.hasOwnProperty.call(expected, documentId));

  if (unknownDocumentIds.length > 0) {
    throw hostedOnboardingError({
      code: "CONSENT_DOCUMENT_VERSIONS_INVALID",
      details: {
        scope: input.scope,
        unknownDocumentIds,
      },
      httpStatus: 400,
      message: "Accepted legal document versions are invalid.",
    });
  }

  const missingOrStale = Object.entries(expected)
    .filter(([documentId, expectedVersion]) => input.documentVersions[documentId] !== expectedVersion)
    .map(([documentId]) => documentId);

  if (missingOrStale.length > 0) {
    throw hostedOnboardingError({
      code: "CONSENT_DOCUMENT_VERSIONS_STALE",
      details: {
        missingOrStaleDocumentIds: missingOrStale,
        scope: input.scope,
      },
      httpStatus: 409,
      message: "Refresh the current Murph legal documents before accepting consent.",
    });
  }

  return expected;
}

function projectHostedConsentGrant(
  grant: HostedConsentGrant,
): HostedConsentGrantSnapshot {
  return {
    documentVersions: parseDocumentVersionsJson(grant.documentVersionsJson),
    grantedAt: grant.grantedAt.toISOString(),
    lastEventId: grant.lastEventId,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    scope: grant.scope,
    source: grant.source,
    status: grant.status === "revoked" ? "revoked" : "granted",
    updatedAt: grant.updatedAt.toISOString(),
  };
}

function parseDocumentVersionsJson(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const versions: Record<string, string> = {};
  for (const [documentId, version] of Object.entries(value)) {
    if (typeof version === "string") {
      versions[documentId] = version;
    }
  }
  return versions;
}

function getMissingConsentDocuments(input: {
  documents: HostedConsentDocumentSnapshot[];
  grant: HostedConsentGrantSnapshot | null;
}): HostedConsentDocumentSnapshot[] {
  if (!input.grant || input.grant.status !== "granted") {
    return input.documents;
  }

  return input.documents.filter(
    (document) => input.grant?.documentVersions[document.id] !== document.version,
  );
}

function normalizeConsentSource(value: unknown): string {
  return normalizeBoundedString({
    fallback: DEFAULT_CONSENT_SOURCE,
    maxLength: MAX_CONSENT_SOURCE_LENGTH,
    value,
  });
}

function normalizeBoundedString(input: {
  fallback: string;
  maxLength: number;
  value: unknown;
}): string {
  if (typeof input.value !== "string") {
    return input.fallback;
  }

  const normalized = input.value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return input.fallback;
  }

  return normalized.slice(0, input.maxLength);
}

function generateHostedConsentEventId(): string {
  return `hbce_${randomBytes(12).toString("base64url")}`;
}

function buildHostedConsentDeclineEventId(input: {
  memberId: string;
  scope: HostedConsentLaunchScope;
  sessionId: string;
}): string {
  const digest = createHash("sha256")
    .update("murph.hosted-consent-decline.v1")
    .update("\0")
    .update(input.memberId)
    .update("\0")
    .update(input.sessionId)
    .update("\0")
    .update(input.scope)
    .digest("base64url")
    .slice(0, 24);
  return `hbce_${digest}`;
}
