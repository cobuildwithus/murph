import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { getHostedCryptoDomainForLane } from "@murphai/runtime-state";
import type { Prisma } from "@prisma/client";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { unwrapHostedDomainRootForWeb } from "../hosted-crypto/domain-root-store";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import {
  requireActiveHostedAppSessionFromRequest,
  type HostedAppSession,
} from "../hosted-onboarding/app-session";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { getPrisma } from "../prisma";
import {
  claimClinicalRecordConnectIntentForStart,
  completeClinicalRecordConnectIntent,
  releaseClinicalRecordConnectIntentStart,
} from "./connect-intents";
import { clinicalRecordsError } from "./errors";
import {
  type ClinicalProviderDirectoryEntry,
} from "./provider-directory";
import { resolveClinicalProviderDirectoryEntry } from "./provider-directory-store";
import {
  openClinicalOauthVerifier,
  sealClinicalConnectionFhirBaseUrl,
  sealClinicalConnectionSecret,
  sealClinicalOauthVerifier,
  toClinicalJsonArray,
} from "./secrets";
import {
  buildSmartAuthorizationUrl,
  createSmartPkce,
  createSmartState,
  discoverSmartConfiguration,
  exchangeSmartAuthorizationCode,
  normalizeSmartStateHash,
  readGrantedSmartResourceTypes,
} from "./smart";
import {
  appendClinicalRetrievalWakeTx,
  signalClinicalRetrievalWake,
} from "./retrieval";
import {
  buildEpicBetaRetrievalPlan,
  EPIC_BETA_FHIR_PAGE_COUNT,
} from "./epic-policy";

const OAUTH_SESSION_TTL_MS = 10 * 60 * 1_000;
const CLINICAL_CONNECTION_ID_PREFIX = "crc_";
const CLINICAL_RETRIEVAL_RUN_ID_PREFIX = "crr_";

export async function startClinicalRecordConnection(input: {
  claim: string;
  fetchImpl?: typeof fetch;
  providerDirectoryEntryId: string;
  request: Request;
}): Promise<{ authorizationUrl: string; expiresAt: string }> {
  assertHostedOnboardingMutationOrigin(input.request);
  const auth = await requireActiveHostedAppSessionFromRequest(input.request);
  const prisma = getPrisma();
  await assertHostedLaunchRequiredConsentGranted({ memberId: auth.member.id, prisma });
  const provider = requireProviderEntry(input.providerDirectoryEntryId);
  await assertClinicalRecordConnectionAvailable({
    memberId: auth.member.id,
    providerDirectoryEntryId: provider.id,
  });
  const clientId = requireConfiguredClientId(provider);
  const intent = await claimClinicalRecordConnectIntentForStart({
    claim: input.claim,
    memberId: auth.member.id,
    providerDirectoryEntryId: provider.id,
  });

  try {
    const smart = await discoverSmartConfiguration({
      fetchImpl: input.fetchImpl,
      fhirBaseUrl: provider.fhirBaseUrl,
      requestedBaseScopes: provider.requestedBaseScopes,
      resourceTypes: provider.resourceTypes,
    });
    const publicBaseUrl = resolveHostedPublicBaseUrl() ?? new URL(input.request.url).origin;
    const redirectUri = new URL("/api/clinical-records/oauth/callback", `${publicBaseUrl}/`).toString();
    const pkce = createSmartPkce();
    const state = createSmartState();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OAUTH_SESSION_TTL_MS);
    const codeVerifierEncrypted = await sealClinicalOauthVerifier({
      memberId: auth.member.id,
      stateHash: state.stateHash,
      value: pkce.verifier,
    });

    await prisma.clinicalRecordOauthSession.create({
      data: {
        clientId,
        codeVerifierEncrypted,
        connectIntentClaimHash: intent.claimHash,
        createdAt: now,
        expiresAt,
        fhirBaseHash: createHash("sha256").update(provider.fhirBaseUrl).digest("hex"),
        memberId: auth.member.id,
        providerDirectoryEntryId: provider.id,
        redirectUri,
        requestedScopesJson: toClinicalJsonArray(smart.requestedScopes),
        stateHash: state.stateHash,
        tokenEndpoint: smart.tokenEndpoint,
        webSessionId: auth.sessionId,
      },
    });

    return {
      authorizationUrl: buildSmartAuthorizationUrl({
        authorizationEndpoint: smart.authorizationEndpoint,
        audience: provider.fhirBaseUrl,
        challenge: pkce.challenge,
        clientId,
        redirectUri,
        requestedScopes: smart.requestedScopes,
        state: state.state,
      }),
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    await releaseClinicalRecordConnectIntentStart({
      claimHash: intent.claimHash,
      memberId: auth.member.id,
    });
    throw error;
  }
}

export async function finishClinicalRecordAuthorization(input: {
  code: string | null;
  fetchImpl?: typeof fetch;
  providerDenied: boolean;
  providerError: boolean;
  request: Request;
  state: string;
}): Promise<{ connectionId: string; retrievalRunId: string }> {
  const auth = await requireActiveHostedAppSessionFromRequest(input.request);
  const session = await consumeClinicalOauthSession({ auth, state: input.state });
  await assertHostedLaunchRequiredConsentGranted({ memberId: auth.member.id, prisma: getPrisma() });

  if (input.providerDenied || input.providerError || !input.code) {
    await completeClinicalRecordConnectIntent({
      claimHash: session.connectIntentClaimHash,
      memberId: auth.member.id,
      now: new Date(),
    });
    throw clinicalRecordsError({
      code: input.providerDenied
        ? "CLINICAL_RECORD_AUTHORIZATION_DECLINED"
        : "CLINICAL_RECORD_AUTHORIZATION_FAILED",
      httpStatus: input.providerDenied ? 400 : 502,
      message: input.providerDenied
        ? "The provider did not authorize Clinical Records access."
        : "The provider could not complete Clinical Records authorization.",
    });
  }

  const provider = requireProviderEntry(session.providerDirectoryEntryId);
  if (hashClinicalFhirBaseUrl(provider.fhirBaseUrl) !== session.fhirBaseHash) {
    throw providerConfigurationChangedError();
  }
  const requestedScopes = parseStoredStringArray(session.requestedScopesJson, "requested SMART scopes");
  const verifier = await openClinicalOauthVerifier({
    encrypted: session.codeVerifierEncrypted,
    memberId: auth.member.id,
    stateHash: session.stateHash,
  });
  const token = await exchangeSmartAuthorizationCode({
    clientId: session.clientId,
    code: normalizeAuthorizationCode(input.code),
    fetchImpl: input.fetchImpl,
    redirectUri: session.redirectUri,
    requestedScopes,
    tokenEndpoint: session.tokenEndpoint,
    verifier,
  });
  const resourceTypes = readGrantedSmartResourceTypes(token.grantedScopes, provider.resourceTypes)
    .filter((resourceType) => provider.resourceTypes.includes(resourceType));
  if (!resourceTypes.includes("Patient") || resourceTypes.length < 2) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_SMART_SCOPES_INSUFFICIENT",
      httpStatus: 502,
      message: "The provider did not grant enough Clinical Records permissions.",
    });
  }
  const persisted = await runWithHostedDomainRootUnwrapCache(() => persistClinicalConnection({
    connectIntentClaimHash: session.connectIntentClaimHash,
    fhirBaseHash: session.fhirBaseHash,
    memberId: auth.member.id,
    now: new Date(),
    provider,
    clientId: session.clientId,
    requestedScopes,
    resourceTypes,
    tokenEndpoint: session.tokenEndpoint,
    token,
  }));
  await signalClinicalRetrievalWake(persisted.wake);
  return {
    connectionId: persisted.connectionId,
    retrievalRunId: persisted.retrievalRunId,
  };
}

async function consumeClinicalOauthSession(input: {
  auth: HostedAppSession;
  now?: Date;
  state: string;
}) {
  const now = input.now ?? new Date();
  const stateHash = normalizeSmartStateHash(input.state);
  if (!stateHash) throw invalidOauthStateError();

  return getPrisma().$transaction(async (tx) => {
    // Retention uses SKIP LOCKED. Acquire the exact callback owner before the
    // replay decision so cleanup either wins first and leaves this missing, or
    // skips a live consumer until its consume mark commits.
    await tx.$queryRaw<Array<{ stateHash: string }>>`
      SELECT oauth_session."state_hash" AS "stateHash"
      FROM "clinical_record_oauth_session" AS oauth_session
      WHERE oauth_session."state_hash" = ${stateHash}
      FOR UPDATE OF oauth_session
    `;
    const session = await tx.clinicalRecordOauthSession.findUnique({ where: { stateHash } });
    if (!session) throw invalidOauthStateError();
    if (
      session.memberId !== input.auth.member.id
      || session.webSessionId !== input.auth.sessionId
    ) throw invalidOauthStateError();
    if (session.expiresAt.getTime() <= now.getTime()) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_OAUTH_STATE_EXPIRED",
        httpStatus: 410,
        message: "The provider authorization session expired.",
      });
    }
    if (session.consumedAt) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_OAUTH_STATE_REPLAYED",
        httpStatus: 409,
        message: "The provider authorization callback was already handled.",
      });
    }
    const consumed = await tx.clinicalRecordOauthSession.updateMany({
      data: { consumedAt: now },
      where: { consumedAt: null, stateHash },
    });
    if (consumed.count !== 1) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_OAUTH_STATE_REPLAYED",
        httpStatus: 409,
        message: "The provider authorization callback was already handled.",
      });
    }
    return session;
  });
}

async function persistClinicalConnection(input: {
  clientId: string;
  connectIntentClaimHash: string;
  fhirBaseHash: string;
  memberId: string;
  now: Date;
  provider: ClinicalProviderDirectoryEntry;
  requestedScopes: readonly string[];
  resourceTypes: readonly string[];
  tokenEndpoint: string;
  token: Awaited<ReturnType<typeof exchangeSmartAuthorizationCode>>;
}): Promise<{
  connectionId: string;
  retrievalRunId: string;
  wake: Awaited<ReturnType<typeof appendClinicalRetrievalWakeTx>>;
}> {
  const prisma = getPrisma();
  await assertClinicalRecordConnectionAvailable({
    memberId: input.memberId,
    providerDirectoryEntryId: input.provider.id,
  });

  const connectionId = generateOpaqueId(CLINICAL_CONNECTION_ID_PREFIX);
  const retrievalRunId = generateOpaqueId(CLINICAL_RETRIEVAL_RUN_ID_PREFIX);
  const tokenVersion = 1;
  const retrievalGeneration = 1;
  const fhirBaseUrlEncrypted = await sealClinicalConnectionFhirBaseUrl({
    connectionId,
    memberId: input.memberId,
    value: input.provider.fhirBaseUrl,
  });
  const patientIdEncrypted = await sealClinicalConnectionSecret({
    connectionId,
    field: "patientId",
    memberId: input.memberId,
    tokenVersion,
    value: input.token.patientId,
  });
  const accessTokenEncrypted = await sealClinicalConnectionSecret({
    connectionId,
    field: "accessToken",
    memberId: input.memberId,
    tokenVersion,
    value: input.token.accessToken,
  });
  if (!patientIdEncrypted || !accessTokenEncrypted) {
    throw new TypeError("Clinical Records connection encryption returned an empty required value.");
  }
  const connectionData = {
    accessTokenEncrypted,
    accessTokenExpiresAt: input.token.expiresInSeconds
      ? new Date(input.now.getTime() + input.token.expiresInSeconds * 1_000)
      : null,
    connectedAt: input.now,
    clientId: input.clientId,
    disconnectedAt: null,
    displayName: input.provider.brandName,
    fhirBaseHash: input.fhirBaseHash,
    fhirBaseUrlEncrypted,
    grantedScopesJson: toClinicalJsonArray(input.token.grantedScopes),
    id: connectionId,
    lastErrorCode: null,
    memberId: input.memberId,
    patientIdEncrypted,
    providerDirectoryEntryId: input.provider.id,
    refreshTokenEncrypted: null,
    requestedScopesJson: toClinicalJsonArray(input.requestedScopes),
    retrievalGeneration,
    sourceSystem: input.provider.sourceSystem,
    status: "active",
    tokenEndpoint: input.tokenEndpoint,
    tokenVersion,
  } satisfies Prisma.ClinicalRecordConnectionUncheckedCreateInput;
  const retrievalRunData = {
    connectionId,
    createdAt: input.now,
    generation: retrievalGeneration,
    id: retrievalRunId,
    memberId: input.memberId,
    grantedScopesJson: toClinicalJsonArray(input.token.grantedScopes),
    retrievalPlanJson: buildEpicBetaRetrievalPlan({
      frozenAt: input.now,
      pageCount: EPIC_BETA_FHIR_PAGE_COUNT,
      resourceTypes: input.resourceTypes,
    }),
    retrievalProtocol: "query-slices-v2",
    resourceTypesJson: toClinicalJsonArray(input.resourceTypes),
    status: "queued",
  } satisfies Prisma.ClinicalRecordRetrievalRunUncheckedCreateInput;

  // The wake payload is sealed with commit-time laneSeq AAD, so it must stay
  // inside the transaction. Warm the exact mailbox-payload root beforehand;
  // the scoped cache makes the later seal local work while locks are held.
  const mailboxRoot = await unwrapHostedDomainRootForWeb({
    domain: getHostedCryptoDomainForLane("mailbox-payload"),
    prisma,
    retainFailureInScopedCache: true,
    userId: input.memberId,
  });
  mailboxRoot.rootKey.fill(0);

  let persisted: {
    connectionId: string;
    retrievalRunId: string;
    wake: Awaited<ReturnType<typeof appendClinicalRetrievalWakeTx>>;
  };
  try {
    persisted = await prisma.$transaction(async (tx) => {
      await assertHostedLaunchRequiredConsentGranted({ memberId: input.memberId, prisma: tx });
      await tx.clinicalRecordConnection.create({
        data: connectionData,
      });
      await tx.clinicalRecordRetrievalRun.create({
        data: retrievalRunData,
      });
      await completeClinicalRecordConnectIntent({
        claimHash: input.connectIntentClaimHash,
        memberId: input.memberId,
        now: input.now,
      }, tx);
      const wake = await appendClinicalRetrievalWakeTx({
        generation: retrievalGeneration,
        memberId: input.memberId,
        occurredAt: input.now,
        runId: retrievalRunId,
        tx,
      });
      return { connectionId, retrievalRunId, wake };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw connectionAlreadyExistsError();
    throw error;
  }
  return persisted;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "P2002",
  );
}

async function assertClinicalRecordConnectionAvailable(input: {
  memberId: string;
  providerDirectoryEntryId: string;
}): Promise<void> {
  const existing = await getPrisma().clinicalRecordConnection.findUnique({
    select: { id: true },
    where: {
      memberId_providerDirectoryEntryId: input,
    },
  });
  if (existing) throw connectionAlreadyExistsError();
}

function requireProviderEntry(entryId: string): ClinicalProviderDirectoryEntry {
  const entry = resolveClinicalProviderDirectoryEntry(entryId);
  if (!entry) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_PROVIDER_NOT_FOUND",
      httpStatus: 404,
      message: "The selected Clinical Records provider is unavailable.",
    });
  }
  return entry;
}

function requireConfiguredClientId(provider: ClinicalProviderDirectoryEntry): string {
  const value = process.env[provider.clientIdEnvironmentKey]?.trim();
  if (!value || value.length > 512) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_PROVIDER_NOT_CONFIGURED",
      httpStatus: 503,
      message: "The selected Clinical Records provider is not configured yet.",
      retryable: true,
    });
  }
  return value;
}

function normalizeAuthorizationCode(value: string): string {
  const code = value.trim();
  if (!code || code.length > 8_192) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_AUTHORIZATION_CODE_INVALID",
      httpStatus: 400,
      message: "The provider authorization code was invalid.",
    });
  }
  return code;
}

function parseStoredStringArray(value: Prisma.JsonValue, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new TypeError(`Stored Clinical Records ${label} are invalid.`);
  }
  const strings = value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 120);
  if (strings.length !== value.length) throw new TypeError(`Stored Clinical Records ${label} are invalid.`);
  return strings;
}

function invalidOauthStateError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_OAUTH_STATE_INVALID",
    httpStatus: 400,
    message: "The provider authorization state was invalid.",
  });
}

function connectionAlreadyExistsError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_CONNECTION_ALREADY_EXISTS",
    httpStatus: 409,
    message: "This Clinical Records provider is already connected.",
  });
}

function providerConfigurationChangedError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_PROVIDER_CONFIGURATION_CHANGED",
    httpStatus: 409,
    message: "The provider configuration changed. Start the connection again.",
  });
}

function hashClinicalFhirBaseUrl(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generateOpaqueId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("base64url")}`;
}
