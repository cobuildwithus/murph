import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  filterResponse: vi.fn((value: unknown) => value),
  handleGroupTool: vi.fn(),
  parseRequest: vi.fn((value: unknown) => value),
  readRawBodyBuffer: vi.fn(),
  readSupportedProjectionScopes: vi.fn(() => new Set<string>()),
  requireCallback: vi.fn(),
  withJsonError: vi.fn((handler: (...args: never[]) => Promise<Response>) => handler),
}));

vi.mock("@murphai/hosted-execution/parsers", () => ({
  parseHostedRuntimeGroupToolRequest: mocks.parseRequest,
}));

vi.mock("@/src/lib/hosted-groups/group-tool", () => ({
  handleHostedRuntimeGroupTool: mocks.handleGroupTool,
}));

vi.mock("@/src/lib/hosted-groups/group-tool-scope-filter", () => ({
  filterHostedRuntimeGroupToolResponseProjectionScopes: mocks.filterResponse,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireCallback,
}));

vi.mock("@/src/lib/hosted-onboarding/http", () => ({
  jsonOk: (value: unknown) => Response.json(value),
  withJsonError: mocks.withJsonError,
}));

vi.mock("@/src/lib/hosted-vault-share/supported-projection-scopes", () => ({
  readHostedVaultShareSupportedProjectionScopeKeysFromRequest:
    mocks.readSupportedProjectionScopes,
}));

vi.mock("@/src/lib/http", () => ({
  readRawBodyBuffer: mocks.readRawBodyBuffer,
}));

import { POST } from "../app/api/internal/hosted-execution/groups/tool/route";

describe("hosted group tool route capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readRawBodyBuffer.mockResolvedValue(Buffer.from('{"action":"read_current"}'));
    mocks.requireCallback.mockResolvedValue("member_123");
    mocks.handleGroupTool.mockResolvedValue({
      action: "read_current",
      result: { group: null, status: "none" },
    });
  });

  it("requests hosted-group membership only for the v1 capability", async () => {
    await POST(new Request(
      "https://web.example.test/api/internal/hosted-execution/groups/tool"
        + "?participantMembership=v1",
      { method: "POST" },
    ));

    expect(mocks.handleGroupTool).toHaveBeenCalledWith({
      includeHostedGroupMembership: true,
      memberId: "member_123",
      request: { action: "read_current" },
    });
  });

  it("preserves the legacy participant response shape without the capability", async () => {
    await POST(new Request(
      "https://web.example.test/api/internal/hosted-execution/groups/tool",
      { method: "POST" },
    ));

    expect(mocks.handleGroupTool).toHaveBeenCalledWith({
      includeHostedGroupMembership: false,
      memberId: "member_123",
      request: { action: "read_current" },
    });
  });
});
