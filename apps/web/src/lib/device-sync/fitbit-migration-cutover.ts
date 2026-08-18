import {
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
} from "@murphai/device-syncd/connect-config";
import {
  DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE,
  isGoogleHealthFitbitMigrationCutoverReady,
  isGoogleHealthFitbitMigrationLegacyTerminal,
  resolveGoogleHealthFitbitMigrationSources,
} from "@murphai/device-syncd/fitbit-migration";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE,
  DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
} from "@murphai/device-syncd/public-account";
import type {
  DeviceConnectionHandler,
  DeviceSyncRegistry,
  PublicDeviceSyncAccount,
} from "@murphai/device-syncd/types";

import {
  PrismaDeviceSyncControlPlaneStore,
  type HostedDeviceConnectionSource,
  type HostedPrismaTransactionClient,
} from "./prisma-store";
import { toIsoTimestamp } from "./shared";

const CLAIM_LEASE_MS = 60_000;
const REVOKE_OPTIONS = {
  requiredActiveSourceProviderSlug: JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
} as const;

type CutoverInput = {
  connectionId: string;
  store: FitbitMigrationCutoverStore;
  userId: string;
};
type FitbitMigrationCutoverStore = Pick<
  PrismaDeviceSyncControlPlaneStore,
  | "createSignal"
  | "getConnectionForUser"
  | "getStoredConnectionAccountForUser"
  | "hasPendingDirtyConnection"
  | "listConnectionSources"
  | "upsertConnectionSource"
  | "withConnectionMutationLock"
>;
type StoredAccount = NonNullable<Awaited<ReturnType<
  PrismaDeviceSyncControlPlaneStore["getStoredConnectionAccountForUser"]
>>>;
type CutoverHandler = DeviceConnectionHandler & {
  isSourceAccessActive: NonNullable<DeviceConnectionHandler["isSourceAccessActive"]>;
  revokeSourceAccess: NonNullable<DeviceConnectionHandler["revokeSourceAccess"]>;
};
type Claim = {
  claimAt: string;
  connection: PublicDeviceSyncAccount;
  originalStatus: HostedDeviceConnectionSource["status"];
  source: HostedDeviceConnectionSource;
  storedAccount: StoredAccount;
};
type ClaimResult =
  | { kind: "complete" | "pending" }
  | ({ kind: "claimed" | "recover" } & Claim);
type LockedClaim = {
  connection: PublicDeviceSyncAccount;
  legacy: HostedDeviceConnectionSource;
  sources: HostedDeviceConnectionSource[];
  tx: HostedPrismaTransactionClient;
};

export async function completeHostedGoogleHealthFitbitMigration(input: {
  connectionId: string;
  registry: DeviceSyncRegistry;
  store: FitbitMigrationCutoverStore;
  userId: string;
}): Promise<{ connectionId: string; status: "complete" | "pending" }> {
  const handler = input.registry.get("junction")?.connectionHandler;
  const target = await claimOrRecover(input, hasCutoverHandler(handler));
  if (target.kind === "complete" || target.kind === "pending") {
    return result(input, target.kind);
  }
  if (!hasCutoverHandler(handler)) {
    await restoreFailure(input, target);
    return result(input, "pending");
  }

  if (target.kind === "recover") {
    let active: boolean;
    try {
      active = await handler.isSourceAccessActive(
        target.storedAccount,
        JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
        { requireDefinitive: true },
      );
    } catch {
      return result(input, "pending");
    }
    if (!active) {
      return result(input, await finalize(input, target, "user_disconnect"));
    }
    if (isFreshClaim(target.claimAt)) {
      return result(input, "pending");
    }
    const renewed = await renewClaim(input, target);
    return renewed
      ? revokeAndFinalize(input, handler, renewed)
      : result(input, "pending");
  }
  return revokeAndFinalize(input, handler, target);
}

async function revokeAndFinalize(
  input: CutoverInput,
  handler: CutoverHandler,
  target: Claim,
): Promise<{ connectionId: string; status: "complete" | "pending" }> {
  try {
    await handler.revokeSourceAccess(
      target.storedAccount,
      JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
      REVOKE_OPTIONS,
    );
  } catch {
    try {
      if (!await handler.isSourceAccessActive(
        target.storedAccount,
        JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
        { requireDefinitive: true },
      )) {
        return result(input, await finalize(input, target, "user_disconnect"));
      }
    } catch {
      // Restore the exact claim below so local Fitbit access remains active.
    }
    await restoreFailure(input, target);
    return result(input, "pending");
  }
  return result(input, await finalize(input, target, "user_disconnect"));
}

async function claimOrRecover(
  input: CutoverInput,
  canRevoke: boolean,
): Promise<ClaimResult> {
  return input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const connection = await input.store.getConnectionForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    const sources = await input.store.listConnectionSources(input.connectionId, tx);
    const { legacy } = resolveGoogleHealthFitbitMigrationSources(sources);
    if (
      !connection
      || connection.provider !== "junction"
      || connection.status !== "active"
      || !legacy
    ) {
      return { kind: "pending" as const };
    }
    if (
      legacy.status === "disconnected"
      && legacy.lastErrorCode === DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE
    ) {
      return { kind: "complete" as const };
    }
    if (await input.store.hasPendingDirtyConnection(input.connectionId, tx)) {
      return { kind: "pending" as const };
    }
    if (isGoogleHealthFitbitMigrationLegacyTerminal(legacy)) {
      return {
        kind: isGoogleHealthFitbitMigrationCutoverReady({ sources })
          ? "complete" as const
          : "pending" as const,
      };
    }

    const storedAccount = await input.store.getStoredConnectionAccountForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    if (!storedAccount) {
      return { kind: "pending" as const };
    }
    if (legacy.lastErrorCode === DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE) {
      return makeClaim("recover", connection, legacy, storedAccount, legacy.lastSeenAt);
    }
    if (!isGoogleHealthFitbitMigrationCutoverReady({ sources })) {
      return { kind: "pending" as const };
    }
    if (!canRevoke) {
      await writeLifecycle(
        input.store,
        legacy,
        legacy.status,
        DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE,
        nextLifecycleAt(legacy.lastSeenAt),
        tx,
      );
      return { kind: "pending" as const };
    }

    const claimAt = nextLifecycleAt(legacy.lastSeenAt);
    await writeLifecycle(
      input.store,
      legacy,
      legacy.status,
      DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      claimAt,
      tx,
    );
    return makeClaim("claimed", connection, legacy, storedAccount, claimAt);
  });
}

async function renewClaim(input: CutoverInput, target: Claim): Promise<Claim | null> {
  return withOwnedClaim(input, target, async ({ legacy, sources, tx }) => {
    if (
      await input.store.hasPendingDirtyConnection(input.connectionId, tx)
      || !isReadyForOwnedClaim(sources, target)
    ) {
      await writeLifecycle(
        input.store,
        legacy,
        target.originalStatus,
        DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE,
        nextLifecycleAt(legacy.lastSeenAt),
        tx,
      );
      return null;
    }
    const claimAt = nextLifecycleAt(legacy.lastSeenAt);
    await writeLifecycle(
      input.store,
      legacy,
      legacy.status,
      DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      claimAt,
      tx,
    );
    return { ...target, claimAt, source: legacy };
  });
}

async function finalize(
  input: CutoverInput,
  target: Claim,
  reason: "provider_disconnect" | "user_disconnect",
): Promise<"complete" | "pending"> {
  return (await withOwnedClaim(input, target, async ({ connection, legacy, tx }) => {
    if (await input.store.hasPendingDirtyConnection(input.connectionId, tx)) {
      return "pending" as const;
    }
    await finalizeTx(input, connection, legacy, reason, tx);
    return "complete" as const;
  })) ?? "pending";
}

async function restoreFailure(input: CutoverInput, target: Claim): Promise<void> {
  await withOwnedClaim(input, target, async ({ legacy, tx }) => {
    await writeLifecycle(
      input.store,
      legacy,
      target.originalStatus,
      DEVICE_SYNC_GOOGLE_HEALTH_FITBIT_CUTOVER_FAILED_ERROR_CODE,
      nextLifecycleAt(legacy.lastSeenAt),
      tx,
    );
  });
}

async function withOwnedClaim<TResult>(
  input: CutoverInput,
  target: Claim,
  action: (claim: LockedClaim) => Promise<TResult>,
): Promise<TResult | null> {
  return input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const connection = await input.store.getConnectionForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    const storedAccount = await input.store.getStoredConnectionAccountForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    const sources = await input.store.listConnectionSources(input.connectionId, tx);
    const { legacy } = resolveGoogleHealthFitbitMigrationSources(sources);
    if (
      !connection
      || !samePublicAccount(target.connection, connection)
      || !sameStoredAccount(target.storedAccount, storedAccount)
      || legacy?.id !== target.source.id
      || legacy.lastSeenAt !== target.claimAt
      || legacy.lastErrorCode !== DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
    ) {
      return null;
    }
    return action({ connection, legacy, sources, tx });
  });
}

async function finalizeTx(
  input: CutoverInput,
  connection: PublicDeviceSyncAccount,
  legacy: HostedDeviceConnectionSource,
  reason: "provider_disconnect" | "user_disconnect",
  tx: HostedPrismaTransactionClient,
): Promise<void> {
  const disconnectedAt = nextLifecycleAt(legacy.lastSeenAt);
  await writeLifecycle(
    input.store,
    legacy,
    "disconnected",
    reason === "provider_disconnect"
      ? DEVICE_SYNC_SOURCE_PROVIDER_DISCONNECTED_ERROR_CODE
      : DEVICE_SYNC_SOURCE_USER_DISCONNECTED_ERROR_CODE,
    disconnectedAt,
    tx,
  );
  await input.store.createSignal({
    userId: input.userId,
    connectionId: input.connectionId,
    provider: connection.provider,
    kind: "source_disconnected",
    occurredAt: disconnectedAt,
    sourceProviderSlug: JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
    reason,
    createdAt: disconnectedAt,
    tx,
  });
}

async function writeLifecycle(
  store: FitbitMigrationCutoverStore,
  source: HostedDeviceConnectionSource,
  status: HostedDeviceConnectionSource["status"],
  lastErrorCode: string | null,
  lastSeenAt: string,
  tx: HostedPrismaTransactionClient,
): Promise<void> {
  await store.upsertConnectionSource({
    connectionId: source.connectionId,
    sourceInstanceKey: source.sourceInstanceKey,
    sourceProviderSlug: source.sourceProviderSlug,
    status,
    lastErrorCode,
    lastErrorMessage: null,
    lastSeenAt,
    tx,
  });
}

function isReadyForOwnedClaim(
  sources: readonly HostedDeviceConnectionSource[],
  target: Claim,
): boolean {
  return isGoogleHealthFitbitMigrationCutoverReady({
    allowedLegacyClaim: {
      lastSeenAt: target.claimAt,
      sourceId: target.source.id,
    },
    sources,
  });
}

function makeClaim(
  kind: "claimed" | "recover",
  connection: PublicDeviceSyncAccount,
  source: HostedDeviceConnectionSource,
  storedAccount: StoredAccount,
  claimAt: string,
): ClaimResult {
  return {
    claimAt,
    connection,
    kind,
    originalStatus: source.status,
    source,
    storedAccount,
  };
}

function sameStoredAccount(
  expected: StoredAccount,
  current: StoredAccount | null,
): boolean {
  if (
    !current
    || !samePublicAccount(expected, current)
    || expected.credential.kind !== current.credential.kind
  ) {
    return false;
  }
  if (
    expected.credential.kind === "provider_config"
    || current.credential.kind === "provider_config"
  ) {
    return expected.credential.kind === "provider_config"
      && current.credential.kind === "provider_config"
      && expected.credential.providerConfigKey === current.credential.providerConfigKey;
  }
  return expected.tokenVersion === current.tokenVersion;
}

function samePublicAccount(
  expected: PublicDeviceSyncAccount,
  current: PublicDeviceSyncAccount,
): boolean {
  return expected.provider === current.provider
    && expected.externalAccountId === current.externalAccountId
    && expected.connectedAt === current.connectedAt;
}

function hasCutoverHandler(
  handler: DeviceConnectionHandler | null | undefined,
): handler is CutoverHandler {
  return Boolean(handler?.isSourceAccessActive && handler.revokeSourceAccess);
}

function result(
  input: Pick<CutoverInput, "connectionId">,
  status: "complete" | "pending",
): { connectionId: string; status: "complete" | "pending" } {
  return { connectionId: input.connectionId, status };
}

function isFreshClaim(claimAt: string): boolean {
  const claimAtMs = Date.parse(claimAt);
  return Number.isFinite(claimAtMs) && Date.now() - claimAtMs < CLAIM_LEASE_MS;
}

function nextLifecycleAt(previous: string | null): string {
  const previousMs = previous === null ? Number.NaN : Date.parse(previous);
  return toIsoTimestamp(new Date(Math.max(
    Date.now(),
    Number.isFinite(previousMs) ? previousMs + 1 : 0,
  )));
}
