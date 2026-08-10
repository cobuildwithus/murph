import "server-only";

import {
  createHostedDeviceSyncAgentSessionService,
  type HostedDeviceSyncRefreshProviderResolver,
} from "./agent-session-service";
import { assertHostedDeviceSyncTokenExportAuthority } from "./agent-session-provider-authority-service";
import {
  resolveDeviceProviderApplicationForConnection,
} from "./provider-applications";
import {
  createHostedDeviceSyncRegistry,
  createHostedDeviceSyncRegistryWithProviderConfigs,
} from "./providers";

export function createHostedDeviceSyncProviderAgentSessionService(request: Request) {
  const sharedRegistry = createHostedDeviceSyncRegistry(process.env);
  const resolveRefreshProvider: HostedDeviceSyncRefreshProviderResolver = async (input) => {
    const application = await resolveDeviceProviderApplicationForConnection({
      connectionId: input.connectionId,
      memberId: input.userId,
      prisma: input.prisma,
    });
    const registry = application
      ? createHostedDeviceSyncRegistryWithProviderConfigs({
          providerConfigs: application.providerConfigs,
        })
      : sharedRegistry;

    return registry.get(input.providerId) ?? null;
  };

  return createHostedDeviceSyncAgentSessionService(request, {
    assertTokenExportAuthority: assertHostedDeviceSyncTokenExportAuthority,
    resolveRefreshProvider,
  });
}
