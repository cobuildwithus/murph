import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ callback: vi.fn(), tool: vi.fn() }));
vi.mock("../src/lib/hosted-execution/cloudflare-callback-auth", () => ({ requireHostedCloudflareCallbackJsonRequest: m.callback }));
vi.mock("../src/lib/hosted-polls/tool", () => ({ handleHostedConversationPollTool: m.tool }));
import { POST } from "../app/api/internal/hosted-execution/polls/tool/route";
describe("hosted poll route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.callback.mockImplementation(async (request: Request) => ({ payload: await request.json(), userId: "member_bound" }));
    m.tool.mockResolvedValue({ status: "listed", polls: [] });
  });
  function request(body: unknown) {
    return new Request("https://web.example.test/api/internal/hosted-execution/polls/tool", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  }
  it("derives the member from the signed callback", async () => {
    const body = { assistantInputId: "ain_" + "a".repeat(32), request: { action: "list" } };
    expect((await POST(request(body))).status).toBe(200);
    expect(m.callback).toHaveBeenCalledWith(expect.any(Request), { maxBodyBytes: 8_192, runtimeAuthority: "caller_transaction" });
    expect(m.tool).toHaveBeenCalledExactlyOnceWith({ memberId: "member_bound", runtimeIdentity: null, request: body });
  });
  it("rejects model-selected members or destinations before effects", async () => {
    const response = await POST(request({ assistantInputId: "ain_" + "a".repeat(32), request: { action: "list", chatId: "other" }, memberId: "other" }));
    expect(response.status).toBe(400); expect(m.tool).not.toHaveBeenCalled();
  });
});
