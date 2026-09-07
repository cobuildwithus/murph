import { describe, expect, it, vi } from "vitest";
import {
  readHostedRunnerDeployment,
  scopeHostedRunnerReleaseEnvironment,
} from "../src/hosted-runner-release.ts";
import {
  createHostedRunnerContainerNamespaceRouter,
  createHostedRunnerSlotName,
  resolveHostedRunnerReleaseId,
} from "../src/standby-runner-contract.ts";
import { requireRetainedRunnerRequest } from "../src/runner-slot-binding.ts";

const primary = { bank: "primary", id: "primary-old", bundleFingerprint: "a".repeat(64), sourceFingerprint: "b".repeat(64) };
const next = { bank: "next", id: "next-new", bundleFingerprint: "c".repeat(64), sourceFingerprint: "d".repeat(64) };
const source = (promoted: boolean) => ({
  CF_VERSION_METADATA: { id: promoted ? "worker-promoted" : "worker-preparing" },
  HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(promoted
    ? { active: next, candidate: null, previous: primary }
    : { active: primary, candidate: next, previous: null }),
});

describe("staged runner release", () => {
  it("holds the active release stable during preparation and changes it only on promotion", () => {
    expect(resolveHostedRunnerReleaseId(source(false))).toBe(primary.id);
    expect(resolveHostedRunnerReleaseId(source(true))).toBe(next.id);
    expect(resolveHostedRunnerReleaseId(scopeHostedRunnerReleaseEnvironment(source(false), "candidate")))
      .toBe(next.id);
  });

  it("routes retained exact owners independently of the active release", () => {
    const primaryGet = vi.fn();
    const nextGet = vi.fn();
    const router = createHostedRunnerContainerNamespaceRouter({
      exactUser: { getByName: primaryGet }, next: { getByName: nextGet }, standby: null,
    })!;
    const oldName = createHostedRunnerSlotName(primary.id);
    const newName = createHostedRunnerSlotName(next.id);
    router.getByName(oldName);
    router.getByName(newName);
    router.getByName(oldName);
    expect(primaryGet.mock.calls).toEqual([[oldName], [oldName]]);
    expect(nextGet.mock.calls).toEqual([[newName]]);
  });

  it("authorizes cleanup against the promoted release while preserving the old target identity", () => {
    const slotName = createHostedRunnerSlotName(primary.id);
    const env = scopeHostedRunnerReleaseEnvironment(source(true), "primary");
    const request = { currentReleaseId: next.id, region: "GLOBAL" as const, slotName, userId: "member_test" };
    const binding = { state: "bound" as const, claimId: "a".repeat(32), releaseId: primary.id, region: "GLOBAL" as const, slotName, userId: "member_test" };
    expect(requireRetainedRunnerRequest(env, binding, request)).toMatchObject({
      targetReleaseId: primary.id, slotName,
    });
    expect(() => requireRetainedRunnerRequest(env, binding, { ...request, userId: "member_other" }))
      .toThrow("another member");
  });

  it("rejects two releases that address the same mutable image target", () => {
    expect(() => readHostedRunnerDeployment({ HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify({
      active: primary, candidate: { ...next, bank: "primary", id: "primary-new" }, previous: null,
    }) })).toThrow("identity is invalid");
  });
});
