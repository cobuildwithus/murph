import { Buffer } from "node:buffer";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";

import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { parseSerializedHostedSecureBoxEnvelope } from "@murphai/runtime-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import type {
  GcpKmsDecryptInput,
  GcpKmsEncryptInput,
} from "@/src/lib/hosted-crypto/gcp-kms";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type SmartToken = {
  accessToken: string;
  expiresInSeconds: number;
  grantedScopes: string[];
  patientId: string;
};

type IngressDecryptBarrier = {
  release: Deferred<void>;
  started: Deferred<void>;
};

type TestBoundaryState = {
  authSession: HostedAppSession | null;
  callbackPrisma: PrismaClient | null;
  cleanupIds: Set<string>;
  ingressDecryptBarrier: IngressDecryptBarrier | null;
  ingressDecryptCalls: number;
  ingressDecryptsDuringPersistence: number;
  persistenceTransactionActive: boolean;
  token: SmartToken | null;
};

const boundary = vi.hoisted(
  (): TestBoundaryState => ({
    authSession: null,
    callbackPrisma: null,
    cleanupIds: new Set<string>(),
    ingressDecryptBarrier: null,
    ingressDecryptCalls: 0,
    ingressDecryptsDuringPersistence: 0,
    persistenceTransactionActive: false,
    token: null,
  }),
);

const externalEdges = vi.hoisted(() => ({
  deleteHostedRuntimeLogDataForUsers: vi.fn(),
  deleteHostedRunnerUserDataBestEffort: vi.fn(),
  deleteMemberExternalStateForAccountDeletion: vi.fn(),
  exchangeSmartAuthorizationCode: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  terminateHostedUserRuntimeWorkflowBestEffort: vi.fn(),
}));

vi.mock("@/src/lib/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/prisma")>();
  return {
    ...actual,
    getPrisma(): PrismaClient {
      if (!boundary.callbackPrisma) {
        throw new Error("The callback Prisma boundary is not configured.");
      }
      return boundary.callbackPrisma;
    },
  };
});

vi.mock("@/src/lib/hosted-onboarding/app-session", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/app-session")
  >();
  return {
    ...actual,
    requireActiveHostedAppSessionFromRequest:
      externalEdges.requireActiveHostedAppSessionFromRequest,
  };
});

vi.mock("@/src/lib/clinical-records/smart", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/clinical-records/smart")
  >();
  return {
    ...actual,
    exchangeSmartAuthorizationCode:
      externalEdges.exchangeSmartAuthorizationCode,
  };
});

vi.mock(
  "@/src/lib/hosted-orchestration/signal-runtime",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/src/lib/hosted-orchestration/signal-runtime")
    >();
    return {
      ...actual,
      signalHostedMailboxAppendRuntime:
        externalEdges.signalHostedMailboxAppendRuntime,
    };
  },
);

vi.mock(
  "@/src/lib/hosted-orchestration/workflow-termination",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/src/lib/hosted-orchestration/workflow-termination")
    >();
    return {
      ...actual,
      terminateHostedUserRuntimeWorkflowBestEffort:
        externalEdges.terminateHostedUserRuntimeWorkflowBestEffort,
    };
  },
);

vi.mock(
  "@/src/lib/hosted-execution/user-data-delete",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("@/src/lib/hosted-execution/user-data-delete")
    >();
    return {
      ...actual,
      deleteHostedRunnerUserDataBestEffort:
        externalEdges.deleteHostedRunnerUserDataBestEffort,
    };
  },
);

vi.mock("@/src/lib/hosted-runtime-log/store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-runtime-log/store")
  >();
  return {
    ...actual,
    deleteHostedRuntimeLogDataForUsers:
      externalEdges.deleteHostedRuntimeLogDataForUsers,
  };
});

vi.mock("@/src/lib/computer-use/service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/computer-use/service")
  >();
  class TestComputerUseService {
    async deleteMemberExternalStateForAccountDeletion(input: {
      memberId: string;
    }) {
      return externalEdges.deleteMemberExternalStateForAccountDeletion(input);
    }
  }
  return {
    ...actual,
    ComputerUseService: TestComputerUseService,
  };
});

vi.mock("@/src/lib/hosted-crypto/gcp-kms", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-crypto/gcp-kms")
  >();
  return {
    ...actual,
    createHostedGcpKmsClientFromEnv(
      source: NodeJS.ProcessEnv = process.env,
    ) {
      const delegate = actual.createHostedGcpKmsClientFromEnv(source);
      return {
        asymmetricSign: delegate.asymmetricSign.bind(delegate),
        async decrypt(input: GcpKmsDecryptInput) {
          if (isIngressDomainRootAad(input.additionalAuthenticatedData)) {
            boundary.ingressDecryptCalls += 1;
            if (boundary.persistenceTransactionActive) {
              boundary.ingressDecryptsDuringPersistence += 1;
            }
            const barrier = boundary.ingressDecryptBarrier;
            if (barrier) {
              barrier.started.resolve();
              await barrier.release.promise;
            }
          }
          return delegate.decrypt(input);
        },
        async encrypt(input: GcpKmsEncryptInput) {
          const cleanupId = readCleanupIdFromAad(
            input.additionalAuthenticatedData,
          );
          if (cleanupId) {
            boundary.cleanupIds.add(cleanupId);
          }
          return delegate.encrypt(input);
        },
        macSign: delegate.macSign.bind(delegate),
      };
    },
  };
});

import { GET as clinicalRecordsCallbackGet } from "../app/api/clinical-records/oauth/callback/route";
import {
  buildClinicalRetrievalWakeEventId,
} from "@/src/lib/clinical-records/retrieval";
import {
  readClinicalProviderDirectory,
} from "@/src/lib/clinical-records/provider-directory-store";
import {
  sealClinicalOauthVerifier,
} from "@/src/lib/clinical-records/secrets";
import { createSmartState } from "@/src/lib/clinical-records/smart";
import {
  provisionHostedCryptoDomainRootsForUser,
} from "@/src/lib/hosted-crypto/domain-root-store";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  recordHostedLaunchRequiredConsent,
} from "@/src/lib/legal/consent";
import {
  deleteHostedAccountData,
  type HostedAccountDeletionResult,
} from "@/src/lib/hosted-privacy/account-data-service";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const CALLBACK_ORIGIN = "https://join.example.test";
const CALLBACK_PATH = "/api/clinical-records/oauth/callback";
const CALLBACK_TIMEOUT_MS = 15_000;
const BLOCKING_TIMEOUT_MS = 6_000;
const TEST_TIMEOUT_MS = 30_000;

if (
  runPostgresConcurrencyProof &&
  (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Clinical Records/account-deletion concurrency proof requires a local DATABASE_URL.",
  );
}

type CallbackProbe = {
  createPause: {
    reached: Deferred<void>;
    release: Deferred<void>;
  } | null;
  ingressRootReads: number;
  ingressRootReadsDuringPersistence: number;
  persistenceBackendPid: Deferred<number>;
  persistenceTransactionStarted: boolean;
  transactionCount: number;
};

type DeletionProbe = {
  firstTransactionBackendPid: Deferred<number>;
  secondThreadContainerReadPause: {
    backendPid: Deferred<number>;
    reached: Deferred<void>;
    release: Deferred<void>;
  } | null;
  threadContainerReadCount: number;
  transactionCount: number;
};

type ClinicalFixture = {
  callbackBaseClient: PrismaClient;
  connectIntentClaimHash: string;
  deletionBaseClient: PrismaClient;
  memberId: string;
  observer: PrismaClient;
  providerDirectoryEntryId: string;
  sessionId: string;
  state: string;
  stateHash: string;
};

type ClinicalDurableSet = Awaited<ReturnType<typeof readClinicalDurableSet>>;

let restoreEnvironment: (() => void) | null = null;

beforeEach(() => {
  restoreEnvironment = configureLocalCryptoAndPublicOrigin();
  setHostedSecureBoxStringTestCodecForTests(null);
  resetBoundaries();

  externalEdges.requireActiveHostedAppSessionFromRequest.mockImplementation(
    async () => {
      if (!boundary.authSession) {
        throw new Error("The callback auth boundary is not configured.");
      }
      return boundary.authSession;
    },
  );
  externalEdges.exchangeSmartAuthorizationCode.mockImplementation(async () => {
    if (!boundary.token) {
      throw new Error("The Epic token boundary is not configured.");
    }
    return boundary.token;
  });
  externalEdges.signalHostedMailboxAppendRuntime.mockResolvedValue({
    signalAccepted: true,
    workflowId: "test-clinical-records-workflow",
  });
  externalEdges.terminateHostedUserRuntimeWorkflowBestEffort.mockResolvedValue({
    configured: true,
    errorCode: null,
    notFound: false,
    terminated: true,
  });
  externalEdges.deleteHostedRunnerUserDataBestEffort.mockResolvedValue(
    completedRunnerDeletionResult(),
  );
  externalEdges.deleteHostedRuntimeLogDataForUsers.mockResolvedValue(0);
  externalEdges.deleteMemberExternalStateForAccountDeletion.mockResolvedValue({
    browserSessionsDeleted: 0,
    profilesDeleted: 0,
  });
});

afterEach(() => {
  boundary.ingressDecryptBarrier?.release.resolve();
  boundary.ingressDecryptBarrier = null;
  boundary.callbackPrisma = null;
  boundary.authSession = null;
  boundary.token = null;
  boundary.persistenceTransactionActive = false;
  setHostedSecureBoxStringTestCodecForTests(null);
  installDefaultHostedSecureBoxStringTestCodec();
  restoreEnvironment?.();
  restoreEnvironment = null;
});

describe.skipIf(!runPostgresConcurrencyProof)(
  "Clinical Records callback/account-deletion PostgreSQL concurrency",
  () => {
    it(
      "prewarms ingress before persistence and reuses that root for the atomic mailbox append",
      async () => {
        const fixture = await createClinicalFixture();
        const callbackProbe = createCallbackProbe();
        const ingressBarrier = createIngressDecryptBarrier();
        boundary.ingressDecryptBarrier = ingressBarrier;
        boundary.callbackPrisma = wrapCallbackPrismaClient(
          fixture.callbackBaseClient,
          callbackProbe,
        );
        let callbackPromise: Promise<Response> | null = null;

        try {
          callbackPromise = invokeClinicalRecordsCallback(fixture);
          await bounded(
            ingressBarrier.started.promise,
            BLOCKING_TIMEOUT_MS,
            "the external ingress KMS decrypt",
          );

          expect(callbackProbe.transactionCount).toBe(1);
          expect(callbackProbe.persistenceTransactionStarted).toBe(false);
          expect(callbackProbe.ingressRootReads).toBe(1);
          expect(boundary.ingressDecryptCalls).toBe(1);
          await expectNoClinicalPersistence(fixture);

          ingressBarrier.release.resolve();
          const response = await bounded(
            callbackPromise,
            CALLBACK_TIMEOUT_MS,
            "the Clinical Records callback",
          );

          expectConnectedRedirect(response);
          const durable = await readClinicalDurableSet(fixture);
          expectAtomicClinicalDurableSet(durable, fixture);
          expect(callbackProbe.ingressRootReads).toBe(1);
          expect(callbackProbe.ingressRootReadsDuringPersistence).toBe(0);
          expect(boundary.ingressDecryptCalls).toBe(1);
          expect(boundary.ingressDecryptsDuringPersistence).toBe(0);
          expect(
            externalEdges.signalHostedMailboxAppendRuntime,
          ).toHaveBeenCalledTimes(1);
        } finally {
          ingressBarrier.release.resolve();
          await settleOperations([callbackPromise]);
          await cleanupClinicalFixture(fixture);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "keeps the connected redirect and committed wake when runtime signaling fails after commit",
      async () => {
        const fixture = await createClinicalFixture();
        const callbackProbe = createCallbackProbe();
        boundary.callbackPrisma = wrapCallbackPrismaClient(
          fixture.callbackBaseClient,
          callbackProbe,
        );
        externalEdges.signalHostedMailboxAppendRuntime.mockRejectedValue(
          new Error("test runtime signal unavailable"),
        );
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

        try {
          const response = await bounded(
            invokeClinicalRecordsCallback(fixture),
            CALLBACK_TIMEOUT_MS,
            "the Clinical Records callback",
          );

          expectConnectedRedirect(response);
          const durable = await readClinicalDurableSet(fixture);
          expectAtomicClinicalDurableSet(durable, fixture);
          expect(durable.wakes[0]).toMatchObject({
            consumedAt: null,
            kind: "clinical-records.sync-requested",
            lane: "system",
          });
          expect(
            externalEdges.signalHostedMailboxAppendRuntime,
          ).toHaveBeenCalledTimes(1);
          expect(warning).toHaveBeenCalledWith(
            "Clinical Records retrieval wake signal failed after durable mailbox append.",
            {
              errorType: "Error",
              mailboxItemIdPresent: true,
            },
          );
        } finally {
          await cleanupClinicalFixture(fixture);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "lets a callback that owns the member-related foreign-key lock commit before account deletion",
      async () => {
        const fixture = await createClinicalFixture();
        const callbackProbe = createCallbackProbe({
          pauseAfterConnectionCreate: true,
        });
        const deletionProbe = createDeletionProbe();
        boundary.callbackPrisma = wrapCallbackPrismaClient(
          fixture.callbackBaseClient,
          callbackProbe,
        );
        const deletionClient = wrapDeletionPrismaClient(
          fixture.deletionBaseClient,
          deletionProbe,
        );
        const completionOrder: string[] = [];
        let callbackPromise: Promise<Response> | null = null;
        let deletionPromise: Promise<HostedAccountDeletionResult> | null = null;

        try {
          callbackPromise = invokeClinicalRecordsCallback(fixture).then(
            (response) => {
              completionOrder.push("callback");
              return response;
            },
          );
          await bounded(
            callbackProbe.createPause!.reached.promise,
            BLOCKING_TIMEOUT_MS,
            "the delegated Clinical Records connection insert",
          );
          const callbackBackendPid = await bounded(
            callbackProbe.persistenceBackendPid.promise,
            BLOCKING_TIMEOUT_MS,
            "the callback transaction backend pid",
          );

          deletionPromise = deleteHostedAccountData({
            memberId: fixture.memberId,
            prisma: deletionClient,
            request: new Request(`${CALLBACK_ORIGIN}/settings/privacy`),
          }).then((result) => {
            completionOrder.push("deletion");
            return result;
          });
          const deletionBackendPid = await bounded(
            deletionProbe.firstTransactionBackendPid.promise,
            BLOCKING_TIMEOUT_MS,
            "the deletion contender backend pid",
          );
          await waitForBlockedBackend({
            blockerPid: callbackBackendPid,
            observer: fixture.observer,
            waiterPid: deletionBackendPid,
          });

          callbackProbe.createPause!.release.resolve();
          const callbackResponse = await bounded(
            callbackPromise,
            CALLBACK_TIMEOUT_MS,
            "the callback winner",
          );
          const deletionResult = await bounded(
            deletionPromise,
            CALLBACK_TIMEOUT_MS,
            "account deletion after the callback commit",
          );

          expectConnectedRedirect(callbackResponse);
          expect(completionOrder).toEqual(["callback", "deletion"]);
          expect(deletionResult.deletedCounts).toMatchObject({
            "prisma.clinical_record_connect_intent": 1,
            "prisma.clinical_record_connection": 1,
            "prisma.clinical_record_oauth_session": 1,
            "prisma.clinical_record_retrieval_run": 1,
            "prisma.hosted_mailbox_item": 1,
            "prisma.hosted_member": 1,
          });
          expect(
            externalEdges.signalHostedMailboxAppendRuntime,
          ).toHaveBeenCalledTimes(1);
          await expectMemberAndClinicalPersistenceDeleted(fixture);
        } finally {
          callbackProbe.createPause?.release.resolve();
          await settleOperations([callbackPromise, deletionPromise]);
          await cleanupClinicalFixture(fixture);
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "lets account deletion own the member row and forces the waiting callback to fail closed",
      async () => {
        const fixture = await createClinicalFixture();
        const callbackProbe = createCallbackProbe();
        const deletionProbe = createDeletionProbe({
          pauseAfterSecondThreadContainerRead: true,
        });
        const ingressBarrier = createIngressDecryptBarrier();
        boundary.ingressDecryptBarrier = ingressBarrier;
        boundary.callbackPrisma = wrapCallbackPrismaClient(
          fixture.callbackBaseClient,
          callbackProbe,
        );
        const deletionClient = wrapDeletionPrismaClient(
          fixture.deletionBaseClient,
          deletionProbe,
        );
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        let callbackPromise: Promise<Response> | null = null;
        let deletionPromise: Promise<HostedAccountDeletionResult> | null = null;

        try {
          callbackPromise = invokeClinicalRecordsCallback(fixture);
          await bounded(
            ingressBarrier.started.promise,
            BLOCKING_TIMEOUT_MS,
            "the callback ingress prewarm",
          );
          expect(callbackProbe.persistenceTransactionStarted).toBe(false);

          deletionPromise = deleteHostedAccountData({
            memberId: fixture.memberId,
            prisma: deletionClient,
            request: new Request(`${CALLBACK_ORIGIN}/settings/privacy`),
          });
          await bounded(
            deletionProbe.secondThreadContainerReadPause!.reached.promise,
            CALLBACK_TIMEOUT_MS,
            "the delegated second thread-container read",
          );
          const deletionBackendPid = await bounded(
            deletionProbe.secondThreadContainerReadPause!.backendPid.promise,
            BLOCKING_TIMEOUT_MS,
            "the final deletion transaction backend pid",
          );
          expect(deletionProbe.threadContainerReadCount).toBe(2);

          ingressBarrier.release.resolve();
          const callbackBackendPid = await bounded(
            callbackProbe.persistenceBackendPid.promise,
            BLOCKING_TIMEOUT_MS,
            "the waiting callback transaction backend pid",
          );
          await waitForBlockedBackend({
            blockerPid: deletionBackendPid,
            observer: fixture.observer,
            waiterPid: callbackBackendPid,
          });
          await expectNoClinicalPersistence(fixture);
          expect(
            externalEdges.signalHostedMailboxAppendRuntime,
          ).not.toHaveBeenCalled();

          deletionProbe.secondThreadContainerReadPause!.release.resolve();
          const deletionResult = await bounded(
            deletionPromise,
            CALLBACK_TIMEOUT_MS,
            "account deletion",
          );
          const callbackResponse = await bounded(
            callbackPromise,
            CALLBACK_TIMEOUT_MS,
            "the fail-closed callback",
          );

          expectFailedRedirect(callbackResponse);
          expect(deletionResult.deletedCounts).toMatchObject({
            "prisma.clinical_record_connect_intent": 1,
            "prisma.clinical_record_connection": 0,
            "prisma.clinical_record_oauth_session": 1,
            "prisma.clinical_record_retrieval_run": 0,
            "prisma.hosted_mailbox_item": 0,
            "prisma.hosted_member": 1,
          });
          expect(
            externalEdges.signalHostedMailboxAppendRuntime,
          ).not.toHaveBeenCalled();
          expect(warning).toHaveBeenCalledWith(
            "Clinical Records OAuth callback failed.",
            expect.objectContaining({
              code: "UNEXPECTED",
              errorType: "unexpected",
            }),
          );
          await expectMemberAndClinicalPersistenceDeleted(fixture);
        } finally {
          ingressBarrier.release.resolve();
          deletionProbe.secondThreadContainerReadPause?.release.resolve();
          await settleOperations([callbackPromise, deletionPromise]);
          await cleanupClinicalFixture(fixture);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createIngressDecryptBarrier(): IngressDecryptBarrier {
  return {
    release: createDeferred(),
    started: createDeferred(),
  };
}

function createCallbackProbe(
  options: { pauseAfterConnectionCreate?: boolean } = {},
): CallbackProbe {
  return {
    createPause: options.pauseAfterConnectionCreate
      ? {
          reached: createDeferred(),
          release: createDeferred(),
        }
      : null,
    ingressRootReads: 0,
    ingressRootReadsDuringPersistence: 0,
    persistenceBackendPid: createDeferred<number>(),
    persistenceTransactionStarted: false,
    transactionCount: 0,
  };
}

function createDeletionProbe(
  options: { pauseAfterSecondThreadContainerRead?: boolean } = {},
): DeletionProbe {
  return {
    firstTransactionBackendPid: createDeferred<number>(),
    secondThreadContainerReadPause:
      options.pauseAfterSecondThreadContainerRead
        ? {
            backendPid: createDeferred<number>(),
            reached: createDeferred(),
            release: createDeferred(),
          }
        : null,
    threadContainerReadCount: 0,
    transactionCount: 0,
  };
}

async function createClinicalFixture(): Promise<ClinicalFixture> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the PostgreSQL proof.");
  }
  const fixtureId = randomUUID();
  const memberId = `member_clinical_delete_${fixtureId}`;
  const sessionId = `hws_clinical_delete_${fixtureId}`;
  const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
  const callbackBaseClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const deletionBaseClient = createPrismaClient({ databaseUrl, poolMax: 1 });
  const now = new Date();
  const provider = readClinicalProviderDirectory().entries[0];
  if (!provider) {
    throw new Error("Expected a Clinical Records provider fixture.");
  }
  const secondResourceType = provider.resourceTypes.find(
    (resourceType) => resourceType !== "Patient",
  );
  if (!secondResourceType) {
    throw new Error("Expected the provider to expose a non-Patient resource.");
  }

  try {
    const member = await observer.hostedMember.create({
      data: {
        billingStatus: HostedBillingStatus.not_started,
        id: memberId,
      },
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
    });
    await provisionHostedCryptoDomainRootsForUser({
      prisma: observer,
      reason: "clinical-records-account-deletion-postgres-proof",
      userId: memberId,
    });
    const domains = await observer.hostedUserCryptoEnvelope.findMany({
      orderBy: { domain: "asc" },
      select: { domain: true, status: true },
      where: {
        domain: { in: ["control", "device", "ingress", "runtime"] },
        status: "active",
        userId: memberId,
      },
    });
    expect(domains).toEqual([
      { domain: "control", status: "active" },
      { domain: "device", status: "active" },
      { domain: "ingress", status: "active" },
      { domain: "runtime", status: "active" },
    ]);
    for (const scope of ["launch.legal", "launch.health-data"] as const) {
      await recordHostedLaunchRequiredConsent({
        memberId,
        now,
        prisma: observer,
        scope,
        source: "clinical-records-account-deletion-postgres-proof",
      });
    }

    const { state, stateHash } = createSmartState();
    const connectIntentClaimHash = createHash("sha256")
      .update(`clinical-records-intent:${fixtureId}`)
      .digest("hex");
    const requestedScopes = [
      ...provider.requestedBaseScopes,
      "patient/Patient.rs",
      `patient/${secondResourceType}.rs`,
    ];
    const codeVerifierEncrypted = await sealClinicalOauthVerifier({
      memberId,
      prisma: observer,
      stateHash,
      value: randomBytes(32).toString("base64url"),
    });
    const fhirBaseHash = createHash("sha256")
      .update(provider.fhirBaseUrl)
      .digest("hex");
    const tokenEndpoint = new URL(
      "/oauth2/token",
      provider.fhirBaseUrl,
    ).toString();
    await observer.$transaction(async (tx) => {
      await tx.clinicalRecordConnectIntent.create({
        data: {
          claimHash: connectIntentClaimHash,
          completedAt: null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
          memberId,
          providerDirectoryEntryId: provider.id,
          startedAt: now,
        },
      });
      await tx.clinicalRecordOauthSession.create({
        data: {
          clientId: "clinical-records-postgres-proof-client",
          codeVerifierEncrypted,
          connectIntentClaimHash,
          consumedAt: null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
          fhirBaseHash,
          memberId,
          providerDirectoryEntryId: provider.id,
          redirectUri: `${CALLBACK_ORIGIN}${CALLBACK_PATH}`,
          requestedScopesJson: requestedScopes,
          stateHash,
          tokenEndpoint,
          webSessionId: sessionId,
        },
      });
    });

    boundary.authSession = {
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      member,
      privyUserId: `did:privy:clinical-records-proof-${fixtureId}`,
      sessionId,
    };
    boundary.token = {
      accessToken: `clinical-records-access-token-${fixtureId}`,
      expiresInSeconds: 3_600,
      grantedScopes: [
        "patient/Patient.rs",
        `patient/${secondResourceType}.rs`,
      ],
      patientId: `patient-${fixtureId}`,
    };
    resetCryptoObservations();

    return {
      callbackBaseClient,
      connectIntentClaimHash,
      deletionBaseClient,
      memberId,
      observer,
      providerDirectoryEntryId: provider.id,
      sessionId,
      state,
      stateHash,
    };
  } catch (error) {
    await Promise.allSettled([
      observer.hostedMember.deleteMany({ where: { id: memberId } }),
    ]);
    await Promise.allSettled([
      observer.$disconnect(),
      callbackBaseClient.$disconnect(),
      deletionBaseClient.$disconnect(),
    ]);
    throw error;
  }
}

async function cleanupClinicalFixture(fixture: ClinicalFixture): Promise<void> {
  const cleanupIds = [...boundary.cleanupIds];
  if (cleanupIds.length > 0) {
    await fixture.observer.hostedAccountDeletionCleanup.deleteMany({
      where: { id: { in: cleanupIds } },
    });
  }
  await fixture.observer.hostedMember.deleteMany({
    where: { id: fixture.memberId },
  });
  await Promise.all([
    fixture.callbackBaseClient.$disconnect(),
    fixture.deletionBaseClient.$disconnect(),
    fixture.observer.$disconnect(),
  ]);
}

function invokeClinicalRecordsCallback(
  fixture: ClinicalFixture,
): Promise<Response> {
  const url = new URL(CALLBACK_PATH, CALLBACK_ORIGIN);
  url.searchParams.set("state", fixture.state);
  url.searchParams.set("code", "clinical-records-postgres-proof-code");
  return clinicalRecordsCallbackGet(new Request(url));
}

function wrapCallbackPrismaClient(
  client: PrismaClient,
  probe: CallbackProbe,
): PrismaClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === "$queryRaw") {
        return (...args: unknown[]) => {
          observeIngressRootRead(args, probe);
          return Reflect.apply(target.$queryRaw, target, args);
        };
      }
      if (property === "$transaction") {
        return (operation: unknown, options?: unknown) => {
          if (typeof operation !== "function") {
            return Reflect.apply(target.$transaction, target, [
              operation,
              options,
            ]);
          }
          probe.transactionCount += 1;
          const transactionNumber = probe.transactionCount;
          const callback = operation as (
            tx: Prisma.TransactionClient,
          ) => unknown;
          return Reflect.apply(target.$transaction, target, [
            async (tx: Prisma.TransactionClient) => {
              const backendPid = await readBackendPid(tx);
              const persistenceTransaction = transactionNumber === 2;
              if (persistenceTransaction) {
                probe.persistenceTransactionStarted = true;
                probe.persistenceBackendPid.resolve(backendPid);
                boundary.persistenceTransactionActive = true;
              }
              try {
                return await callback(
                  wrapCallbackTransactionClient(tx, probe),
                );
              } finally {
                if (persistenceTransaction) {
                  boundary.persistenceTransactionActive = false;
                }
              }
            },
            options,
          ]);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapCallbackTransactionClient(
  tx: Prisma.TransactionClient,
  probe: CallbackProbe,
): Prisma.TransactionClient {
  const clinicalRecordConnection = new Proxy(tx.clinicalRecordConnection, {
    get(target, property) {
      if (property === "create") {
        return async (args: Prisma.ClinicalRecordConnectionCreateArgs) => {
          const created = await target.create(args);
          if (probe.createPause) {
            probe.createPause.reached.resolve();
            await probe.createPause.release.promise;
          }
          return created;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy(tx, {
    get(target, property) {
      if (property === "clinicalRecordConnection") {
        return clinicalRecordConnection;
      }
      if (property === "$queryRaw") {
        return (...args: unknown[]) => {
          observeIngressRootRead(args, probe);
          return Reflect.apply(target.$queryRaw, target, args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapDeletionPrismaClient(
  client: PrismaClient,
  probe: DeletionProbe,
): PrismaClient {
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return (operation: unknown, options?: unknown) => {
          if (typeof operation !== "function") {
            return Reflect.apply(target.$transaction, target, [
              operation,
              options,
            ]);
          }
          probe.transactionCount += 1;
          const transactionNumber = probe.transactionCount;
          const callback = operation as (
            tx: Prisma.TransactionClient,
          ) => unknown;
          return Reflect.apply(target.$transaction, target, [
            async (tx: Prisma.TransactionClient) => {
              const backendPid = await readBackendPid(tx);
              if (transactionNumber === 1) {
                probe.firstTransactionBackendPid.resolve(backendPid);
              }
              return await callback(
                wrapDeletionTransactionClient({
                  backendPid,
                  probe,
                  tx,
                }),
              );
            },
            options,
          ]);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapDeletionTransactionClient(input: {
  backendPid: number;
  probe: DeletionProbe;
  tx: Prisma.TransactionClient;
}): Prisma.TransactionClient {
  const hostedThreadContainer = new Proxy(input.tx.hostedThreadContainer, {
    get(target, property) {
      if (property === "findMany") {
        return async (args: Prisma.HostedThreadContainerFindManyArgs) => {
          const rows = await target.findMany(args);
          input.probe.threadContainerReadCount += 1;
          if (
            input.probe.threadContainerReadCount === 2 &&
            input.probe.secondThreadContainerReadPause
          ) {
            input.probe.secondThreadContainerReadPause.backendPid.resolve(
              input.backendPid,
            );
            input.probe.secondThreadContainerReadPause.reached.resolve();
            await input.probe.secondThreadContainerReadPause.release.promise;
          }
          return rows;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy(input.tx, {
    get(target, property) {
      if (property === "hostedThreadContainer") {
        return hostedThreadContainer;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function observeIngressRootRead(
  args: readonly unknown[],
  probe: CallbackProbe,
): void {
  const template = args[0];
  const sql = Array.isArray(template) ? template.join(" ") : "";
  if (
    !sql.includes("FROM hosted_user_crypto_envelope") ||
    !args.slice(1).includes("ingress")
  ) {
    return;
  }
  probe.ingressRootReads += 1;
  if (boundary.persistenceTransactionActive) {
    probe.ingressRootReadsDuringPersistence += 1;
  }
}

async function readBackendPid(
  tx: Prisma.TransactionClient,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid() AS pid
  `;
  const pid = rows[0]?.pid;
  if (typeof pid !== "number") {
    throw new Error("Expected a PostgreSQL backend pid.");
  }
  return pid;
}

async function waitForBlockedBackend(input: {
  blockerPid: number;
  observer: PrismaClient;
  waiterPid: number;
}): Promise<void> {
  const deadline = Date.now() + BLOCKING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await input.observer.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT ${input.blockerPid} = ANY(pg_blocking_pids(${input.waiterPid})) AS blocked
    `;
    if (rows[0]?.blocked === true) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    "Expected PostgreSQL to report the exact transaction blocker.",
  );
}

async function expectNoClinicalPersistence(
  fixture: ClinicalFixture,
): Promise<void> {
  const [connectionCount, runCount, intent, wakeCount] = await Promise.all([
    fixture.observer.clinicalRecordConnection.count({
      where: { memberId: fixture.memberId },
    }),
    fixture.observer.clinicalRecordRetrievalRun.count({
      where: { memberId: fixture.memberId },
    }),
    fixture.observer.clinicalRecordConnectIntent.findUnique({
      where: { claimHash: fixture.connectIntentClaimHash },
    }),
    fixture.observer.hostedMailboxItem.count({
      where: {
        kind: "clinical-records.sync-requested",
        userId: fixture.memberId,
      },
    }),
  ]);
  expect(connectionCount).toBe(0);
  expect(runCount).toBe(0);
  expect(intent?.completedAt).toBeNull();
  expect(wakeCount).toBe(0);
}

async function readClinicalDurableSet(fixture: ClinicalFixture) {
  const [connections, runs, intent, oauthSession, wakes] = await Promise.all([
    fixture.observer.clinicalRecordConnection.findMany({
      where: { memberId: fixture.memberId },
    }),
    fixture.observer.clinicalRecordRetrievalRun.findMany({
      where: { memberId: fixture.memberId },
    }),
    fixture.observer.clinicalRecordConnectIntent.findUnique({
      where: { claimHash: fixture.connectIntentClaimHash },
    }),
    fixture.observer.clinicalRecordOauthSession.findUnique({
      where: { stateHash: fixture.stateHash },
    }),
    fixture.observer.hostedMailboxItem.findMany({
      where: {
        kind: "clinical-records.sync-requested",
        userId: fixture.memberId,
      },
    }),
  ]);
  const wakePayload =
    wakes[0]?.payloadInlineCiphertext ??
    (wakes[0]
      ? (
          await fixture.observer.hostedMailboxPayload.findUnique({
            where: { mailboxItemId: wakes[0].id },
          })
        )?.payloadCiphertext
      : null);
  return {
    connections,
    intent,
    oauthSession,
    runs,
    wakePayload,
    wakes,
  };
}

function expectAtomicClinicalDurableSet(
  durable: ClinicalDurableSet,
  fixture: ClinicalFixture,
): void {
  expect(durable.connections).toHaveLength(1);
  expect(durable.runs).toHaveLength(1);
  expect(durable.wakes).toHaveLength(1);
  expect(durable.intent?.completedAt).toBeInstanceOf(Date);
  expect(durable.oauthSession?.consumedAt).toBeInstanceOf(Date);

  const connection = durable.connections[0]!;
  const run = durable.runs[0]!;
  const wake = durable.wakes[0]!;
  expect(connection).toMatchObject({
    memberId: fixture.memberId,
    providerDirectoryEntryId: fixture.providerDirectoryEntryId,
    retrievalGeneration: 1,
    status: "active",
  });
  expect(run).toMatchObject({
    connectionId: connection.id,
    generation: 1,
    memberId: fixture.memberId,
    status: "queued",
  });
  expect(wake).toMatchObject({
    consumedAt: null,
    dedupeKey: buildClinicalRetrievalWakeEventId({
      generation: 1,
      runId: run.id,
    }),
    kind: "clinical-records.sync-requested",
    lane: "system",
    userId: fixture.memberId,
  });
  expect(durable.wakePayload).toEqual(expect.any(String));

  expect(
    parseSerializedHostedSecureBoxEnvelope(connection.fhirBaseUrlEncrypted),
  ).toMatchObject({
    domain: "control",
    lane: "clinical-records-oauth",
  });
  expect(
    parseSerializedHostedSecureBoxEnvelope(connection.patientIdEncrypted!),
  ).toMatchObject({
    domain: "device",
    lane: "clinical-records-patient-id",
  });
  expect(
    parseSerializedHostedSecureBoxEnvelope(connection.accessTokenEncrypted!),
  ).toMatchObject({
    domain: "device",
    lane: "clinical-records-token",
  });
  expect(
    parseSerializedHostedSecureBoxEnvelope(durable.wakePayload!),
  ).toMatchObject({
    domain: "ingress",
    lane: "mailbox-payload",
  });
}

async function expectMemberAndClinicalPersistenceDeleted(
  fixture: ClinicalFixture,
): Promise<void> {
  const [
    memberCount,
    connectionCount,
    runCount,
    intentCount,
    oauthCount,
    wakeCount,
  ] = await Promise.all([
    fixture.observer.hostedMember.count({
      where: { id: fixture.memberId },
    }),
    fixture.observer.clinicalRecordConnection.count({
      where: { memberId: fixture.memberId },
    }),
    fixture.observer.clinicalRecordRetrievalRun.count({
      where: { memberId: fixture.memberId },
    }),
    fixture.observer.clinicalRecordConnectIntent.count({
      where: { memberId: fixture.memberId },
    }),
    fixture.observer.clinicalRecordOauthSession.count({
      where: { memberId: fixture.memberId },
    }),
    fixture.observer.hostedMailboxItem.count({
      where: { userId: fixture.memberId },
    }),
  ]);
  expect({
    connectionCount,
    intentCount,
    memberCount,
    oauthCount,
    runCount,
    wakeCount,
  }).toEqual({
    connectionCount: 0,
    intentCount: 0,
    memberCount: 0,
    oauthCount: 0,
    runCount: 0,
    wakeCount: 0,
  });
}

function expectConnectedRedirect(response: Response): void {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    `${CALLBACK_ORIGIN}/records?clinicalRecords=connected`,
  );
}

function expectFailedRedirect(response: Response): void {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    `${CALLBACK_ORIGIN}/records?clinicalRecords=failed`,
  );
}

async function bounded<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label}.`));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function settleOperations(
  operations: ReadonlyArray<Promise<unknown> | null>,
): Promise<void> {
  const pending = operations.filter(
    (operation): operation is Promise<unknown> => operation !== null,
  );
  if (pending.length === 0) {
    return;
  }
  await bounded(
    Promise.allSettled(pending).then(() => undefined),
    CALLBACK_TIMEOUT_MS,
    "test operations to settle",
  );
}

function resetBoundaries(): void {
  boundary.authSession = null;
  boundary.callbackPrisma = null;
  boundary.cleanupIds.clear();
  boundary.ingressDecryptBarrier = null;
  resetCryptoObservations();
  boundary.token = null;
  externalEdges.deleteHostedRuntimeLogDataForUsers.mockReset();
  externalEdges.deleteHostedRunnerUserDataBestEffort.mockReset();
  externalEdges.deleteMemberExternalStateForAccountDeletion.mockReset();
  externalEdges.exchangeSmartAuthorizationCode.mockReset();
  externalEdges.requireActiveHostedAppSessionFromRequest.mockReset();
  externalEdges.signalHostedMailboxAppendRuntime.mockReset();
  externalEdges.terminateHostedUserRuntimeWorkflowBestEffort.mockReset();
}

function resetCryptoObservations(): void {
  boundary.ingressDecryptCalls = 0;
  boundary.ingressDecryptsDuringPersistence = 0;
  boundary.persistenceTransactionActive = false;
}

function isIngressDomainRootAad(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.domain === "ingress"
      && parsed.purpose === "hosted-domain-root-wrap";
  } catch {
    return false;
  }
}

function readCleanupIdFromAad(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed.schema === "murph.hosted-account-deletion-cleanup.v1"
      && typeof parsed.id === "string"
      ? parsed.id
      : null;
  } catch {
    return null;
  }
}

function completedRunnerDeletionResult() {
  return {
    alarmCleared: true,
    configured: true,
    deleteAllCompleted: true,
    deleted: true,
    errorCode: null,
    r2DeletedObjectCount: 0,
    r2SkippedUserScopedPrefixes: false,
    r2Supported: true,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: true,
  };
}

const CRYPTO_AND_ORIGIN_ENV_KEYS = [
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK",
  "HOSTED_CRYPTO_ENV",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION",
  "HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM",
  "HOSTED_CRYPTO_GCP_KMS_API_ROOT",
  "HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME",
  "HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK",
  "HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY",
  "HOSTED_ONBOARDING_PUBLIC_BASE_URL",
  "HOSTED_WEB_BASE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

function configureLocalCryptoAndPublicOrigin(): () => void {
  const previous = new Map(
    CRYPTO_AND_ORIGIN_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const authorityKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  const automationKey = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "jwk" },
    publicKeyEncoding: { format: "jwk" },
  });
  Object.assign(process.env, {
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
      "clinical-records-postgres-proof-automation-key",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK:
      JSON.stringify(automationKey.publicKey),
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION:
      "projects/test/locations/global/keyRings/test/cryptoKeys/authority/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: authorityKey.publicKey,
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME:
      "projects/test/locations/global/keyRings/test/cryptoKeys/web-wrap",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK:
      JSON.stringify(authorityKey.privateKey),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY:
      Buffer.alloc(32, 17).toString("base64"),
    HOSTED_ONBOARDING_PUBLIC_BASE_URL: CALLBACK_ORIGIN,
  });
  delete process.env.HOSTED_WEB_BASE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function installDefaultHostedSecureBoxStringTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = JSON.parse(
        Buffer.from(
          input.value.replace(/^hsb-test:/u, ""),
          "base64url",
        ).toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
