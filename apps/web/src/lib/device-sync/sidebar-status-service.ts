import "server-only";

import type { Prisma } from "@prisma/client";
import {
  readConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/provider-configs";
import {
  listConfiguredDeviceSyncPublicProviderDescriptors,
} from "@murphai/device-syncd/public-provider-descriptors";

import { getPrisma } from "../prisma";
import { readHostedDeviceSyncEnvironment } from "./env";
import { toHostedBrowserDeviceSyncConnectionSource } from "./browser-connection-source";
import {
  createHostedBrowserConnectionId,
  toHostedBrowserDeviceSyncConnection,
  toHostedBrowserDeviceSyncSidebarConnection,
  type HostedBrowserDeviceSyncConnection,
} from "./public-connection";
import { PrismaHostedConnectionStore } from "./prisma-store/connections";
import {
  PrismaHostedConnectionSourceStore,
  type HostedDeviceConnectionSource,
} from "./prisma-store/sources";
import {
  buildHostedDeviceSyncSettingsSources,
  type HostedDeviceSyncSettingsConnectTarget,
  type HostedDeviceSyncSettingsResponse,
} from "./settings-surface";
import {
  summarizeSidebarDeviceSyncStatus,
  type SidebarDeviceSyncStatusResponse,
} from "./sidebar-status";

const hostedSidebarDeviceSyncConnectionRecordArgs = {
  select: {
    connectedAt: true,
    createdAt: true,
    id: true,
    lastErrorCode: true,
    lastSyncCompletedAt: true,
    lastSyncErrorAt: true,
    lastSyncStartedAt: true,
    lastWebhookAt: true,
    nextReconcileAt: true,
    provider: true,
    setupExpiresAt: true,
    setupPhase: true,
    status: true,
    updatedAt: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

export async function buildHostedDeviceSyncSidebarStatusResponse(input: {
  memberId: string;
  publicBaseUrl: string | null;
}): Promise<SidebarDeviceSyncStatusResponse> {
  const sources = await buildHostedDeviceSyncSidebarSourcesForMember({
    memberId: input.memberId,
    publicBaseUrl: input.publicBaseUrl,
  });

  return {
    generatedAt: new Date().toISOString(),
    ok: true,
    status: summarizeSidebarDeviceSyncStatus(sources),
  };
}

export async function buildHostedDeviceSyncSettingsSurfaceResponse(input: {
  connectTargets?: readonly HostedDeviceSyncSettingsConnectTarget[];
  memberId: string;
  publicBaseUrl: string | null;
}): Promise<HostedDeviceSyncSettingsResponse> {
  return {
    generatedAt: new Date().toISOString(),
    ok: true,
    sources: await buildHostedDeviceSyncSettingsSourcesForMember(input),
  };
}

async function buildHostedDeviceSyncSettingsSourcesForMember(input: {
  connectTargets?: readonly HostedDeviceSyncSettingsConnectTarget[];
  memberId: string;
  publicBaseUrl: string | null;
}) {
  const env = readHostedDeviceSyncEnvironment(process.env);
  const prisma = getPrisma();
  const connectionStore = new PrismaHostedConnectionStore({ prisma });
  const sourceStore = new PrismaHostedConnectionSourceStore(prisma);
  const connections = await connectionStore.listConnectionsForUser(input.memberId);
  const connectionSources = await sourceStore.listConnectionSourcesForConnections(
    connections.map((connection) => connection.id),
  );

  return buildSettingsSources({
    browserConnections: connections.map((connection) =>
      toHostedBrowserDeviceSyncConnection(connection, env.routingIndexKey)
    ),
    connectTargets: input.connectTargets,
    connectionSources,
    publicBaseUrl: input.publicBaseUrl,
    routingIndexKey: env.routingIndexKey,
  });
}

async function buildHostedDeviceSyncSidebarSourcesForMember(input: {
  memberId: string;
  publicBaseUrl: string | null;
}) {
  const env = readHostedDeviceSyncEnvironment(process.env);
  const prisma = getPrisma();
  const connectionRecords = await prisma.deviceConnection.findMany({
    where: {
      userId: input.memberId,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    ...hostedSidebarDeviceSyncConnectionRecordArgs,
  });
  const connectionSources = await new PrismaHostedConnectionSourceStore(prisma)
    .listConnectionSourcesForConnections(
      connectionRecords.map((connection) => connection.id),
    );

  return buildSettingsSources({
    browserConnections: connectionRecords.map((connection) =>
      toHostedBrowserDeviceSyncSidebarConnection(connection, env.routingIndexKey)
    ),
    connectionSources,
    publicBaseUrl: input.publicBaseUrl,
    routingIndexKey: env.routingIndexKey,
  });
}

function buildSettingsSources(input: {
  browserConnections: readonly HostedBrowserDeviceSyncConnection[];
  connectTargets?: readonly HostedDeviceSyncSettingsConnectTarget[];
  connectionSources: readonly HostedDeviceConnectionSource[];
  publicBaseUrl: string | null;
  routingIndexKey: Buffer;
}) {
  const providers = listConfiguredDeviceSyncPublicProviderDescriptors(
    readConfiguredDeviceSyncProviderConfigs(process.env),
    { publicBaseUrl: input.publicBaseUrl },
  );
  const sources = buildHostedDeviceSyncSettingsSources({
    connectionSources: input.connectionSources.map((source) =>
      toHostedBrowserDeviceSyncConnectionSource(
        source,
        createHostedBrowserConnectionId(input.routingIndexKey, source.connectionId),
      )
    ),
    connections: input.browserConnections,
    connectTargets: input.connectTargets,
    providers,
  });

  return sources;
}
