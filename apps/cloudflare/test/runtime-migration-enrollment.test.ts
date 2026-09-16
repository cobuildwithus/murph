import { readHostedExecutionEnvironment } from "../src/env.ts";
import { runtimeMigrationRoutes } from "../src/worker/route-handlers/runtime-migration.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { enrollRuntimeMembers } from "../src/worker/route-handlers/runtime-migration-enrollment.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";
const advance = vi.hoisted(() => ({ member: vi.fn(), empty: vi.fn() }));
vi.mock("../src/worker/route-handlers/runtime-member-migration.ts", () => ({ advanceRuntimeMemberMigration: advance.member, advanceRuntimeEmptyMigration: advance.empty }));
const canonical = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../src/runtime-migration-client.ts", () => ({ commandHostedRuntimeMigration: canonical.command }));
const identity = { namespaceId: "synthetic-namespace", workerVersion: "synthetic-version" };
const objectId = (userId: string) => createHash("sha256").update(userId).digest("hex");

function harness() {
  canonical.command.mockReset();
  const getByName = vi.fn((): never => { throw new Error("Enrollment must not obtain a source stub."); });
  const idFromName = vi.fn((userId: string) => ({ toString: () => objectId(userId) }));
  const unused = async (): Promise<never> => { throw new Error("Enrollment must not touch runtime resources."); };
  const source: WorkerEnvironmentSource = { USER_RUNNER: { getByName, idFromName }, BUNDLES: { get: unused, put: unused },
    RUNNER_CONTAINER: { getByName }, RUNNER_CONTAINER_SMOKE: { getByName } };
  return { source, idFromName, getByName };
}

describe("canonical migration source enrollment", () => {
  it("binds exact namespace IDs for personal and group members without materializing sources", async () => {
    const h = harness(); const userIds = ["synthetic-personal", "synthetic-group-runtime"];
    canonical.command.mockResolvedValueOnce({ userIds }).mockResolvedValueOnce({ enrolled: 2 });
    expect(await enrollRuntimeMembers(h.source, identity)).toEqual({ enrolled: 2 });
    expect(canonical.command.mock.calls.map(([arg]) => arg.command)).toEqual([
      { operation: "list_unenrolled", ...identity },
      { operation: "enroll_sources", ...identity, bindings: userIds.map(userId => ({ userId, objectId: objectId(userId) })) },
    ]);
    expect(h.getByName).not.toHaveBeenCalled();
    expect(h.idFromName).toHaveBeenCalledTimes(2);
  });

  it("does no namespace work after the bounded canonical census is exhausted", async () => {
    const h = harness(); canonical.command.mockResolvedValue({ userIds: [] });
    expect(await enrollRuntimeMembers(h.source, identity)).toEqual({ enrolled: 0 });
    expect(h.idFromName).not.toHaveBeenCalled(); expect(h.getByName).not.toHaveBeenCalled();
    expect(canonical.command).toHaveBeenCalledOnce();
  });

  it("retries an ambiguous binding with the same deterministic source identities", async () => {
    const h = harness(); const userIds = ["synthetic-retry"];
    canonical.command.mockResolvedValueOnce({ userIds }).mockRejectedValueOnce(new Error("synthetic lost enrollment reply"))
      .mockResolvedValueOnce({ userIds }).mockResolvedValueOnce({ enrolled: 1 });
    await expect(enrollRuntimeMembers(h.source, identity)).rejects.toThrow("lost enrollment reply");
    expect(await enrollRuntimeMembers(h.source, identity)).toEqual({ enrolled: 1 });
    expect(canonical.command.mock.calls[1]![0].command).toEqual(canonical.command.mock.calls[3]![0].command);
    expect(h.getByName).not.toHaveBeenCalled();
  });
  it("keeps enrollment pending when a duplicate-only cleanup page has more encrypted identities", async () => {
    const h = harness(); canonical.command.mockResolvedValueOnce({ userIds: [], cleanupPending: true });
    expect(await enrollRuntimeMembers(h.source, identity)).toEqual({ enrolled: 0, cleanupPending: true });
    expect(h.idFromName).not.toHaveBeenCalled(); expect(h.getByName).not.toHaveBeenCalled();
    canonical.command.mockResolvedValueOnce({ userIds: ["synthetic-later-page"], cleanupPending: true }).mockResolvedValueOnce({ enrolled: 1 });
    expect(await enrollRuntimeMembers(h.source, identity)).toEqual({ enrolled: 1, cleanupPending: true });
  });

});


describe("operator HTTP command identity boundary", () => {
  async function request(operation: "enroll_members" | "advance_member" | "advance_empty") {
    const h = harness();
    const unused = async (): Promise<never> => { throw new Error("Unexpected source effect"); };
    const stub = { bindUser: unused, deleteHostedUserData: unused, publishHostedPrivateMedia: unused, ensureRuntimeProcessingForUser: unused, runnerStatus: unused };
    const env = { ...createHostedExecutionTestEnv(), ...h.source, HOSTED_RUNTIME_POSTGRES_ENABLED: "true",
      CF_VERSION_METADATA: { id: identity.workerVersion }, USER_RUNNER: { ...h.source.USER_RUNNER,
        idFromString: (id: string) => ({ toString: () => id }), get: () => stub } };
    // Advance is mocked only after the actual handler has parsed and projected the command.
    canonical.command.mockResolvedValueOnce({ userIds: ["synthetic-member"] }).mockResolvedValueOnce({ enrolled: 1 });
    const body = { ...identity, operation, ...(operation === "enroll_members" ? {} : { objectId: objectId("synthetic-member") }),
      ...(operation === "advance_member" ? { userId: "synthetic-member", migrationId: "synthetic-handoff" } : {}) };
    const url = new URL("https://worker.invalid/internal/runtime-migration");
    const response = await runtimeMigrationRoutes[0]!.handle({ env, environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
      url, request: new Request(url, { method: "POST", body: JSON.stringify(body) }) }, {});
    return { response, body };
  }
  it("enrolls through canonical commands when the operator payload contains its operation", async () => {
    const { response } = await request("enroll_members");
    expect(await response.json()).toEqual({ enrolled: 1 });
    expect(canonical.command.mock.calls.map(([arg]) => arg.command.operation)).toEqual(["list_unenrolled", "enroll_sources"]);
  });
  it.each(["advance_member", "advance_empty"] as const)("keeps %s out of the identity passed to source RPCs", async operation => {
    const fn = operation === "advance_member" ? advance.member : advance.empty;
    fn.mockReset().mockResolvedValue({ pending: "readiness" });
    const { body } = await request(operation);
    const { operation: _operation, ...expectedIdentity } = body;
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0]![0].identity).toEqual(expectedIdentity);
  });
});
