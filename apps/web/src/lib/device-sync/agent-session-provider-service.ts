import "server-only";

import { createHostedDeviceSyncAgentSessionService } from "./agent-session-service";
import { createHostedDeviceSyncRegistry } from "./providers";

export function createHostedDeviceSyncProviderAgentSessionService(request: Request) {
  return createHostedDeviceSyncAgentSessionService(request, {
    registry: createHostedDeviceSyncRegistry(process.env),
  });
}
