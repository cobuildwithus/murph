import { afterEach, expect, test, vi } from "vitest";
import { commandHostedRuntimeReplicaPut, HostedRuntimeReplicaPutRejectedError } from "../src/runtime-resource-client.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

vi.mock("../src/web-control-plane.ts", () => ({ fetchHostedExecutionWebControlPlaneResponse: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const command = () => commandHostedRuntimeReplicaPut({
  source: createHostedExecutionTestEnv(), userId: "synthetic-member",
  command: { operation: "admit", attemptId: "synthetic-attempt", generation: "1",
    writeId: "synthetic-write", objectKey: "synthetic-replica" },
});

test.each(["HOSTED_RUNTIME_OWNER_STALE", "HOSTED_RUNTIME_RESOURCE_RETIRED"] as const)(
  "preserves the finite replica rejection %s without the response body", async (code) => {
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(Response.json({
      error: { code, message: "PRIVATE_RESPONSE", details: { token: "PRIVATE_SECRET" } },
    }, { status: 409 }));
    const error = await command().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(HostedRuntimeReplicaPutRejectedError);
    expect(error).toMatchObject({ code, status: 409 });
    expect(String(error)).not.toContain("PRIVATE_");
    expect(JSON.stringify(error)).not.toContain("PRIVATE_");
    expect(fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledOnce();
  },
);

test.each([
  [409, JSON.stringify({ error: { code: "PRIVATE_UNKNOWN", message: "PRIVATE_RESPONSE" } })],
  [409, "PRIVATE_INVALID_JSON"],
  [409, "PRIVATE_OVERSIZED".repeat(200)],
  [500, JSON.stringify({ error: { code: "HOSTED_RUNTIME_OWNER_STALE" } })],
] as const)("keeps unrecognized replica failures closed (%s)", async (status, body) => {
  vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(new Response(body, { status }));
  const error = await command().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(HostedRuntimeReplicaPutRejectedError);
  expect(String(error)).toContain(`HTTP ${status}`);
  expect(String(error)).not.toContain("PRIVATE_");
});

test("preserves admitted and already-applied replica results", async () => {
  vi.mocked(fetchHostedExecutionWebControlPlaneResponse)
    .mockResolvedValueOnce(Response.json({ applied: true }))
    .mockResolvedValueOnce(Response.json({ applied: false }));
  expect(await command()).toBe(true);
  expect(await command()).toBe(false);
});
