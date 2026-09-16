import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { enrollRuntimeMembers } from "../src/worker/route-handlers/runtime-migration-enrollment.ts";
import type { WorkerEnvironmentSource } from "../src/worker-routes/shared.ts";
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
});
