import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseGameRecapCommand, executeGameRecapRequest } from "../scripts/ops-game-recap";
const mocks = vi.hoisted(() => ({ access: vi.fn(), regenerate: vi.fn() }));
vi.mock("../src/lib/hosted-ops/access", () => ({ requireHostedOpsRequestAccess: mocks.access }));
vi.mock("../src/lib/game/recap-regeneration", () => ({ requestGameRecapRegeneration: mocks.regenerate }));
import { POST } from "../app/api/ops/game-recap/route";
import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";
const body = { gameId: "game_synthetic", regenerationId: "request_synthetic" };
const request = (payload: unknown) => new Request("https://www.withmurph.ai/api/ops/game-recap", {
  method: "POST", headers: { Origin: "https://www.withmurph.ai", "Content-Type": "application/json" }, body: JSON.stringify(payload),
});
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ member: { id: "operator_synthetic" } }); mocks.regenerate.mockResolvedValue({ outcome: "would_regenerate" }); });
describe("Ops recap regeneration", () => {
  it.each([undefined, false, true])("requires Ops and same-origin access and executes only for true: %s", async (execute) => {
    const response = await POST(request({ ...body, execute }));
    expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith(expect.any(Request), { requireMutationOrigin: true });
    expect(mocks.regenerate).toHaveBeenCalledWith({ ...body, execute: execute === true, operatorMemberId: "operator_synthetic" });
  });
  it.each([401, 404])("refuses unauthenticated/non-operator access before admission: %s", async (httpStatus) => {
    mocks.access.mockRejectedValue(hostedOnboardingError({ code: "HOSTED_OPS_ACCESS_DENIED", httpStatus, message: "Unavailable." }));
    expect((await POST(request({ ...body, execute: true }))).status).toBe(httpStatus);
    expect(mocks.regenerate).not.toHaveBeenCalled();
  });
  it.each([{ ...body, execute: "true" }, { ...body, gameIds: [body.gameId] }, { ...body, regenerationId: "" }, { ...body, gameId: [] }])("rejects malformed requests", async (payload) => {
    expect((await POST(request(payload))).status).toBe(400); expect(mocks.regenerate).not.toHaveBeenCalled();
  });
  it("defaults the command to dry run and requires a reusable explicit id", () => {
    const args = ["--game-id", body.gameId, "--regeneration-id", body.regenerationId];
    expect(parseGameRecapCommand(args)).toEqual({ ...body, execute: false });
    expect(parseGameRecapCommand([...args, "--execute"])).toEqual({ ...body, execute: true });
    expect(() => parseGameRecapCommand(["--game-id", body.gameId, "--execute"])).toThrow();
    expect(() => parseGameRecapCommand([...args, "--endpoint", "https://example.test"])).toThrow();
  });
  it("uses the canonical Ops session without retries and prints only safe outcome metadata", async () => {
    const dispose = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: () => true, body: async () => Buffer.from(JSON.stringify({ outcome: "reserved", recap: "private content" })), dispose });
    expect(await executeGameRecapRequest({ fetch }, { ...body, execute: true })).toEqual({ ...body, dryRun: false, outcome: "reserved" });
    expect(fetch).toHaveBeenCalledWith("https://www.withmurph.ai/api/ops/game-recap", expect.objectContaining({ method: "POST", maxRedirects: 0, maxRetries: 0, data: { ...body, execute: true } }));
    expect(dispose).toHaveBeenCalledOnce();
  });
});
