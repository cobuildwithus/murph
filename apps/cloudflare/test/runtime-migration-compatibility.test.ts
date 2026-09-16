import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandHostedRuntimeMigration } from "../src/runtime-migration-client.ts";
import { readRuntimeMigrationCompatibility } from "../src/runtime-migration-compatibility.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { HOSTED_RUNTIME_NAMESPACE_PROBE_NAME } from "@murphai/hosted-execution/runtime-migration";
vi.mock("../src/web-control-plane.ts", () => ({ fetchHostedExecutionWebControlPlaneResponse: vi.fn() }));
function harness() {
  const idFromName = vi.fn(() => ({ toString: () => "a".repeat(64) }));
  const getByName = vi.fn(); const get = vi.fn();
  const source = { ...createHostedExecutionTestEnv(), USER_RUNNER: { idFromName, getByName, get } };
  return { source, idFromName, getByName, get };
}
describe("namespace-bound compatible releases", () => {
  beforeEach(() => vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockReset()
    .mockResolvedValue(new Response(JSON.stringify({ objectId: null }), { status: 200 })));
  it("derives the fixed namespace identity without accessing an object", () => {
    const h = harness();
    expect(readRuntimeMigrationCompatibility(h.source)).toEqual({ protocol: "member-handoff-v1", namespaceProbeId: "a".repeat(64) });
    expect(h.idFromName).toHaveBeenCalledExactlyOnceWith(HOSTED_RUNTIME_NAMESPACE_PROBE_NAME);
    expect(h.getByName).not.toHaveBeenCalled(); expect(h.get).not.toHaveBeenCalled();
  });
  it("replaces a supplied compatibility assertion with the actual signed sender binding", async () => {
    const h = harness();
    await commandHostedRuntimeMigration({ source: h.source, command: { operation: "next_object",
      namespaceId: "synthetic_namespace", workerVersion: "synthetic_compatible_release",
      compatibility: { protocol: "invented-protocol", namespaceProbeId: "b".repeat(64) } } });
    const input = vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mock.calls[0]![0];
    expect(JSON.parse(String(input.body))).toEqual({ operation: "next_object", namespaceId: "synthetic_namespace",
      workerVersion: "synthetic_compatible_release", compatibility: { protocol: "member-handoff-v1", namespaceProbeId: "a".repeat(64) } });
    expect(h.getByName).not.toHaveBeenCalled(); expect(h.get).not.toHaveBeenCalled();
  });
  it("refuses missing or invalid namespace capability before sending a mutation", async () => {
    const h = harness(); h.idFromName.mockReturnValue({ toString: () => "invalid" });
    await expect(commandHostedRuntimeMigration({ source: h.source, command: { operation: "begin_rolling",
      namespaceId: "synthetic_namespace", workerVersion: "synthetic_release" } })).rejects.toThrow("namespace binding is invalid");
    expect(fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
    expect(() => readRuntimeMigrationCompatibility(createHostedExecutionTestEnv())).toThrow("namespace addressing");
  });
});
