import { parseHostedRuntimeVaultSyncImportResponse } from "@murphai/hosted-execution/parsers";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordHostedVaultSyncImportResult: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/vault-sync/session-service", () => ({
  recordHostedVaultSyncImportResult: mocks.recordHostedVaultSyncImportResult,
}));

type HostedVaultSyncImportRecordRouteModule =
  typeof import("../app/api/internal/hosted-execution/vault-sync/import/route");

let hostedVaultSyncImportRecordRoute: HostedVaultSyncImportRecordRouteModule;

describe("hosted vault sync import record route", () => {
  beforeAll(async () => {
    hostedVaultSyncImportRecordRoute = await import(
      "../app/api/internal/hosted-execution/vault-sync/import/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.recordHostedVaultSyncImportResult.mockResolvedValue({
      recorded: true,
      sessionId: "vsi_123",
      status: "imported",
    });
  });

  it("authenticates the runtime callback and records the vault-sync import result for that member", async () => {
    const body = {
      importedAt: "2026-04-21T00:02:00.000Z",
      sessionId: "vsi_123",
      status: "imported",
      summary: {
        conflictCount: 0,
        importedJsonlRecords: 10,
        importedRawFiles: 1,
        importedTextFiles: 3,
        skippedDuplicates: 4,
        skippedExcludedFiles: 5,
      },
    };
    const request = jsonRequest("/api/internal/hosted-execution/vault-sync/import", body);

    const response = await hostedVaultSyncImportRecordRoute.POST(request);
    const payload = parseHostedRuntimeVaultSyncImportResponse(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(request);
    expect(mocks.recordHostedVaultSyncImportResult).toHaveBeenCalledWith({
      memberId: "member_123",
      request: body,
    });
    expect(payload).toEqual({
      recorded: true,
      sessionId: "vsi_123",
      status: "imported",
    });
  });
});

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://join.example.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}
