import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBearerRequest } from "./route-test-helpers";

const mocks = vi.hoisted(() => ({
  requireAgentSession: vi.fn(), revokeAgentSession: vi.fn(),
}));
vi.mock("@/src/lib/device-sync/agent-session-service", () => ({
  createHostedDeviceSyncAgentSessionService: () => mocks,
}));
import * as revokeRoute from "../app/api/device-sync/agent/session/revoke/route";

describe("hosted device-sync agent revocation", () => {
  const session = { id: "dsa_active", userId: "user-123" };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentSession.mockResolvedValue(session);
    mocks.revokeAgentSession.mockResolvedValue({ agentSession: {
      id: "dsa_active", revokedAt: "2026-03-25T01:30:00.000Z", revokeReason: "agent_request",
    } });
  });
  it("passes the authenticated session into revoke so the handler can invalidate it", async () => {
    const response = await revokeRoute.POST(
      createBearerRequest("https://example.test/api/device-sync/agent/session/revoke", "hbds_agent_active", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.revokeAgentSession).toHaveBeenCalledWith(session);
    await expect(response.json()).resolves.toEqual({
      agentSession: {
        id: "dsa_active",
        revokedAt: "2026-03-25T01:30:00.000Z",
        revokeReason: "agent_request",
      },
    });
  });
});
