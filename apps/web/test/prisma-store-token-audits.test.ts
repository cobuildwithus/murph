import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaHostedTokenAuditStore } from "@/src/lib/device-sync/prisma-store/token-audits";

describe("PrismaHostedTokenAuditStore logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts session-linked identifiers from token audit logs", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const createSpy = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      action: "token_exported",
      channel: "agent_export",
      connectionId: "dsc_123",
      createdAt: new Date("2026-04-05T00:00:00.000Z"),
      id: 7,
      keyVersion: "v1",
      provider: "oura",
      sessionId: null,
      tokenVersion: 3,
      userId: "user-123",
    }));
    const store = new PrismaHostedTokenAuditStore({
      deviceTokenAudit: {
        create: createSpy,
      },
    } as never);

    await store.createTokenAudit({
      action: "token_exported",
      channel: "agent_export",
      connectionId: "dsc_123",
      keyVersion: "v1",
      provider: "oura",
      sessionId: "sess_123",
      tokenVersion: 3,
      userId: "user-123",
    });

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sessionId: null,
      }),
    }));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0]?.[0] ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({
      action: "token_exported",
      channel: "agent_export",
      connectionScoped: true,
      createdAt: "2026-04-05T00:00:00.000Z",
      event: "device_sync_token_audit",
      hasSessionContext: true,
      keyVersion: "v1",
      provider: "oura",
      tokenVersion: 3,
    });
    expect(payload).not.toHaveProperty("connectionId");
    expect(payload).not.toHaveProperty("sessionId");
    expect(payload).not.toHaveProperty("userId");
  });
});
