import { afterEach, expect, test, vi } from "vitest";
import { commandHostedRuntimeReplicaPut, commandHostedRuntimeSnapshot, HostedRuntimeResourceRejectedError } from "../src/runtime-resource-client.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { HOSTED_RUNTIME_ATTEMPT_ID_HEADER, HOSTED_RUNTIME_LEASE_GENERATION_HEADER, HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER } from "../src/runner-outbound/headers.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

vi.mock("../src/web-control-plane.ts", () => ({ fetchHostedExecutionWebControlPlaneResponse: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const command = () => commandHostedRuntimeReplicaPut({
  source: createHostedExecutionTestEnv(), userId: "synthetic-member",
  command: { operation: "admit", attemptId: "synthetic-attempt", generation: "1",
    writeId: "synthetic-write", objectKey: "synthetic-replica" },
});

test("preserves the snapshot heartbeat's stale-owner rejection", async () => {
  vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(Response.json({
    error: { code: "HOSTED_RUNTIME_OWNER_STALE", message: "PRIVATE_RESPONSE" },
  }, { status: 409 }));
  const error = await commandHostedRuntimeSnapshot({
    source: createHostedExecutionTestEnv(), userId: "synthetic-member",
    command: { operation: "snapshot_heartbeat", attemptId: "synthetic-attempt", generation: "1", snapshotId: "synthetic-snapshot" },
  }).catch((error: unknown) => error);
  expect(error).toMatchObject({ code: "HOSTED_RUNTIME_OWNER_STALE", status: 409 });
  expect(String(error)).not.toContain("PRIVATE_");
});

test.each([
  [409, "HOSTED_RUNTIME_OWNER_STALE", 409],
  [409, "HOSTED_RUNTIME_RESOURCE_RETIRED", 409],
  [409, "PRIVATE_UNKNOWN", 500],
  [500, "HOSTED_RUNTIME_OWNER_STALE", 500],
] as const)("contains snapshot resource HTTP %s (%s) through the real outbound route", async (upstreamStatus, code, expectedStatus) => {
  vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(Response.json({
    error: { code, message: "PRIVATE_RESPONSE", details: { token: "PRIVATE_SECRET" } },
  }, { status: upstreamStatus }));
  const response = await handleRunnerOutboundRequest(new Request(
    "http://workspace-snapshots.worker/workspace-snapshots/synthetic-snapshot/heartbeat",
    {
      method: "POST", body: JSON.stringify({ snapshotId: "synthetic-snapshot" }),
      headers: { [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "synthetic-attempt", [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "1", [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "0" },
    },
  ), { ...createHostedExecutionTestEnv(), BUNDLES: new MemoryEncryptedR2Bucket() }, "synthetic-member");
  expect(response.status).toBe(expectedStatus);
  const body = await response.text();
  expect(body).not.toContain("PRIVATE_");
  if (expectedStatus === 409) expect(JSON.parse(body)).toMatchObject({ code });
  expect(fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledOnce();
});

test("releases an unread non-conflict rejection body", async () => {
  const cancel = vi.fn();
  vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(new Response(
    new ReadableStream({ cancel }), { status: 503 },
  ));
  await expect(command()).rejects.toThrow("HTTP 503");
  expect(cancel).toHaveBeenCalledOnce();
});

test.each(["HOSTED_RUNTIME_OWNER_STALE", "HOSTED_RUNTIME_RESOURCE_RETIRED"] as const)(
  "preserves the finite replica rejection %s without the response body", async (code) => {
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValue(Response.json({
      error: { code, message: "PRIVATE_RESPONSE", details: { token: "PRIVATE_SECRET" } },
    }, { status: 409 }));
    const error = await command().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(HostedRuntimeResourceRejectedError);
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
  expect(error).not.toBeInstanceOf(HostedRuntimeResourceRejectedError);
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
