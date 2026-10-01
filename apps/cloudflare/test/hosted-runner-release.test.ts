import { describe, expect, it, vi } from "vitest";
import {
  hostedRunnerImageMatches,
  readHostedRunnerDeployment,
  scopeHostedRunnerReleaseEnvironment,
} from "../src/hosted-runner-release.ts";
import {
  readHostedStandbyTarget,
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
  it.each(["primary", "next"] as const)(
    "admits whole image pairs in the serving %s bank without suppressing its target",
    (bank) => {
      const active = bank === "primary" ? primary : next;
      const previous = bank === "primary" ? next : primary;
      const candidate = { ...active, bundleFingerprint: "e".repeat(64), sourceFingerprint: "f".repeat(64), image: `registry.example.test/runner@sha256:${"a".repeat(64)}` };
      const source: Record<string, unknown> = { HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify({ active, candidate, previous }) };
      for (const target of [bank, "candidate"] as const) {
        const env = scopeHostedRunnerReleaseEnvironment(source, target);
        expect(resolveHostedRunnerReleaseId(env)).toBe(active.id);
        expect(env.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT).toBe(candidate.bundleFingerprint);
        expect(readHostedStandbyTarget(env)).toBe(2);
        expect(readHostedStandbyTarget({ ...env, HOSTED_EXECUTION_STANDBY_TARGET: "3" })).toBe(3);
        expect(readHostedStandbyTarget({ ...env, HOSTED_EXECUTION_STANDBY_TARGET: "0" })).toBe(0);
        expect(hostedRunnerImageMatches(env, active.bundleFingerprint, active.sourceFingerprint)).toBe(true);
        expect(hostedRunnerImageMatches(env, candidate.bundleFingerprint, candidate.sourceFingerprint)).toBe(true);
        for (const [bundle, fingerprint] of [
          [active.bundleFingerprint, candidate.sourceFingerprint],
          [candidate.bundleFingerprint, active.sourceFingerprint],
          [previous.bundleFingerprint, previous.sourceFingerprint],
          ["9".repeat(64), "8".repeat(64)],
          [undefined, undefined],
          [candidate.bundleFingerprint, undefined],
          [null, candidate.sourceFingerprint],
        ]) expect(hostedRunnerImageMatches(env, bundle, fingerprint)).toBe(false);
        for (const invalid of [null, -1, 33, 1.5, "invalid"]) {
          expect(() => readHostedStandbyTarget({ ...env, HOSTED_EXECUTION_STANDBY_TARGET: invalid }))
            .toThrow("must be an integer");
        }
      }
      // Scoping the previous bank must not inherit the serving bank's pair union.
      const previousEnv = scopeHostedRunnerReleaseEnvironment(source, previous.bank as "primary" | "next");
      expect(hostedRunnerImageMatches(previousEnv, previous.bundleFingerprint, previous.sourceFingerprint)).toBe(true);
      expect(hostedRunnerImageMatches(previousEnv, active.bundleFingerprint, active.sourceFingerprint)).toBe(false);
      expect(hostedRunnerImageMatches(previousEnv, candidate.bundleFingerprint, candidate.sourceFingerprint)).toBe(false);
      for (const selected of [active, candidate]) {
        const stable = scopeHostedRunnerReleaseEnvironment({ HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify({ active: selected, candidate: null, previous }) }, bank);
        expect(readHostedStandbyTarget(stable)).toBe(2);
        expect(hostedRunnerImageMatches(stable, active.bundleFingerprint, active.sourceFingerprint)).toBe(selected === active);
        expect(hostedRunnerImageMatches(stable, candidate.bundleFingerprint, candidate.sourceFingerprint)).toBe(selected === candidate);
      }
    },
  );

  it("keeps an exact warm binding usable through consecutive image promotions", () => {
    const slotName = createHostedRunnerSlotName(primary.id);
    const binding = { state: "bound" as const, claimId: "a".repeat(32), releaseId: primary.id, region: "GLOBAL" as const, slotName, userId: "member_test" };
    for (const fingerprint of ["c", "e"]) {
      const active = { ...primary, bundleFingerprint: fingerprint.repeat(64) };
      const env = scopeHostedRunnerReleaseEnvironment({ HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify({ active, candidate: null, previous: next }) }, "primary");
      expect(requireRetainedRunnerRequest(env, binding, { currentReleaseId: primary.id, region: "GLOBAL", slotName, userId: "member_test" })).toMatchObject({ targetReleaseId: primary.id, slotName });
      expect(() => requireRetainedRunnerRequest(env, binding, { currentReleaseId: primary.id, region: "GLOBAL", slotName, userId: "member_other" })).toThrow("another member");
    }
  });
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

  it.each(["branch-name", "a".repeat(39), 42])("rejects invalid artifact commit provenance: %s", (releaseSha) => {
    expect(() => readHostedRunnerDeployment({ HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify({
      active: { ...primary, releaseSha }, candidate: null, previous: null,
    }) })).toThrow("identity is invalid");
  });
});
