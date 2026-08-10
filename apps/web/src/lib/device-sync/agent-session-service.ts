import { randomUUID } from "node:crypto";

import { deviceSyncError } from "@murphai/device-syncd/errors";

import type {
  DeviceSyncRegistry,
  DeviceSyncProvider,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/types";
import {
  HostedAgentSessionService,
  type HostedAgentUser,
} from "../hosted-agent-sessions";
import { getPrisma } from "../prisma";
import {
  requireHostedDeviceSyncStoredTokenBundle,
} from "./internal-runtime";
import type { HostedLocalHeartbeatPatch } from "./local-heartbeat";
import { readHostedDeviceSyncEnvironment } from "./env";
import type { HostedDeviceSyncEnvironment } from "./env";
import {
  type HostedAgentSessionRecord,
  type HostedPrismaTransactionClient,
  type HostedStoredDeviceSyncAccount,
  PrismaDeviceSyncControlPlaneStore,
  sanitizeHostedDeviceSyncConnectionMetadata,
} from "./prisma-store";
import {
  buildStoredTokenBundle,
  buildTokenExport,
  type HostedStoredTokenBundle,
  type HostedTokenExport,
  shouldRefreshHostedToken,
} from "./agent-session-token-bundle";
import {
  type HostedProviderTokenRefreshResult,
  persistProviderTokenRefreshErrorStatus,
  refreshProviderTokens,
} from "./agent-session-token-refresh";
import { toIsoTimestamp } from "./shared";

export type { HostedTokenExport } from "./agent-session-token-bundle";

export interface HostedTokenBundleExportResponse {
  connection: PublicDeviceSyncAccount;
  tokenBundle: HostedTokenExport;
}

export interface HostedTokenBundleRefreshResponse extends HostedTokenBundleExportResponse {
  refreshed: boolean;
  tokenVersionChanged: boolean;
}

export interface HostedDeviceSyncAgentSessionContext {
  readonly agentSessions: HostedDeviceSyncAgentSessionService;
  readonly env: HostedDeviceSyncEnvironment;
  readonly store: PrismaDeviceSyncControlPlaneStore;
}

export type HostedDeviceSyncRefreshProviderResolver = (input: {
  connectionId: string;
  prisma: PrismaDeviceSyncControlPlaneStore["prisma"];
  providerId: string;
  userId: string;
}) => Promise<DeviceSyncProvider | null>;

export type HostedDeviceSyncTokenExportAuthorityValidator = (input: {
  connectionId: string;
  prisma:
    | PrismaDeviceSyncControlPlaneStore["prisma"]
    | HostedPrismaTransactionClient;
  providerId: string;
  userId: string;
}) => Promise<void>;

export interface HostedDeviceSyncAgentSessionOptions {
  readonly assertTokenExportAuthority?: HostedDeviceSyncTokenExportAuthorityValidator | null;
  readonly registry?: DeviceSyncRegistry | null;
  readonly resolveRefreshProvider?: HostedDeviceSyncRefreshProviderResolver | null;
}

const HOSTED_DEVICE_SYNC_AGENT_PAIR_PATH = "/api/device-sync/agents/pair";
const HOSTED_DEVICE_TOKEN_REFRESH_LEASE_TTL_MS = 5 * 60_000;
const HOSTED_DEVICE_TOKEN_REFRESH_PERSIST_ATTEMPTS = 3;
const HOSTED_DEVICE_SYNC_AGENT_AUTH_MESSAGES = {
  required:
    "Hosted device-sync agent routes require a bearer token created by /api/device-sync/agents/pair.",
  expired: "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
  invalid: "Hosted device-sync agent bearer token is invalid or revoked.",
} as const;

type HostedTokenRefreshSuccess = {
  status: "success";
  connection: PublicDeviceSyncAccount;
  tokenBundle: HostedTokenExport;
  refreshed: boolean;
  tokenVersionChanged: boolean;
};

type HostedTokenRefreshRequiredResult = {
  status: "refresh_required";
  account: HostedStoredDeviceSyncAccount;
  currentTokenBundle: HostedStoredTokenBundle;
};

type HostedTokenRefreshCurrentResult =
  | HostedTokenRefreshSuccess
  | HostedTokenRefreshRequiredResult;

type HostedTokenRefreshLockResult =
  | HostedTokenRefreshCurrentResult
  | {
      status: "stale_refresh_lease";
      currentTokenBundle: HostedStoredTokenBundle;
    };

type HostedTokenRefreshLeaseResult =
  | HostedTokenRefreshSuccess
  | {
      status: "lease_claimed";
      account: HostedStoredDeviceSyncAccount;
      currentTokenBundle: HostedStoredTokenBundle;
      leaseOwner: string;
    };

type HostedTokenRefreshPersistResult =
  | HostedTokenRefreshSuccess
  | { status: "refresh_error"; error: unknown };

type HostedTokenRefreshStaleLeaseResult =
  | HostedTokenRefreshSuccess
  | { status: "stale_failed_closed"; error: unknown };

type HostedTokenRefreshLeaseStatus =
  | { status: "none" }
  | { status: "in_progress"; leaseExpiresAt: string }
  | { status: "stale" };

type HostedTokenExportResponseResult = HostedTokenBundleExportResponse & {
  status?: undefined;
};

type HostedTokenExportLockResult =
  | HostedTokenExportResponseResult
  | {
      status: "stale_refresh_lease";
      currentTokenBundle: HostedStoredTokenBundle;
    };

export class HostedDeviceSyncAgentSessionService {
  readonly store: PrismaDeviceSyncControlPlaneStore;
  readonly agentSessions: HostedAgentSessionService;
  private registry: DeviceSyncRegistry | null;
  private readonly resolveRefreshProvider:
    | HostedDeviceSyncRefreshProviderResolver
    | null;
  private readonly assertTokenExportAuthority:
    | HostedDeviceSyncTokenExportAuthorityValidator
    | null;

  constructor(input: {
    request: Request;
    store: PrismaDeviceSyncControlPlaneStore;
    assertTokenExportAuthority?: HostedDeviceSyncTokenExportAuthorityValidator | null;
    registry?: DeviceSyncRegistry | null;
    resolveRefreshProvider?: HostedDeviceSyncRefreshProviderResolver | null;
  }) {
    this.store = input.store;
    this.registry = input.registry ?? null;
    this.resolveRefreshProvider = input.resolveRefreshProvider ?? null;
    this.assertTokenExportAuthority = input.assertTokenExportAuthority ?? null;
    this.agentSessions = new HostedAgentSessionService({
      request: input.request,
      store: input.store,
      pairPath: HOSTED_DEVICE_SYNC_AGENT_PAIR_PATH,
      messages: HOSTED_DEVICE_SYNC_AGENT_AUTH_MESSAGES,
    });
  }

  async requireAgentSession() {
    return this.agentSessions.requireAgentSession();
  }

  async createAgentSession(
    user: HostedAgentUser,
    label: string | null,
  ): Promise<{
    agent: { id: string; label: string | null; createdAt: string; expiresAt: string };
    token: string;
  }> {
    return this.agentSessions.createAgentSession(user, label);
  }

  async exportTokenBundle(
    session: HostedAgentSessionRecord,
    connectionId: string,
  ): Promise<HostedTokenBundleExportResponse> {
    const now = toIsoTimestamp(new Date());
    const result = await this.store.withConnectionMutationLock<HostedTokenExportLockResult>(
      connectionId,
      async (tx) => {
        const record = await tx.deviceConnection.findFirst({
          where: {
            id: connectionId,
            userId: session.userId,
          },
          select: {
            credentialKind: true,
            id: true,
          },
        });

        if (!record) {
          throw deviceSyncError({
            code: "CONNECTION_NOT_FOUND",
            message: "Hosted device-sync connection was not found for the current user.",
            retryable: false,
            httpStatus: 404,
          });
        }

        const storedAccount = await this.store.getStoredConnectionAccountForUser(session.userId, connectionId, tx);
        if (!storedAccount) {
          throwIfHostedTokenBundleUnsupported(record, connectionId);
          throw deviceSyncError({
            code: "CONNECTION_SECRET_MISSING",
            message: "Hosted device-sync connection no longer has a stored token bundle.",
            retryable: false,
            httpStatus: 409,
          });
        }
        throwIfHostedTokenBundleUnsupported(record, connectionId);
        throwIfHostedTokenBundleUnsupported({
          credentialKind: storedAccount.credential.kind,
        }, connectionId);
        throwIfHostedTokenBundleAccountInactive(storedAccount, connectionId);

        const storedTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
          connectionId,
          storedTokenBundle: buildStoredTokenBundle(storedAccount),
          userId: session.userId,
        });
        const leaseStatus = await this.readRefreshLeaseStatus({
          connectionId,
          now,
          tokenVersion: storedTokenBundle.tokenVersion,
          tx,
          userId: session.userId,
        });
        if (leaseStatus.status === "in_progress") {
          throw buildHostedTokenRefreshInProgressError(leaseStatus.leaseExpiresAt);
        }
        if (leaseStatus.status === "stale") {
          return {
            status: "stale_refresh_lease",
            currentTokenBundle: storedTokenBundle,
          };
        }

        const tokenBundle = await this.buildAuthorizedTokenExport({
          connectionId,
          now,
          prisma: tx,
          providerId: storedAccount.provider,
          storedTokenBundle,
          userId: session.userId,
        });
        await this.recordTokenAudit({
          userId: session.userId,
          connectionId,
          provider: storedAccount.provider,
          action: "token_exported",
          channel: "agent_export",
          sessionId: session.id,
          tokenVersion: tokenBundle.tokenVersion,
          keyVersion: tokenBundle.keyVersion,
          createdAt: now,
          tx,
        });

        return {
          connection: toPublicHostedDeviceSyncAccount(storedAccount),
          tokenBundle,
        } satisfies HostedTokenExportResponseResult;
      },
    );

    if (result.status === "stale_refresh_lease") {
      let resolvedResult: HostedTokenRefreshSuccess;
      try {
        resolvedResult = await this.failClosedStaleRefreshLease({
          baseTokenBundle: result.currentTokenBundle,
          connectionId,
          forceRefresh: false,
          now,
          session,
        });
      } catch (error) {
        await this.assertCurrentAgentSessionStillActive();
        throw error;
      }
      await this.assertCurrentAgentSessionStillActive();
      return {
        connection: resolvedResult.connection,
        tokenBundle: resolvedResult.tokenBundle,
      };
    }

    await this.assertCurrentAgentSessionStillActive();

    return result;
  }

  async refreshTokenBundle(
    session: HostedAgentSessionRecord,
    connectionId: string,
    options: { expectedTokenVersion?: number | null; force?: boolean } = {},
  ): Promise<HostedTokenBundleRefreshResponse> {
    const now = toIsoTimestamp(new Date());
    const forceRefresh = options.force === true;

    const result = await this.store.withConnectionMutationLock<HostedTokenRefreshLockResult>(connectionId, async (tx) => {
      const record = await tx.deviceConnection.findFirst({
        where: {
          id: connectionId,
          userId: session.userId,
        },
        select: {
          credentialKind: true,
          id: true,
        },
      });

      if (!record) {
        throw deviceSyncError({
          code: "CONNECTION_NOT_FOUND",
          message: "Hosted device-sync connection was not found for the current agent user.",
          retryable: false,
          httpStatus: 404,
        });
      }

      const currentAccount = await this.store.getStoredConnectionAccountForUser(session.userId, connectionId, tx);
      if (!currentAccount) {
        throwIfHostedTokenBundleUnsupported(record, connectionId);
        throw deviceSyncError({
          code: "CONNECTION_SECRET_MISSING",
          message: "Hosted device-sync connection no longer has a stored token bundle.",
          retryable: false,
          httpStatus: 409,
        });
      }
      throwIfHostedTokenBundleUnsupported({
        credentialKind: currentAccount.credential.kind,
      }, connectionId);
      throwIfHostedTokenBundleAccountInactive(currentAccount, connectionId);

      const currentTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
        connectionId,
        storedTokenBundle: buildStoredTokenBundle(currentAccount),
        userId: session.userId,
      });

      const refreshLeaseStatus = await this.readRefreshLeaseStatus({
        connectionId,
        now,
        tokenVersion: currentTokenBundle.tokenVersion,
        tx,
        userId: session.userId,
      });
      if (refreshLeaseStatus.status === "in_progress") {
        throw buildHostedTokenRefreshInProgressError(refreshLeaseStatus.leaseExpiresAt);
      }
      if (refreshLeaseStatus.status === "stale") {
        return {
          status: "stale_refresh_lease",
          currentTokenBundle,
        };
      }

      const currentConnection = currentAccount;
      const publicCurrentConnection = toPublicHostedDeviceSyncAccount(currentAccount);

      if (
        typeof options.expectedTokenVersion === "number" &&
        options.expectedTokenVersion > 0 &&
        currentTokenBundle.tokenVersion !== options.expectedTokenVersion
      ) {
        const tokenBundle = await this.buildAuthorizedTokenExport({
          connectionId,
          now,
          prisma: tx,
          providerId: currentConnection.provider,
          storedTokenBundle: currentTokenBundle,
          userId: session.userId,
        });
        await this.recordTokenAudit({
          userId: session.userId,
          connectionId,
          provider: currentConnection.provider,
          action: "token_exported",
          channel: "agent_refresh",
          sessionId: session.id,
          tokenVersion: tokenBundle.tokenVersion,
          keyVersion: tokenBundle.keyVersion,
          createdAt: now,
          expectedTokenVersion: options.expectedTokenVersion,
          refreshOutcome: "skipped_version_mismatch",
          tokenVersionChanged: true,
          tx,
        });

        return {
          status: "success",
          connection: publicCurrentConnection,
          tokenBundle,
          refreshed: false,
          tokenVersionChanged: true,
        };
      }

      if (!forceRefresh && !shouldRefreshHostedToken(currentTokenBundle.accessTokenExpiresAt ?? null, now)) {
        const tokenBundle = await this.buildAuthorizedTokenExport({
          connectionId,
          now,
          prisma: tx,
          providerId: currentConnection.provider,
          storedTokenBundle: currentTokenBundle,
          userId: session.userId,
        });
        await this.recordTokenAudit({
          userId: session.userId,
          connectionId,
          provider: currentConnection.provider,
          action: "token_exported",
          channel: "agent_refresh",
          sessionId: session.id,
          tokenVersion: tokenBundle.tokenVersion,
          keyVersion: tokenBundle.keyVersion,
          createdAt: now,
          forceRefresh,
          refreshOutcome: "skipped_fresh",
          tokenVersionChanged: false,
          tx,
        });

        return {
          status: "success",
          connection: publicCurrentConnection,
          tokenBundle,
          refreshed: false,
          tokenVersionChanged: false,
        };
      }

      return {
        status: "refresh_required",
        account: currentAccount,
        currentTokenBundle,
      };
    });

    const finalizedResult = result.status === "refresh_required"
      ? await this.refreshProviderTokensAndPersistIfCurrent({
        baseTokenBundle: result.currentTokenBundle,
        connectionId,
        forceRefresh,
        now,
        session,
      })
      : result.status === "stale_refresh_lease"
        ? await this.failClosedStaleRefreshLease({
          baseTokenBundle: result.currentTokenBundle,
          connectionId,
          forceRefresh,
          now,
          session,
        })
      : result;

    if (finalizedResult.refreshed) {
      await this.recordTokenAudit({
        userId: session.userId,
        connectionId,
        provider: finalizedResult.connection.provider,
        action: "token_refreshed",
        channel: "agent_refresh",
        sessionId: session.id,
        tokenVersion: finalizedResult.tokenBundle.tokenVersion,
        keyVersion: finalizedResult.tokenBundle.keyVersion,
        createdAt: now,
        forceRefresh,
        refreshOutcome: "performed",
      });
      await this.recordTokenAudit({
        userId: session.userId,
        connectionId,
        provider: finalizedResult.connection.provider,
        action: "token_exported",
        channel: "agent_refresh",
        sessionId: session.id,
        tokenVersion: finalizedResult.tokenBundle.tokenVersion,
        keyVersion: finalizedResult.tokenBundle.keyVersion,
        createdAt: now,
        forceRefresh,
        refreshOutcome: "performed",
        tokenVersionChanged: finalizedResult.tokenVersionChanged,
      });
    }

    await this.assertCurrentAgentSessionStillActive();

    return {
      connection: finalizedResult.connection,
      tokenBundle: finalizedResult.tokenBundle,
      refreshed: finalizedResult.refreshed,
      tokenVersionChanged: finalizedResult.tokenVersionChanged,
    };
  }

  private async resolveCurrentRefreshState(input: {
    baseTokenBundle: HostedStoredTokenBundle;
    connectionId: string;
    forceRefresh: boolean;
    now: string;
    session: HostedAgentSessionRecord;
  }): Promise<HostedTokenRefreshCurrentResult> {
    return await this.store.withConnectionMutationLock<HostedTokenRefreshCurrentResult>(input.connectionId, async (tx) => {
      const currentAccount = await this.store.getStoredConnectionAccountForUser(
        input.session.userId,
        input.connectionId,
        tx,
      );
      if (!currentAccount) {
        throw deviceSyncError({
          code: "CONNECTION_SECRET_MISSING",
          message: "Hosted device-sync connection no longer has a stored token bundle.",
          retryable: false,
          httpStatus: 409,
        });
      }
      throwIfHostedTokenBundleUnsupported({
        credentialKind: currentAccount.credential.kind,
      }, input.connectionId);
      throwIfHostedTokenBundleAccountInactive(currentAccount, input.connectionId);

      const currentTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
        connectionId: input.connectionId,
        storedTokenBundle: buildStoredTokenBundle(currentAccount),
        userId: input.session.userId,
      });

      if (currentTokenBundle.tokenVersion !== input.baseTokenBundle.tokenVersion) {
        await this.assertTokenBundleRefreshLeaseExportable({
          connectionId: input.connectionId,
          now: input.now,
          tokenVersion: currentTokenBundle.tokenVersion,
          tx,
          userId: input.session.userId,
        });
        const tokenBundle = await this.buildAuthorizedTokenExport({
          connectionId: input.connectionId,
          now: input.now,
          prisma: tx,
          providerId: currentAccount.provider,
          storedTokenBundle: currentTokenBundle,
          userId: input.session.userId,
        });
        await this.recordTokenAudit({
          userId: input.session.userId,
          connectionId: input.connectionId,
          provider: currentAccount.provider,
          action: "token_exported",
          channel: "agent_refresh",
          sessionId: input.session.id,
          tokenVersion: tokenBundle.tokenVersion,
          keyVersion: tokenBundle.keyVersion,
          createdAt: input.now,
          forceRefresh: input.forceRefresh,
          refreshOutcome: "skipped_version_mismatch",
          tokenVersionChanged: true,
          tx,
        });

        return {
          status: "success",
          connection: toPublicHostedDeviceSyncAccount(currentAccount),
          tokenBundle,
          refreshed: false,
          tokenVersionChanged: true,
        };
      }

      return {
        status: "refresh_required",
        account: currentAccount,
        currentTokenBundle,
      };
    });
  }

  private async refreshProviderTokensAndPersistIfCurrent(input: {
    baseTokenBundle: HostedStoredTokenBundle;
    connectionId: string;
    forceRefresh: boolean;
    now: string;
    session: HostedAgentSessionRecord;
  }): Promise<HostedTokenRefreshSuccess> {
    const leaseOwner = `agent-refresh:${randomUUID()}`;
    const currentRefreshState = await this.resolveCurrentRefreshState(input);

    if (currentRefreshState.status === "success") {
      return currentRefreshState;
    }

    const provider = await this.requireConfiguredRefreshProvider({
      connectionId: input.connectionId,
      providerId: currentRefreshState.account.provider,
      userId: input.session.userId,
    });
    const leasedRefreshState = await this.claimRefreshLeaseOrResolveCurrent({
      ...input,
      currentRefreshState,
      leaseOwner,
    });

    if (leasedRefreshState.status === "success") {
      return leasedRefreshState;
    }
    const refreshResult = await refreshProviderTokens({
      account: leasedRefreshState.account,
      provider,
    });

    const persistedResult = await this.persistProviderRefreshResultWithLease({
      ...input,
      leaseOwner: leasedRefreshState.leaseOwner,
      refreshResult,
    });

    if (persistedResult.status === "refresh_error") {
      throw persistedResult.error;
    }

    return persistedResult;
  }

  private async readRefreshLeaseStatus(input: {
    connectionId: string;
    now: string;
    tokenVersion: number;
    tx: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<HostedTokenRefreshLeaseStatus> {
    const lease = await input.tx.deviceConnection.findFirst({
      where: {
        id: input.connectionId,
        userId: input.userId,
      },
      select: {
        refreshLeaseExpiresAt: true,
        refreshLeaseOwner: true,
        refreshLeaseTokenVersion: true,
      },
    });

    if (
      !lease
      || (
        !lease.refreshLeaseOwner
        && !lease.refreshLeaseExpiresAt
        && lease.refreshLeaseTokenVersion === null
      )
    ) {
      return { status: "none" };
    }

    if (
      !lease.refreshLeaseOwner
      || !lease.refreshLeaseExpiresAt
      || lease.refreshLeaseTokenVersion !== input.tokenVersion
    ) {
      return { status: "stale" };
    }

    if (lease.refreshLeaseExpiresAt.getTime() > Date.parse(input.now)) {
      return {
        status: "in_progress",
        leaseExpiresAt: lease.refreshLeaseExpiresAt.toISOString(),
      };
    }

    return { status: "stale" };
  }

  private async assertTokenBundleRefreshLeaseExportable(input: {
    connectionId: string;
    now: string;
    tokenVersion: number;
    tx: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<void> {
    const leaseStatus = await this.readRefreshLeaseStatus(input);

    switch (leaseStatus.status) {
      case "none":
        return;
      case "in_progress":
        throw buildHostedTokenRefreshInProgressError(leaseStatus.leaseExpiresAt);
      case "stale":
        throw buildHostedTokenRefreshRetryRequiredError();
    }
  }

  private async claimRefreshLeaseOrResolveCurrent(input: {
    baseTokenBundle: HostedStoredTokenBundle;
    connectionId: string;
    currentRefreshState: HostedTokenRefreshRequiredResult;
    forceRefresh: boolean;
    leaseOwner: string;
    now: string;
    session: HostedAgentSessionRecord;
  }): Promise<HostedTokenRefreshLeaseResult> {
    const nowMs = Date.parse(input.now);
    const leaseExpiresAt = new Date(nowMs + HOSTED_DEVICE_TOKEN_REFRESH_LEASE_TTL_MS).toISOString();
    const claim = await this.store.withConnectionMutationLock(input.connectionId, async (tx) =>
      this.store.claimConnectionRefreshLease({
        connectionId: input.connectionId,
        leaseExpiresAt,
        leaseOwner: input.leaseOwner,
        now: input.now,
        tokenVersion: input.baseTokenBundle.tokenVersion,
        tx,
        userId: input.session.userId,
      })
    );

    switch (claim.status) {
      case "claimed":
        return {
          status: "lease_claimed",
          account: input.currentRefreshState.account,
          currentTokenBundle: input.currentRefreshState.currentTokenBundle,
          leaseOwner: input.leaseOwner,
        };
      case "version_changed": {
        const resolvedState = await this.resolveCurrentRefreshState({
          baseTokenBundle: input.baseTokenBundle,
          connectionId: input.connectionId,
          forceRefresh: input.forceRefresh,
          now: input.now,
          session: input.session,
        });
        if (resolvedState.status === "refresh_required") {
          throw buildHostedTokenRefreshRetryRequiredError();
        }
        return resolvedState;
      }
      case "in_progress":
        throw buildHostedTokenRefreshInProgressError(claim.leaseExpiresAt);
      case "stale":
        return await this.failClosedStaleRefreshLease(input);
    }
  }

  private async failClosedStaleRefreshLease(input: {
    baseTokenBundle: HostedStoredTokenBundle;
    connectionId: string;
    forceRefresh: boolean;
    now: string;
    session: HostedAgentSessionRecord;
  }): Promise<HostedTokenRefreshSuccess> {
    const result = await this.store.withConnectionMutationLock<HostedTokenRefreshStaleLeaseResult>(
      input.connectionId,
      async (tx) => {
        const currentAccount = await this.store.getStoredConnectionAccountForUser(
          input.session.userId,
          input.connectionId,
          tx,
        );
        if (!currentAccount) {
          throw deviceSyncError({
            code: "CONNECTION_SECRET_MISSING",
            message: "Hosted device-sync connection no longer has a stored token bundle.",
            retryable: false,
            httpStatus: 409,
          });
        }
        throwIfHostedTokenBundleUnsupported({
          credentialKind: currentAccount.credential.kind,
        }, input.connectionId);
        throwIfHostedTokenBundleAccountInactive(currentAccount, input.connectionId);

        const currentTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
          connectionId: input.connectionId,
          storedTokenBundle: buildStoredTokenBundle(currentAccount),
          userId: input.session.userId,
        });

        if (currentTokenBundle.tokenVersion !== input.baseTokenBundle.tokenVersion) {
          await this.assertTokenBundleRefreshLeaseExportable({
            connectionId: input.connectionId,
            now: input.now,
            tokenVersion: currentTokenBundle.tokenVersion,
            tx,
            userId: input.session.userId,
          });
          const tokenBundle = await this.buildAuthorizedTokenExport({
            connectionId: input.connectionId,
            now: input.now,
            prisma: tx,
            providerId: currentAccount.provider,
            storedTokenBundle: currentTokenBundle,
            userId: input.session.userId,
          });
          await this.recordTokenAudit({
            userId: input.session.userId,
            connectionId: input.connectionId,
            provider: currentAccount.provider,
            action: "token_exported",
            channel: "agent_refresh",
            sessionId: input.session.id,
            tokenVersion: tokenBundle.tokenVersion,
            keyVersion: tokenBundle.keyVersion,
            createdAt: input.now,
            forceRefresh: input.forceRefresh,
            refreshOutcome: "skipped_version_mismatch",
            tokenVersionChanged: true,
            tx,
          });

          return {
            status: "success",
            connection: toPublicHostedDeviceSyncAccount(currentAccount),
            tokenBundle,
            refreshed: false,
            tokenVersionChanged: true,
          };
        }

        const lease = await tx.deviceConnection.findFirst({
          where: {
            id: input.connectionId,
            userId: input.session.userId,
          },
          select: {
            refreshLeaseExpiresAt: true,
            refreshLeaseOwner: true,
            refreshLeaseTokenVersion: true,
          },
        });

        if (!lease?.refreshLeaseOwner || !lease.refreshLeaseExpiresAt) {
          throw buildHostedTokenRefreshRetryRequiredError();
        }

        if (lease.refreshLeaseExpiresAt.getTime() > Date.parse(input.now)) {
          throw buildHostedTokenRefreshInProgressError(lease.refreshLeaseExpiresAt.toISOString());
        }

        if (lease.refreshLeaseTokenVersion !== currentTokenBundle.tokenVersion) {
          throw buildHostedTokenRefreshRetryRequiredError();
        }

        const currentConnection = toPublicHostedDeviceSyncAccount(currentAccount);
        const nextConnection: PublicDeviceSyncAccount = {
          ...currentConnection,
          lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
          lastErrorMessage: "Token refresh state is unknown. Reconnect this source.",
          lastSyncErrorAt: input.now,
          nextReconcileAt: null,
          status: "reauthorization_required",
          updatedAt: input.now,
        };

        await this.store.createSignal({
          userId: input.session.userId,
          connectionId: input.connectionId,
          provider: currentAccount.provider,
          kind: "reauthorization_required",
          occurredAt: input.now,
          reason: "token_refresh_state_unknown",
          revokeWarning: {
            code: "TOKEN_REFRESH_STATE_UNKNOWN",
            message: "Token refresh state is unknown. Reconnect this source.",
          },
          createdAt: input.now,
          tx,
        });
        await this.store.syncDurableConnectionState(nextConnection, tx);
        await this.store.persistStoredConnectionTokenBundle({
          connectionId: input.connectionId,
          externalAccountId: currentAccount.externalAccountId,
          provider: currentAccount.provider,
          refreshLeaseOwner: lease.refreshLeaseOwner,
          tokenBundle: null,
          tx,
        });

        const cleared = await this.store.clearConnectionRefreshLease({
          connectionId: input.connectionId,
          leaseOwner: lease.refreshLeaseOwner,
          tx,
        });
        if (!cleared) {
          throw buildHostedTokenRefreshRetryRequiredError();
        }

        return {
          status: "stale_failed_closed",
          error: buildHostedTokenRefreshStateUnknownError(),
        };
      },
    );

    if (result.status === "stale_failed_closed") {
      throw result.error;
    }

    return result;
  }

  private async persistProviderRefreshResultWithLease(input: {
    baseTokenBundle: HostedStoredTokenBundle;
    connectionId: string;
    forceRefresh: boolean;
    leaseOwner: string;
    now: string;
    refreshResult: HostedProviderTokenRefreshResult;
    session: HostedAgentSessionRecord;
  }): Promise<HostedTokenRefreshPersistResult> {
    for (let attempt = 1; attempt <= HOSTED_DEVICE_TOKEN_REFRESH_PERSIST_ATTEMPTS; attempt++) {
      try {
        return await this.persistProviderRefreshResultWithLeaseOnce(input);
      } catch (error) {
        if (attempt === HOSTED_DEVICE_TOKEN_REFRESH_PERSIST_ATTEMPTS) {
          throw error;
        }
      }
    }

    throw buildHostedTokenRefreshRetryRequiredError();
  }

  private async persistProviderRefreshResultWithLeaseOnce(input: {
    baseTokenBundle: HostedStoredTokenBundle;
    connectionId: string;
    forceRefresh: boolean;
    leaseOwner: string;
    now: string;
    refreshResult: HostedProviderTokenRefreshResult;
    session: HostedAgentSessionRecord;
  }): Promise<HostedTokenRefreshPersistResult> {
    return await this.store.withConnectionMutationLock<HostedTokenRefreshPersistResult>(
      input.connectionId,
      async (tx) => {
        const currentAccount = await this.store.getStoredConnectionAccountForUser(
          input.session.userId,
          input.connectionId,
          tx,
        );
        if (!currentAccount) {
          throw deviceSyncError({
            code: "CONNECTION_SECRET_MISSING",
            message: "Hosted device-sync connection no longer has a stored token bundle.",
            retryable: false,
            httpStatus: 409,
          });
        }
        throwIfHostedTokenBundleUnsupported({
          credentialKind: currentAccount.credential.kind,
        }, input.connectionId);
        throwIfHostedTokenBundleAccountInactive(currentAccount, input.connectionId);
        const currentConnection = toPublicHostedDeviceSyncAccount(currentAccount);

        const currentTokenBundle = requireHostedDeviceSyncStoredTokenBundle({
          connectionId: input.connectionId,
          storedTokenBundle: buildStoredTokenBundle(currentAccount),
          userId: input.session.userId,
        });

        if (currentTokenBundle.tokenVersion !== input.baseTokenBundle.tokenVersion) {
          await this.assertTokenBundleRefreshLeaseExportable({
            connectionId: input.connectionId,
            now: input.now,
            tokenVersion: currentTokenBundle.tokenVersion,
            tx,
            userId: input.session.userId,
          });
          const tokenBundle = await this.buildAuthorizedTokenExport({
            connectionId: input.connectionId,
            now: input.now,
            prisma: tx,
            providerId: currentAccount.provider,
            storedTokenBundle: currentTokenBundle,
            userId: input.session.userId,
          });
          await this.recordTokenAudit({
            userId: input.session.userId,
            connectionId: input.connectionId,
            provider: currentAccount.provider,
            action: "token_exported",
            channel: "agent_refresh",
            sessionId: input.session.id,
            tokenVersion: tokenBundle.tokenVersion,
            keyVersion: tokenBundle.keyVersion,
            createdAt: input.now,
            forceRefresh: input.forceRefresh,
            refreshOutcome: "skipped_version_mismatch",
            tokenVersionChanged: true,
            tx,
          });
          await this.store.clearConnectionRefreshLease({
            connectionId: input.connectionId,
            leaseOwner: input.leaseOwner,
            tx,
          });

          return {
            status: "success",
            connection: currentConnection,
            tokenBundle,
            refreshed: false,
            tokenVersionChanged: true,
          };
        }

        await this.requireOwnedRefreshLease({
          connectionId: input.connectionId,
          leaseOwner: input.leaseOwner,
          tokenVersion: currentTokenBundle.tokenVersion,
          tx,
          userId: input.session.userId,
        });

        if (input.refreshResult.status === "error") {
          const persistedError = await persistProviderTokenRefreshErrorStatus({
            store: this.store,
            tx,
            account: currentAccount,
            currentTokenBundle,
            error: input.refreshResult.error,
            now: input.now,
            refreshLeaseOwner: input.leaseOwner,
            userId: input.session.userId,
          });
          await this.store.clearConnectionRefreshLease({
            connectionId: input.connectionId,
            leaseOwner: input.leaseOwner,
            tx,
          });

          return {
            status: "refresh_error",
            error: persistedError,
          };
        }

        const nextTokens = input.refreshResult.tokens;
        const nextStoredTokenBundle = {
          accessToken: nextTokens.accessToken,
          accessTokenExpiresAt: nextTokens.accessTokenExpiresAt ?? null,
          keyVersion: currentTokenBundle.keyVersion,
          refreshToken: nextTokens.refreshToken ?? null,
          tokenVersion: currentTokenBundle.tokenVersion + 1,
        };
        const tokenVersionChanged = nextStoredTokenBundle.tokenVersion !== currentTokenBundle.tokenVersion;
        const tokenBundle = await this.buildAuthorizedTokenExport({
          connectionId: input.connectionId,
          now: input.now,
          prisma: tx,
          providerId: currentAccount.provider,
          storedTokenBundle: nextStoredTokenBundle,
          userId: input.session.userId,
        });
        const nextConnection: PublicDeviceSyncAccount = {
          ...currentConnection,
          accessTokenExpiresAt: nextStoredTokenBundle.accessTokenExpiresAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastSyncErrorAt: null,
          status: "active",
          updatedAt: input.now,
        };
        await this.store.syncDurableConnectionState(nextConnection, tx);
        await this.store.persistStoredConnectionTokenBundle({
          connectionId: input.connectionId,
          externalAccountId: currentAccount.externalAccountId,
          provider: currentAccount.provider,
          refreshLeaseOwner: input.leaseOwner,
          tokenBundle: nextStoredTokenBundle,
          tx,
        });
        const cleared = await this.store.clearConnectionRefreshLease({
          connectionId: input.connectionId,
          leaseOwner: input.leaseOwner,
          tx,
        });
        if (!cleared) {
          throw buildHostedTokenRefreshRetryRequiredError();
        }

        return {
          status: "success",
          connection: nextConnection,
          tokenBundle,
          refreshed: true,
          tokenVersionChanged,
        };
      },
    );
  }

  private async requireOwnedRefreshLease(input: {
    connectionId: string;
    leaseOwner: string;
    tokenVersion: number;
    tx: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<void> {
    const lease = await input.tx.deviceConnection.findFirst({
      where: {
        id: input.connectionId,
        userId: input.userId,
      },
      select: {
        refreshLeaseOwner: true,
        refreshLeaseTokenVersion: true,
      },
    });

    if (
      !lease
      || lease.refreshLeaseOwner !== input.leaseOwner
      || lease.refreshLeaseTokenVersion !== input.tokenVersion
    ) {
      throw buildHostedTokenRefreshRetryRequiredError();
    }
  }

  async revokeAgentSession(session: HostedAgentSessionRecord): Promise<{
    agentSession: {
      id: string;
      revokedAt: string;
      revokeReason: string | null;
    };
  }> {
    return this.agentSessions.revokeAgentSession(session);
  }

  async recordLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: HostedLocalHeartbeatPatch,
  ) {
    const connection = await this.store.updateConnectionFromLocalHeartbeat(userId, connectionId, patch);

    if (!connection) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current agent user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    return {
      connection,
    };
  }

  private async recordTokenAudit(input: {
    userId: string;
    connectionId: string;
    provider: string;
    action: "token_exported" | "token_refreshed";
    channel: "agent_export" | "agent_refresh";
    sessionId?: string | null;
    tokenVersion: number;
    keyVersion: string;
    createdAt: string;
    expectedTokenVersion?: number | null;
    forceRefresh?: boolean | null;
    refreshOutcome?: "performed" | "skipped_fresh" | "skipped_version_mismatch" | null;
    tokenVersionChanged?: boolean | null;
    tx?: HostedPrismaTransactionClient;
  }): Promise<void> {
    await this.store.createTokenAudit({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: input.provider,
      action: input.action,
      channel: input.channel,
      sessionId: input.sessionId ?? null,
      tokenVersion: input.tokenVersion,
      keyVersion: input.keyVersion,
      createdAt: input.createdAt,
      expectedTokenVersion: input.expectedTokenVersion ?? null,
      forceRefresh: input.forceRefresh ?? null,
      refreshOutcome: input.refreshOutcome ?? null,
      tokenVersionChanged: input.tokenVersionChanged ?? null,
      tx: input.tx,
    });
  }

  private async assertCurrentAgentSessionStillActive(): Promise<void> {
    await this.agentSessions.requireAgentSession();
  }

  private async requireRegistry(): Promise<DeviceSyncRegistry> {
    if (!this.registry) {
      throw deviceSyncError({
        code: "DEVICE_SYNC_PROVIDER_RUNTIME_UNAVAILABLE",
        message: "Hosted device-sync provider runtime is unavailable for this route.",
        retryable: false,
        httpStatus: 500,
      });
    }

    return this.registry;
  }

  private async buildAuthorizedTokenExport(input: {
    connectionId: string;
    now: string;
    prisma:
      | PrismaDeviceSyncControlPlaneStore["prisma"]
      | HostedPrismaTransactionClient;
    providerId: string;
    storedTokenBundle: HostedStoredTokenBundle;
    userId: string;
  }): Promise<HostedTokenExport> {
    await this.assertTokenExportAuthority?.({
      connectionId: input.connectionId,
      prisma: input.prisma,
      providerId: input.providerId,
      userId: input.userId,
    });
    return buildTokenExport(input.storedTokenBundle, input.now);
  }

  private async requireConfiguredRefreshProvider(input: {
    connectionId: string;
    providerId: string;
    userId: string;
  }): Promise<DeviceSyncProvider> {
    const provider = this.resolveRefreshProvider
      ? await this.resolveRefreshProvider({
          ...input,
          prisma: this.store.prisma,
        })
      : (await this.requireRegistry()).get(input.providerId);

    if (!provider) {
      throw deviceSyncError({
        code: "PROVIDER_NOT_CONFIGURED",
        message:
          `Hosted device-sync provider ${input.providerId} is not configured for this connection.`,
        retryable: false,
        httpStatus: 404,
      });
    }

    return provider;
  }
}

export function createHostedDeviceSyncAgentSessionService(
  request: Request,
  options: HostedDeviceSyncAgentSessionOptions = {},
): HostedDeviceSyncAgentSessionService {
  return createHostedDeviceSyncAgentSessionContext(request, options).agentSessions;
}

export function createHostedDeviceSyncAgentSessionContext(
  request: Request,
  options: HostedDeviceSyncAgentSessionOptions = {},
): HostedDeviceSyncAgentSessionContext {
  const env = readHostedDeviceSyncEnvironment(process.env);
  const store = new PrismaDeviceSyncControlPlaneStore({
    providerAccountBlindIndexKey: env.routingIndexKey,
    prisma: getPrisma(),
  });

  return {
    agentSessions: new HostedDeviceSyncAgentSessionService({
      assertTokenExportAuthority: options.assertTokenExportAuthority ?? null,
      registry: options.registry ?? null,
      request,
      resolveRefreshProvider: options.resolveRefreshProvider ?? null,
      store,
    }),
    env,
    store,
  };
}

function toPublicHostedDeviceSyncAccount(
  account: HostedStoredDeviceSyncAccount,
): PublicDeviceSyncAccount {
  return {
    accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
    connectedAt: account.connectedAt,
    createdAt: account.createdAt,
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    id: account.id,
    lastErrorCode: account.lastErrorCode,
    lastErrorMessage: account.lastErrorMessage,
    lastSyncCompletedAt: account.lastSyncCompletedAt,
    lastSyncErrorAt: account.lastSyncErrorAt,
    lastSyncStartedAt: account.lastSyncStartedAt,
    lastWebhookAt: account.lastWebhookAt,
    metadata: sanitizeHostedDeviceSyncConnectionMetadata(account.metadata ?? {}),
    nextReconcileAt: account.nextReconcileAt,
    provider: account.provider,
    scopes: account.scopes,
    setupExpiresAt: account.setupExpiresAt ?? null,
    setupPhase: account.setupPhase ?? null,
    status: account.status,
    ...(account.sources === undefined ? {} : { sources: account.sources }),
    updatedAt: account.updatedAt,
  };
}

function throwIfHostedTokenBundleUnsupported(
  record: { credentialKind?: string | null } | null,
  connectionId: string,
): void {
  const credentialKind = record?.credentialKind;

  if (credentialKind !== "provider_config" && credentialKind !== "none") {
    return;
  }

  throw deviceSyncError({
    code: "OAUTH_TOKENS_REQUIRED",
    message: "This hosted device-sync connection does not use OAuth token credentials.",
    retryable: false,
    httpStatus: 409,
    details: {
      connectionId,
      credentialKind,
    },
  });
}

function throwIfHostedTokenBundleAccountInactive(
  account: Pick<PublicDeviceSyncAccount, "status">,
  connectionId: string,
): void {
  if (account.status === "active") {
    return;
  }

  if (account.status === "disconnected") {
    throw deviceSyncError({
      code: "CONNECTION_ALREADY_DISCONNECTED",
      message: "Hosted device-sync connection is disconnected.",
      retryable: false,
      httpStatus: 409,
      accountStatus: "disconnected",
      details: {
        connectionId,
      },
    });
  }

  throw deviceSyncError({
    code: "ACCOUNT_REAUTHORIZATION_REQUIRED",
    message: "Hosted device-sync connection requires reauthorization before token material can be used.",
    retryable: false,
    httpStatus: 409,
    accountStatus: "reauthorization_required",
    details: {
      connectionId,
    },
  });
}

function buildHostedTokenRefreshInProgressError(leaseExpiresAt: string) {
  return deviceSyncError({
    code: "TOKEN_REFRESH_IN_PROGRESS",
    message: "A hosted device-sync token refresh is already in progress for this connection.",
    retryable: true,
    httpStatus: 409,
    details: {
      leaseExpiresAt,
    },
  });
}

function buildHostedTokenRefreshRetryRequiredError() {
  return deviceSyncError({
    code: "TOKEN_REFRESH_RETRY_REQUIRED",
    message: "Hosted device-sync token refresh state changed before it could be confirmed.",
    retryable: true,
    httpStatus: 409,
  });
}

function buildHostedTokenRefreshStateUnknownError() {
  return deviceSyncError({
    code: "TOKEN_REFRESH_STATE_UNKNOWN",
    message: "Hosted device-sync token refresh state is unknown. Reconnect this source before syncing again.",
    retryable: false,
    httpStatus: 409,
    accountStatus: "reauthorization_required",
  });
}
