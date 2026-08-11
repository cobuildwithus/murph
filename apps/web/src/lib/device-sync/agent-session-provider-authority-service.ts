import "server-only";

import {
  createHostedDeviceSyncAgentSessionService,
  type HostedDeviceSyncTokenExportAuthorityValidator,
} from "./agent-session-service";
import { resolveDeviceProviderApplicationForConnection } from "./provider-applications";

export const assertHostedDeviceSyncTokenExportAuthority:
  HostedDeviceSyncTokenExportAuthorityValidator = async (input) => {
    await resolveDeviceProviderApplicationForConnection({
      connectionId: input.connectionId,
      memberId: input.userId,
      prisma: input.prisma,
    });
  };

export function createHostedDeviceSyncProviderAuthorityAgentSessionService(
  request: Request,
) {
  return createHostedDeviceSyncAgentSessionService(request, {
    assertTokenExportAuthority: assertHostedDeviceSyncTokenExportAuthority,
  });
}
