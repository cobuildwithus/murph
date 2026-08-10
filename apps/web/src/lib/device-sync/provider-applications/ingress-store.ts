import type {
  ClaimDeviceSyncWebhookTraceInput,
  ConsumeOAuthStateResult,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceClaimResult,
  ListDeviceConnectionSourcesInput,
  MarkPublicDeviceSyncConnectionSetupFailedInput,
  MarkPublicDeviceSyncConnectionSetupFailedResult,
  OAuthStateRecord,
  PublicDeviceConnectionSource,
  PublicDeviceSyncAccount,
  UpsertDeviceConnectionSourceInput,
  UpsertPublicDeviceSyncConnectionInput,
  UpsertPublicDeviceSyncConnectionResult,
} from "@murphai/device-syncd/types";

import type { PrismaDeviceSyncControlPlaneStore } from "../prisma-store";
import type { DeviceProviderApplicationBinding } from "./types";

/**
 * Restricts one public-ingress operation to an exact member-owned provider
 * application. Shared public ingress keeps its provider-neutral store contract;
 * Web supplies the hosted application authority at this existing boundary.
 */
export class DeviceProviderApplicationIngressStore
  implements DeviceSyncPublicIngressStore
{
  constructor(
    private readonly binding: DeviceProviderApplicationBinding,
    private readonly store: PrismaDeviceSyncControlPlaneStore,
  ) {}

  deleteExpiredOAuthStates(now: string): Promise<number> {
    return this.store.deleteExpiredOAuthStates(now);
  }

  createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    return this.store.createOAuthStateWithProviderApplication(input, this.binding);
  }

  consumeOAuthState(
    state: string,
    now: string,
    expectedProvider?: string,
    expectedOwnerId?: string,
  ): Promise<ConsumeOAuthStateResult> {
    return this.store.consumeOAuthStateWithProviderApplication(
      state,
      now,
      this.binding,
      expectedProvider,
      expectedOwnerId,
    );
  }

  async upsertConnection(
    input: UpsertPublicDeviceSyncConnectionInput,
  ): Promise<PublicDeviceSyncAccount> {
    return (
      await this.store.upsertConnectionWithProviderApplication(
        input,
        this.binding,
      )
    ).account;
  }

  upsertConnectionWithPrevious(
    input: UpsertPublicDeviceSyncConnectionInput,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    return this.store.upsertConnectionWithProviderApplication(
      input,
      this.binding,
    );
  }

  markConnectionSetupFailed(
    input: MarkPublicDeviceSyncConnectionSetupFailedInput,
  ): Promise<MarkPublicDeviceSyncConnectionSetupFailedResult> {
    return this.store.markConnectionSetupFailed(input);
  }

  getConnectionById(
    accountId: string,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.store.getConnectionById(accountId);
  }

  getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.store.getConnectionByExternalAccount(
      provider,
      externalAccountId,
    );
  }

  upsertConnectionSource(
    input: UpsertDeviceConnectionSourceInput,
  ): Promise<
    Pick<
      PublicDeviceConnectionSource,
      "connectionId" | "sourceProviderSlug" | "status"
    >
  > {
    return this.store.upsertConnectionSource(input);
  }

  listConnectionSources(
    input: ListDeviceConnectionSourcesInput,
  ): Promise<
    Array<
      Pick<
        PublicDeviceConnectionSource,
        | "connectionId"
        | "lastErrorCode"
        | "lastSeenAt"
        | "sourceInstanceKey"
        | "sourceProviderSlug"
        | "status"
      >
    >
  > {
    return this.store.listConnectionSources(input);
  }

  getConnectionOwnerId(accountId: string): Promise<string | null> {
    return this.store.getConnectionOwnerId(accountId);
  }

  claimWebhookTrace(
    input: ClaimDeviceSyncWebhookTraceInput,
  ): Promise<DeviceSyncWebhookTraceClaimResult> {
    return this.store.claimWebhookTrace(input);
  }

  completeWebhookTrace(
    provider: string,
    traceId: string,
    claimToken: string,
  ): Promise<boolean> {
    return this.store.completeWebhookTrace(provider, traceId, claimToken);
  }

  releaseWebhookTrace(
    provider: string,
    traceId: string,
    claimToken: string,
  ): Promise<void> {
    return this.store.releaseWebhookTrace(provider, traceId, claimToken);
  }

  markWebhookReceived(accountId: string, now: string): Promise<void> {
    return this.store.markWebhookReceived(accountId, now);
  }

  markConnectionSourceDataReceived(input: {
    connectionId: string;
    now: string;
    sourceProviderSlug: string;
  }): Promise<number> {
    return this.store.markConnectionSourceDataReceived(input);
  }
}
