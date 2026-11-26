import { classifyClinicalRun, closeClinicalRunTx, lifecycleRunSelect } from "./run-lifecycle";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import "server-only";
import { assertClinicalProcessorAdmission } from "./processor-registry";

import { isDeviceSyncAppConnectReturn, type DeviceSyncAppConnectReturn } from "@murphai/device-syncd/types";
import { assertHostedNativeMemberAuthCurrentTx, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { buildHostedDeviceSyncAppCompletionProof, readHostedDeviceSyncAppCompletionProofError } from "../device-sync/browser-callback-proof";
import { isClinicalRecordsControlPlaneError } from "./errors";
import { CLINICAL_CODE_LIMIT } from "./return-query";
import { hasImportCapacity, countedSourceFilter } from "./source-state";
import { prepareClinicalPersistentAccess } from "./persistent-access";

import * as z from "@murphai/contracts/zod-runtime";
import { epicProfileSchema, resolveSavedEpicAuth, resolveEpicClient, type EpicProfile } from "./epic-import-config";

import { lockHostedMemberRow, readHostedMemberSuspensionAfterLockTx } from "../hosted-onboarding/shared";

import { createHash, randomBytes } from "node:crypto";

import { hashClinicalFhirPatientId } from "@murphai/clinical-records";
import { CLINICAL_RECORD_MAX_SOURCES } from "./client-contracts";
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
  openClinicalConnectionSecret,
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
  requirePinnedEndpoint,
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

const authorizationBinding = z.object({
  version: z.literal(1), verifier: z.string().min(1).max(128), profile: epicProfileSchema,
  brandName: z.string().min(1).max(160), fhirBaseUrl: z.string().url().max(2048),
  resourceTypes: z.array(z.string().min(1).max(80)).min(1).max(100),
}).strict();

export async function startClinicalRecordConnection(input: {
  claim: string;
  fetchImpl?: typeof fetch;
  providerDirectoryEntryId: string;
  request: Request;
}): Promise<{ authorizationUrl: string; expiresAt: string }> {
  assertHostedOnboardingMutationOrigin(input.request);
  const auth = await requireActiveHostedAppSessionFromRequest(input.request);
  const { authorizationUrl, expiresAt } = await startAuthorization({
    auth, claim: input.claim, fetchImpl: input.fetchImpl,
    providerDirectoryEntryId: input.providerDirectoryEntryId, appReturn: null, origin: new URL(input.request.url).origin,
  });
  return { authorizationUrl, expiresAt };
}

export async function startNativeAuthorization(input: {
  auth: HostedNativeMemberAuth; appReturn: DeviceSyncAppConnectReturn; providerDirectoryEntryId: string; origin: string;
}) {
  const { authorizationUrl, state, createdAt } = await startAuthorization({ ...input, claim: null });
  return { authorizationUrl, completionProof: buildHostedDeviceSyncAppCompletionProof({
    memberId: input.auth.member.id, sessionId: input.auth.sessionId, provider: "clinical-records", state, now: createdAt,
  }) };
}

async function startAuthorization(input: {
  auth: HostedAppSession | HostedNativeMemberAuth; origin: string; appReturn: DeviceSyncAppConnectReturn | null;
  claim: string | null; providerDirectoryEntryId: string; fetchImpl?: typeof fetch;
}) {
  const { auth } = input;
  const prisma = getPrisma();
  await assertHostedLaunchRequiredConsentGranted({ memberId: auth.member.id, prisma });
  const provider = requireProviderEntry(input.providerDirectoryEntryId);
  await assertClinicalRecordConnectionAvailable({
    memberId: auth.member.id,
    providerDirectoryEntryId: provider.id,
  });
  const configuration = resolveEpicClient(provider);
  const { clientId } = configuration.auth;
  if (configuration.auth.method === "private_key_jwt") await assertClinicalProcessorAdmission(auth.member.id, prisma);
  const intent = input.claim === null ? null : await claimClinicalRecordConnectIntentForStart({
    claim: input.claim,
    memberId: auth.member.id,
    providerDirectoryEntryId: provider.id,
  });

  try {
    const smart = await discoverSmartConfiguration({
      requestOfflineAccess: configuration.auth.method !== "public",
      fetchImpl: input.fetchImpl,
      fhirBaseUrl: provider.fhirBaseUrl,
      requestedBaseScopes: provider.requestedBaseScopes,
      resourceTypes: configuration.resourceTypes,
    });
    const publicBaseUrl = resolveHostedPublicBaseUrl() ?? input.origin;
    const redirectUri = new URL("/api/clinical-records/oauth/callback", `${publicBaseUrl}/`).toString();
    const pkce = createSmartPkce();
    const state = createSmartState(input.appReturn);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OAUTH_SESSION_TTL_MS);
    const codeVerifierEncrypted = await sealClinicalOauthVerifier({
      memberId: auth.member.id,
      stateHash: state.stateHash,
      value: process.env.CLINICAL_RECORDS_WRITE_GRANT_PROFILES === "1"
        ? JSON.stringify({ version: 1, verifier: pkce.verifier, profile: configuration.profile,
          brandName: provider.brandName, fhirBaseUrl: provider.fhirBaseUrl, resourceTypes: configuration.resourceTypes })
        : pkce.verifier,
    });

    const data = {
      clientId,
      codeVerifierEncrypted,
      appReturn: input.appReturn,
      connectIntentClaimHash: intent?.claimHash ?? null,
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
    };
    if ("credential" in auth) {
      await prisma.$transaction(async tx => {
        await lockHostedMemberRow(tx, auth.member.id);
        await assertNativeClinicalAdmission(auth, tx);
        await tx.clinicalRecordOauthSession.create({ data });
      });
    } else {
      await prisma.clinicalRecordOauthSession.create({ data });
    }

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
      state: state.state,
      createdAt: now,
    };
  } catch (error) {
    if (intent) await releaseClinicalRecordConnectIntentStart({
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
  return finishAuthorization({ auth, code: input.code, state: input.state, providerDenied: input.providerDenied,
    providerError: input.providerError, fetchImpl: input.fetchImpl });
}

export async function readClinicalCallbackAppReturn(state: string) {
  const stateHash = normalizeSmartStateHash(state);
  if (!stateHash) return null;
  const session = await getPrisma().clinicalRecordOauthSession.findUnique({ where: { stateHash }, select: { appReturn: true } });
  if (session?.appReturn == null) return null;
  if (!isDeviceSyncAppConnectReturn(session.appReturn)) throw invalidOauthStateError();
  return session.appReturn;
}

export async function completeNativeAuthorization(auth: HostedNativeMemberAuth, query: URLSearchParams, completionProof: string) {
  const state = query.get("state") ?? "";
  const proofError = readHostedDeviceSyncAppCompletionProofError({
    memberId: auth.member.id, sessionId: auth.sessionId, provider: "clinical-records", state, completionProof,
  });
  if (proofError === "CALLBACK_PROOF_EXPIRED") return "expired" as const;
  if (proofError) throw clinicalRecordsError({ code: "CALLBACK_PROOF_INVALID", httpStatus: 400, message: "Invalid completion proof." });
  try {
    await finishAuthorization({ auth, state, code: query.get("code"),
      providerDenied: query.get("error") === "access_denied", providerError: query.has("error") });
    return "connected" as const;
  } catch (error) {
    if (!isClinicalRecordsControlPlaneError(error)) throw error;
    switch (error.code) {
      case "CLINICAL_RECORD_OAUTH_STATE_REPLAYED": return null;
      case "CLINICAL_RECORD_AUTHORIZATION_FAILED": return query.get("error") === "login_required" ? "sign_in_required" as const : "failed" as const;
      case "CLINICAL_RECORD_AUTHORIZATION_DECLINED": return "canceled" as const;
      case "CLINICAL_RECORD_OAUTH_STATE_MISSING": return "expired" as const;
      case "CLINICAL_RECORD_OAUTH_STATE_EXPIRED": return "expired" as const;
      case "CLINICAL_RECORD_CONNECTION_ALREADY_EXISTS": return "already_connected" as const;
      case "CLINICAL_RECORD_PATIENT_BINDING_CHANGED": return "different_person" as const;
      case "CLINICAL_RECORD_SMART_SCOPES_INSUFFICIENT": return "not_enough_access" as const;
      case "CLINICAL_RECORD_SMART_REAUTH_REQUIRED": return "sign_in_required" as const;
      case "CLINICAL_RECORD_SOURCE_LIMIT_REACHED": return "too_many_sources" as const;
      default: return "failed" as const;
    }
  }
}

async function finishAuthorization(input: {
  auth: HostedAppSession | HostedNativeMemberAuth; code: string | null; state: string;
  providerDenied: boolean; providerError: boolean; fetchImpl?: typeof fetch;
}) {
  const { auth } = input;
  const session = await consumeClinicalOauthSession({ auth, state: input.state });
  await assertHostedLaunchRequiredConsentGranted({ memberId: auth.member.id, prisma: getPrisma() });

  if (input.providerDenied || input.providerError || !input.code) {
    if (session.connectIntentClaimHash) await completeClinicalRecordConnectIntent({
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

  const opened = await openClinicalOauthVerifier({
    encrypted: session.codeVerifierEncrypted, memberId: auth.member.id, stateHash: session.stateHash,
  });
  const saved = opened.startsWith("{") ? authorizationBinding.parse(JSON.parse(opened)) : null;
  const stored = { clientId: session.clientId, grant: "callback" as const };
  const configuration = (() => {
    if (!saved) {
      const provider = requireProviderEntry(session.providerDirectoryEntryId);
      return { ...resolveEpicClient(provider, stored), provider };
    }
    return { auth: resolveSavedEpicAuth(session.providerDirectoryEntryId, stored, saved.profile),
      resourceTypes: saved.resourceTypes, hospitalApprovedImports: saved.profile.hospitalApproved,
      provider: { id: session.providerDirectoryEntryId, brandName: saved.brandName,
        fhirBaseUrl: saved.fhirBaseUrl, sourceSystem: "epic-fhir" as const } };
  })();
  const { provider } = configuration;
  if (hashClinicalFhirBaseUrl(provider.fhirBaseUrl) !== session.fhirBaseHash) throw providerConfigurationChangedError();
  requirePinnedEndpoint(session.tokenEndpoint, new URL(provider.fhirBaseUrl), "token endpoint");
  if (configuration.auth.method === "private_key_jwt") await assertClinicalProcessorAdmission(auth.member.id, getPrisma());
  const requestedScopes = parseStoredStringArray(session.requestedScopesJson, "requested SMART scopes");
  const verifier = saved?.verifier ?? opened;
  const token = await exchangeSmartAuthorizationCode({
    auth: configuration.auth,
    code: normalizeAuthorizationCode(input.code),
    fetchImpl: input.fetchImpl,
    redirectUri: session.redirectUri,
    requestedScopes,
    tokenEndpoint: session.tokenEndpoint,
    verifier,
  });
  const resourceTypes = readGrantedSmartResourceTypes(token.grantedScopes, configuration.resourceTypes);
  if (!resourceTypes.includes("Patient") || resourceTypes.length < 2) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_SMART_SCOPES_INSUFFICIENT",
      httpStatus: 502,
      message: "The provider did not grant enough Clinical Records permissions.",
    });
  }
  const persisted = await runWithHostedDomainRootUnwrapCache(() => persistClinicalConnection({
    nativeAuth: "credential" in auth ? auth : null,
    stateHash: session.stateHash,
    connectIntentClaimHash: session.connectIntentClaimHash,
    fhirBaseHash: session.fhirBaseHash,
    memberId: auth.member.id,
    now: new Date(),
    provider,
    requestedScopes,
    resourceTypes,
    hospitalApprovedImports: configuration.hospitalApprovedImports,
    requiresProcessorApprovals: configuration.auth.method === "private_key_jwt",
    clientId: session.clientId,
    tokenEndpoint: session.tokenEndpoint,
    profile: saved?.profile,
    authorizationStartedAt: session.createdAt,
    token,
  }));
  await signalClinicalRetrievalWake(persisted.wake);
  return {
    connectionId: persisted.connectionId,
    retrievalRunId: persisted.retrievalRunId,
  };
}

async function consumeClinicalOauthSession(input: {
  auth: HostedAppSession | HostedNativeMemberAuth;
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
    if (!session) {
      if ("credential" in input.auth) throw clinicalRecordsError({
        code: "CLINICAL_RECORD_OAUTH_STATE_MISSING", httpStatus: 410, message: "The authorization session is no longer available.",
      });
      throw invalidOauthStateError();
    }
    if (
      (session.appReturn != null) !== ("credential" in input.auth)
      || session.memberId !== input.auth.member.id
      || session.webSessionId !== input.auth.sessionId
    ) throw invalidOauthStateError();
    if (session.consumedAt && (session.appReturn != null || session.expiresAt > now)) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_OAUTH_STATE_REPLAYED",
        httpStatus: 409,
        message: "The provider authorization callback was already handled.",
      });
    }
    if (session.expiresAt.getTime() <= now.getTime()) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_OAUTH_STATE_EXPIRED",
        httpStatus: 410,
        message: "The provider authorization session expired.",
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
  profile?: EpicProfile;
  clientId: string;
  tokenEndpoint: string;
  hospitalApprovedImports: boolean;
  requiresProcessorApprovals: boolean;
  authorizationStartedAt: Date;
  nativeAuth: HostedNativeMemberAuth | null;
  stateHash: string;
  connectIntentClaimHash: string | null;
  fhirBaseHash: string;
  memberId: string;
  now: Date;
  provider: Pick<ClinicalProviderDirectoryEntry, "id" | "brandName" | "fhirBaseUrl" | "sourceSystem">;
  requestedScopes: readonly string[];
  resourceTypes: readonly string[];
  token: Awaited<ReturnType<typeof exchangeSmartAuthorizationCode>>;
}): Promise<{
  connectionId: string;
  retrievalRunId: string;
  wake: Awaited<ReturnType<typeof appendClinicalRetrievalWakeTx>>;
}> {
  const prisma = getPrisma();
  const existing = await assertClinicalRecordConnectionAvailable({
    memberId: input.memberId,
    providerDirectoryEntryId: input.provider.id,
  });

  const connectionId = existing?.id ?? generateOpaqueId(CLINICAL_CONNECTION_ID_PREFIX);
  const retrievalRunId = generateOpaqueId(CLINICAL_RETRIEVAL_RUN_ID_PREFIX);
  const tokenVersion = (existing?.tokenVersion ?? 0) + 1;
  const patientIdHash = hashClinicalFhirPatientId(input.token.patientId);
  const priorPatientBinding = existing
    ? await openClinicalConnectionSecret({
        connectionId: existing.id,
        encrypted: existing.patientBindingEncrypted,
        field: "patientBinding",
        memberId: input.memberId,
        tokenVersion: existing.tokenVersion,
      })
    : null;
  if (
    existing &&
    (priorPatientBinding !== patientIdHash || existing.fhirBaseHash !== input.fhirBaseHash)
  ) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_PATIENT_BINDING_CHANGED",
      httpStatus: 409,
      message: "Sign in to the same patient record used for this source.",
    });
  }
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
  const patientBindingEncrypted = await sealClinicalConnectionSecret({
    connectionId,
    field: "patientBinding",
    memberId: input.memberId,
    tokenVersion,
    value: patientIdHash,
  });
  const accessTokenEncrypted = await sealClinicalConnectionSecret({
    connectionId,
    field: "accessToken",
    memberId: input.memberId,
    tokenVersion,
    value: input.token.accessToken,
  });
  if (!patientIdEncrypted || !patientBindingEncrypted || !accessTokenEncrypted) {
    throw new TypeError("Clinical Records connection encryption returned an empty required value.");
  }
  const persistentAccess = await prepareClinicalPersistentAccess({ ...input, connectionId, tokenVersion });
  const connectionData = {
    ...persistentAccess,
    accessTokenEncrypted,
    accessTokenExpiresAt: input.token.expiresInSeconds
      ? new Date(input.now.getTime() + input.token.expiresInSeconds * 1_000)
      : null,
    requiresProcessorApprovals: input.requiresProcessorApprovals,
    connectedAt: input.now,
    disconnectedAt: null,
    displayName: input.provider.brandName,
    fhirBaseHash: input.fhirBaseHash,
    fhirBaseUrlEncrypted,
    id: connectionId,
    lastErrorCode: null,
    memberId: input.memberId,
    patientIdEncrypted,
    patientBindingEncrypted,
    providerDirectoryEntryId: input.provider.id,
    requestedScopesJson: toClinicalJsonArray(input.requestedScopes),
    sourceSystem: input.provider.sourceSystem,
    status: "active",
    tokenVersion,
  } satisfies Prisma.ClinicalRecordConnectionUncheckedCreateInput;
  const retrievalRunData = {
    connectionId,
    createdAt: input.now,
    id: retrievalRunId,
    memberId: input.memberId,
    grantedScopesJson: toClinicalJsonArray(input.token.grantedScopes),
    retrievalPlanJson: buildEpicBetaRetrievalPlan({
      hospitalApprovedImports: input.hospitalApprovedImports,
      frozenAt: input.now,
      pageCount: EPIC_BETA_FHIR_PAGE_COUNT,
      resourceTypes: input.resourceTypes,
    }),
    retrievalProtocol: "query-slices-v2",
    status: "queued",
  } satisfies Omit<Prisma.ClinicalRecordRetrievalRunUncheckedCreateInput, "generation">;

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
      await assertClinicalPersistenceAuthority(tx, input);
      const current = await assertClinicalRecordConnectionAvailable(
        { memberId: input.memberId, providerDirectoryEntryId: input.provider.id },
        tx,
      );
      if (
        current?.id !== existing?.id ||
        current?.tokenVersion !== existing?.tokenVersion ||
        (current?.disconnectedAt && current.disconnectedAt >= input.authorizationStartedAt)
      )
        throw connectionAlreadyExistsError();
      if (!current || current.status === "disconnected") {
        const sources = await tx.clinicalRecordConnection.findMany({
          where: countedSourceFilter(input.memberId),
          select: { id: true },
          take: CLINICAL_RECORD_MAX_SOURCES,
        });
        if (!hasImportCapacity(sources.length))
          throw clinicalRecordsError({
            code: "CLINICAL_RECORD_SOURCE_LIMIT_REACHED",
            httpStatus: 409,
            message: "The medical record source limit has been reached.",
          });
      }
      const retrievalGeneration = (current?.retrievalGeneration ?? 0) + 1;
      const data = { ...connectionData, retrievalGeneration };
      if (current) {
        const previous = current.retrievalRuns[0];
        if (previous && !previous.completedAt && !await closeClinicalRunTx(tx, {
          memberId: input.memberId, runId: previous.id, generation: previous.generation,
        }, "canceled", "superseded", input.now)) throw connectionAlreadyExistsError();
        await tx.clinicalRecordConnection.update({
          where: { id: current.id },
          data,
        });
      } else {
        await tx.clinicalRecordConnection.create({ data });
      }
      await tx.clinicalRecordRetrievalRun.create({
        data: { ...retrievalRunData, generation: retrievalGeneration },
      });
      if (input.connectIntentClaimHash) await completeClinicalRecordConnectIntent(
        {
          claimHash: input.connectIntentClaimHash,
          memberId: input.memberId,
          now: input.now,
        },
        tx,
      );
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

async function assertClinicalPersistenceAuthority(
  tx: Prisma.TransactionClient,
  input: { memberId: string; nativeAuth: HostedNativeMemberAuth | null; stateHash: string; requiresProcessorApprovals: boolean },
) {
  await lockHostedMemberRow(tx, input.memberId);
  if ((await readHostedMemberSuspensionAfterLockTx(tx, input.memberId)) !== "active") {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_MEMBER_UNAVAILABLE",
      httpStatus: 409,
      message: "This account cannot receive medical records.",
    });
  }
  if (input.requiresProcessorApprovals) await assertClinicalProcessorAdmission(input.memberId, tx);
  if (input.nativeAuth) {
    await assertNativeClinicalAdmission(input.nativeAuth, tx);
    const authorization = await tx.clinicalRecordOauthSession.findUnique({
      where: { stateHash: input.stateHash }, select: { consumedAt: true },
    });
    if (!authorization?.consumedAt) throw invalidOauthStateError();
  } else {
    await assertHostedLaunchRequiredConsentGranted({ memberId: input.memberId, prisma: tx });
  }
}

async function assertNativeClinicalAdmission(auth: HostedNativeMemberAuth, tx: Prisma.TransactionClient) {
  await assertHostedNativeMemberAuthCurrentTx(auth, tx);
  await assertActiveHostedMemberAccessAllowed({ memberId: auth.member.id, prisma: tx });
  await assertHostedLaunchRequiredConsentGranted({ memberId: auth.member.id, prisma: tx });
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

async function assertClinicalRecordConnectionAvailable(
  input: {
    memberId: string;
    providerDirectoryEntryId: string;
  },
  prisma: Pick<Prisma.TransactionClient, "clinicalRecordConnection"> = getPrisma(),
) {
  const existing = await prisma.clinicalRecordConnection.findUnique({
    select: {
      id: true,
      tokenVersion: true,
      retrievalGeneration: true,
      patientBindingEncrypted: true,
      fhirBaseHash: true,
      status: true,
      disconnectedAt: true,
      retrievalRuns: {
        orderBy: { generation: "desc" },
        take: 1,
        select: lifecycleRunSelect,
      },
    },
    where: { memberId_providerDirectoryEntryId: input },
  });
  if (existing) {
    const run = existing.retrievalRuns[0];
    const lifecycle = classifyClinicalRun(run, new Date());
    if (lifecycle === "unknown" || lifecycle === "awaiting_counts")
      throw connectionAlreadyExistsError();

  }
  return existing;
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

function normalizeAuthorizationCode(value: string): string {
  const code = value.trim();
  if (!code || code.length > CLINICAL_CODE_LIMIT) {
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
    throw new ContractValidationError(`Stored Clinical Records ${label} are invalid.`);
  }
  const strings = value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 120);
  if (strings.length !== value.length) throw new ContractValidationError(`Stored Clinical Records ${label} are invalid.`);
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
    message: "This source is still finishing an import. Check its status before trying again.",
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
