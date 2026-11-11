import { HostedAgentSessionService } from "../hosted-agent-sessions";
import { getPrisma } from "../prisma";
import { readHostedDeviceSyncEnvironment, type HostedDeviceSyncEnvironment } from "./env";
import { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";

export interface HostedDeviceSyncAgentSessionContext {
  readonly agentSessions: HostedAgentSessionService;
  readonly env: HostedDeviceSyncEnvironment;
  readonly store: PrismaDeviceSyncControlPlaneStore;
}

export function createHostedDeviceSyncAgentSessionService(request: Request): HostedAgentSessionService {
  return createHostedDeviceSyncAgentSessionContext(request).agentSessions;
}

export function createHostedDeviceSyncAgentSessionContext(request: Request): HostedDeviceSyncAgentSessionContext {
  const env = readHostedDeviceSyncEnvironment(process.env);
  const store = new PrismaDeviceSyncControlPlaneStore({
    providerAccountBlindIndexKey: env.routingIndexKey,
    prisma: getPrisma(),
  });
  const agentSessions = new HostedAgentSessionService({
    request,
    store,
    pairPath: "/api/device-sync/agents/pair",
    messages: {
      required: "Hosted device-sync agent routes require a bearer token created by /api/device-sync/agents/pair.",
      expired: "Hosted device-sync agent bearer token expired. Pair again to create a new bearer token.",
      invalid: "Hosted device-sync agent bearer token is invalid or revoked.",
    },
  });
  return { agentSessions, env, store };
}
