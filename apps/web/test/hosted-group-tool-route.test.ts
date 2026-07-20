import {
  HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_GROUP_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleTool: vi.fn(),
  requireJsonCallback: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest: mocks.requireJsonCallback,
}));

vi.mock("@/src/lib/hosted-groups/group-tool", () => ({
  handleHostedRuntimeGroupTool: mocks.handleTool,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/groups/tool/route"
);

let route: RouteModule;

describe("hosted group tool route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/groups/tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireJsonCallback.mockImplementation(async (
      request: Request,
      options: { maxBodyBytes: number },
    ) => {
      const payloadText = await request.text();
      if (new TextEncoder().encode(payloadText).byteLength > options.maxBodyBytes) {
        throw new RangeError(`Request body exceeded ${options.maxBodyBytes} bytes.`);
      }
      return {
        payload: JSON.parse(payloadText),
        userId: "member_group_runtime",
      };
    });
    mocks.handleTool.mockResolvedValue({
      action: "read_shared",
      result: {
        members: [],
        requestedProjectionScopeKeys: ["steps-days.v0"],
        status: "ok",
      },
    });
  });

  it("accepts a valid read_shared callback larger than the former 8 KiB limit", async () => {
    const body = {
      action: "read_shared",
      linqSenderHandles: Array.from(
        { length: 32 },
        (_, index) => `${index}`.padStart(2, "0") + "\0".repeat(64),
      ),
      projectionScopes: [{ projectionKind: "steps-days.v0" }],
    };
    const payloadText = JSON.stringify(body);
    const payloadBytes = new TextEncoder().encode(payloadText).byteLength;
    expect(payloadBytes).toBeGreaterThan(8 * 1_024);
    expect(payloadBytes).toBeLessThanOrEqual(
      HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
    );
    const request = new Request(
      `https://join.example.test${HOSTED_RUNTIME_GROUP_TOOL_PATH}`,
      {
        body: payloadText,
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireJsonCallback).toHaveBeenCalledWith(request, {
      maxBodyBytes: HOSTED_RUNTIME_GROUP_TOOL_REQUEST_MAX_BYTES,
    });
    expect(mocks.handleTool).toHaveBeenCalledWith({
      memberId: "member_group_runtime",
      request: body,
      scheduleMailboxWake: expect.any(Function),
    });
  });
});
