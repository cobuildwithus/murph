import { describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => {
  const service = {
    osControl: vi.fn(),
  };

  return {
    createComputerUseService: vi.fn(() => service),
    jsonOk: vi.fn((body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    ),
    readSignedComputerOsControlRequest: vi.fn(),
    resolveDecodedRouteParam: vi.fn(),
    service,
    withHostedComputerToolFailureRuntimeLog: vi.fn(async (input: {
      run: () => Promise<unknown>;
    }) => await input.run()),
    withJsonError: vi.fn((handler: unknown) => handler),
  };
});

vi.mock("@/src/lib/computer-use/http", () => ({
  jsonOk: routeMocks.jsonOk,
  readSignedComputerOsControlRequest: routeMocks.readSignedComputerOsControlRequest,
  resolveDecodedRouteParam: routeMocks.resolveDecodedRouteParam,
  withJsonError: routeMocks.withJsonError,
}));

vi.mock("@/src/lib/computer-use/runtime-log", () => ({
  withHostedComputerToolFailureRuntimeLog: routeMocks.withHostedComputerToolFailureRuntimeLog,
}));

vi.mock("@/src/lib/computer-use/service", () => ({
  createComputerUseService: routeMocks.createComputerUseService,
}));

import { POST } from "../app/api/internal/computer/runs/[runId]/os-control/route";

describe("hosted computer os-control route", () => {
  it("runs signed OS-control requests through the member-scoped service and runtime-log wrapper", async () => {
    const body = {
      action: "typeText",
      text: "canary-sensitive-input",
    };
    const result = {
      action: "typeText",
      ok: true,
      runId: "hcr_run123",
      status: "running",
    };
    routeMocks.readSignedComputerOsControlRequest.mockResolvedValueOnce({
      body,
      memberId: "member_123",
    });
    routeMocks.resolveDecodedRouteParam.mockResolvedValueOnce("hcr_run123");
    routeMocks.service.osControl.mockResolvedValueOnce(result);

    const response = await POST(
      new Request("https://web.example.test/api/internal/computer/runs/hcr_run123/os-control", {
        body: JSON.stringify(body),
        method: "POST",
      }),
      {
        params: Promise.resolve({ runId: "hcr_run123" }),
      },
    );

    await expect(response.json()).resolves.toEqual(result);
    expect(routeMocks.createComputerUseService).toHaveBeenCalledTimes(1);
    expect(routeMocks.resolveDecodedRouteParam).toHaveBeenCalledWith(
      expect.any(Promise),
      "runId",
    );
    expect(routeMocks.withHostedComputerToolFailureRuntimeLog).toHaveBeenCalledWith({
      action: body,
      memberId: "member_123",
      operation: "os-control",
      run: expect.any(Function),
    });
    expect(routeMocks.service.osControl).toHaveBeenCalledWith({
      ...body,
      memberId: "member_123",
      runId: "hcr_run123",
    });
  });
});
