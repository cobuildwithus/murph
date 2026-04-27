import { parseHostedRuntimeShareImportResponse } from "@murphai/hosted-execution/parsers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  finalizeHostedShareAcceptance: vi.fn(),
  getPrisma: vi.fn(),
  releaseHostedShareAcceptance: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-share/shared", () => ({
  finalizeHostedShareAcceptance: mocks.finalizeHostedShareAcceptance,
  releaseHostedShareAcceptance: mocks.releaseHostedShareAcceptance,
}));

type HostedShareImportRecordRouteModule =
  typeof import("../app/api/internal/hosted-execution/share/import/route");

let hostedShareImportRecordRoute: HostedShareImportRecordRouteModule;

describe("hosted share import record route", () => {
  beforeAll(async () => {
    hostedShareImportRecordRoute = await import(
      "../app/api/internal/hosted-execution/share/import/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_recipient");
    mocks.finalizeHostedShareAcceptance.mockResolvedValue({
      finalized: true,
      shareFound: true,
      sharePackOwnerMemberId: "member_sender",
    });
    mocks.releaseHostedShareAcceptance.mockResolvedValue(true);
  });

  it("records imported shares against the exact accepted event", async () => {
    const prisma = createPrisma({
      acceptedByMemberId: "member_recipient",
      id: "share_123",
      senderMemberId: "member_sender",
    });
    mocks.getPrisma.mockReturnValue(prisma);
    const body = {
      eventId: "event_accepted_123",
      importedAt: "2026-04-26T00:00:05.000Z",
      ownerUserId: "member_sender",
      shareId: "share_123",
      status: "imported",
    };

    const response = await hostedShareImportRecordRoute.POST(
      jsonRequest("/api/internal/hosted-execution/share/import", body),
    );
    const payload = parseHostedRuntimeShareImportResponse(await response.json());

    expect(response.status).toBe(200);
    expect(prisma.hostedShareLink.findFirst).toHaveBeenCalledWith({
      select: {
        acceptedByMemberId: true,
        id: true,
        senderMemberId: true,
      },
      where: {
        acceptedByMemberId: "member_recipient",
        id: "share_123",
        lastEventId: "event_accepted_123",
        senderMemberId: "member_sender",
      },
    });
    expect(mocks.finalizeHostedShareAcceptance).toHaveBeenCalledWith({
      eventId: "event_accepted_123",
      memberId: "member_recipient",
      prisma,
      shareId: "share_123",
    });
    expect(mocks.releaseHostedShareAcceptance).not.toHaveBeenCalled();
    expect(payload).toEqual({
      recorded: true,
      shareId: "share_123",
      status: "imported",
    });
  });

  it("ignores stale share import callbacks for superseded acceptance events", async () => {
    const prisma = createPrisma(null);
    mocks.getPrisma.mockReturnValue(prisma);
    const body = {
      eventId: "event_old",
      importedAt: "2026-04-26T00:00:05.000Z",
      ownerUserId: "member_sender",
      shareId: "share_123",
      status: "quarantined",
    };

    const response = await hostedShareImportRecordRoute.POST(
      jsonRequest("/api/internal/hosted-execution/share/import", body),
    );
    const payload = parseHostedRuntimeShareImportResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.finalizeHostedShareAcceptance).not.toHaveBeenCalled();
    expect(mocks.releaseHostedShareAcceptance).not.toHaveBeenCalled();
    expect(payload).toEqual({
      recorded: false,
      shareId: "share_123",
      status: "quarantined",
    });
  });
});

function createPrisma(record: {
  acceptedByMemberId: string;
  id: string;
  senderMemberId: string;
} | null) {
  return {
    hostedShareLink: {
      findFirst: vi.fn(async () => record),
    },
  };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://join.example.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}
