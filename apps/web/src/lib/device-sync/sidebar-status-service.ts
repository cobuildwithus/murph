import "server-only";

import {
  readConfiguredDeviceSyncConnectTargetConfigs,
} from "@murphai/device-syncd/connect-config";
import {
  listConfiguredDeviceSyncPublicProviderDescriptors,
} from "@murphai/device-syncd/public-provider-descriptors";

import { getPrisma } from "../prisma";
import { readHostedDeviceSyncEnvironment } from "./env";
import { toHostedBrowserDeviceSyncConnectionSource } from "./browser-connection-source";
import { toHostedBrowserDeviceSyncConnection } from "./public-connection";
import { PrismaHostedConnectionStore } from "./prisma-store/connections";
import { PrismaHostedConnectionSourceStore } from "./prisma-store/sources";
import {
  buildHostedDeviceSyncSettingsSources,
  type HostedDeviceSyncSettingsConnectTarget,
  type HostedDeviceSyncSettingsResponse,
} from "./settings-surface";
import {
  summarizeSidebarDeviceSyncStatus,
  type SidebarDeviceSyncStatusResponse,
} from "./sidebar-status";

export async function buildHostedDeviceSyncSidebarStatusResponse(input: {
  memberId: string;
}): Promise<SidebarDeviceSyncStatusResponse> {
  const sources = await buildHostedDeviceSyncSettingsSourcesForMember({
    memberId: input.memberId,
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
}) {
  const env = readHostedDeviceSyncEnvironment(process.env);
  const prisma = getPrisma();
  const connectionStore = new PrismaHostedConnectionStore({ prisma });
  const sourceStore = new PrismaHostedConnectionSourceStore(prisma);
  const connections = await connectionStore.listConnectionsForUser(input.memberId);
  const connectionEntries = await Promise.all(
    connections.map(async (connection) => {
      const browserConnection = toHostedBrowserDeviceSyncConnection(
        connection,
        env.routingIndexKey,
      );
      const sources = await sourceStore.listConnectionSources(connection.id);

      return {
        browserConnection,
        sources,
      };
    }),
  );
  const providers = listConfiguredDeviceSyncPublicProviderDescriptors(
    readConfiguredDeviceSyncConnectTargetConfigs(process.env),
    { publicBaseUrl: env.publicBaseUrl },
  );
  const sources = buildHostedDeviceSyncSettingsSources({
    connectionSources: connectionEntries.flatMap((entry) =>
      entry.sources.map((source) =>
        toHostedBrowserDeviceSyncConnectionSource(source, entry.browserConnection.id)
      )
    ),
    connections: connectionEntries.map((entry) => entry.browserConnection),
    connectTargets: input.connectTargets,
    providers,
  });

  return sources;
}
