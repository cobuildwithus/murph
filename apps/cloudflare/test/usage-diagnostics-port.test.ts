import { afterEach, describe, expect, it } from "vitest";
import { HOSTED_RUNTIME_USAGE_DIAGNOSTICS_PATH } from "@murphai/hosted-execution/routes";
import { createHostedRuntimeUsageDiagnosticsPort } from "../src/runtime-platform/usage-diagnostics-port.ts";
import { startHostedWebControlStub, type HostedWebControlStub } from "./helpers/hosted-web-control-support.js";
let stub: HostedWebControlStub | null = null;
afterEach(async () => { await stub?.stop(); stub = null; });
describe("usage diagnostics signed transport", () => {
  it("binds identity and bounded options and validates the response", async () => {
    stub = await startHostedWebControlStub({ respond: () => ({ body: { status: "unavailable", reason: "group_not_supported" } }) });
    const port = createHostedRuntimeUsageDiagnosticsPort({ boundUserId: "member_bound", fetchImpl: fetch, timeoutMs: 2000, transport: stub.transport });
    await expect(port.read({ days: 7, limit: 10 })).resolves.toEqual({ status: "unavailable", reason: "group_not_supported" });
    expect(stub.observedRequests[0]).toMatchObject({ body: '{"days":7,"limit":10}', method: "POST", userId: "member_bound", url: HOSTED_RUNTIME_USAGE_DIAGNOSTICS_PATH, keyId: "v1" });
    expect(stub.observedRequests[0]?.signature).toMatch(/^[A-Za-z0-9_-]+$/u);
  });
  it("rejects unexpected content in a control response", async () => {
    stub = await startHostedWebControlStub({ respond: () => ({ body: { status: "unavailable", reason: "group_not_supported", prompt: "synthetic private content" } }) });
    const port = createHostedRuntimeUsageDiagnosticsPort({ boundUserId: "member_bound", fetchImpl: fetch, timeoutMs: 2000, transport: stub.transport });
    await expect(port.read({})).rejects.toThrow("Hosted usage diagnostics returned invalid JSON.");
  });
});
