import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleTool: vi.fn(),
  requireJsonCallback: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackJsonRequest: mocks.requireJsonCallback,
}));

vi.mock("@/src/lib/hosted-execution/imessage-contact-tool", () => ({
  handleHostedRuntimeIMessageContactTool: mocks.handleTool,
}));

type RouteModule = typeof import(
  "../app/api/internal/hosted-execution/imessage-contact/tool/route"
);

let route: RouteModule;

const ASSISTANT_INPUT_ID = `ain_${"a".repeat(32)}`;

describe("hosted iMessage contact tool route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-execution/imessage-contact/tool/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireJsonCallback.mockImplementation(async (request: Request) => ({
      payload: await request.json(),
      userId: "member_bound",
    }));
    mocks.handleTool.mockResolvedValue({
      phoneNumber: "+15550100001",
      status: "assigned",
      verifiedSenderPhoneHint: "*** 0009",
    });
  });

  it("derives the member from the signed callback before invoking the handler", async () => {
    const body = { assistantInputId: ASSISTANT_INPUT_ID };
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-execution/imessage-contact/tool",
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireJsonCallback).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 1_024 },
    );
    expect(mocks.handleTool).toHaveBeenCalledWith({
      memberId: "member_bound",
      request: body,
    });
  });

  it.each([
    ["memberId", { memberId: "member_other" }],
    ["phoneNumber", { phoneNumber: "+15550100009" }],
  ] as const)(
    "rejects model-supplied %s authority",
    async (_field, authority) => {
      const response = await route.POST(new Request(
        "https://join.example.test/api/internal/hosted-execution/imessage-contact/tool",
        {
          body: JSON.stringify({
            assistantInputId: ASSISTANT_INPUT_ID,
            ...authority,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ));

      expect(response.status).toBe(400);
      expect(mocks.requireJsonCallback).toHaveBeenCalledOnce();
      expect(mocks.handleTool).not.toHaveBeenCalled();
    },
  );
});
