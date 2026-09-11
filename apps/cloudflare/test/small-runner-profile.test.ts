import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertSmallRunnerSelection, isSmallRunnerMember } from "../src/small-runner-profile.ts";
import { createHostedRunnerContainerNamespaceRouter, createHostedRunnerSlotName, isHostedRunnerTargetName, readHostedRunnerTargetIdentity } from "../src/standby-runner-contract.ts";

const selected = "member-small-synthetic";
const source = {
  HOSTED_EXECUTION_SMALL_RUNNER_ENABLED: "true",
  HOSTED_EXECUTION_SMALL_RUNNER_MEMBER_SHA256: createHash("sha256").update(selected).digest("hex"),
};

describe("small runner selection", () => {
  it("matches exactly one private member and is off by default", async () => {
    await expect(isSmallRunnerMember(source, selected)).resolves.toBe(true);
    await expect(isSmallRunnerMember(source, "member-ordinary-synthetic")).resolves.toBe(false);
    await expect(isSmallRunnerMember({}, selected)).resolves.toBe(false);
    await expect(isSmallRunnerMember({ ...source, HOSTED_EXECUTION_SMALL_RUNNER_ENABLED: "false" }, selected)).resolves.toBe(false);
  });

  it.each([undefined, "", "private-invalid-value", "a".repeat(63)])("rejects invalid enabled configuration without revealing the selector", digest => {
    expect(() => assertSmallRunnerSelection({ ...source, HOSTED_EXECUTION_SMALL_RUNNER_MEMBER_SHA256: digest }))
      .toThrow("requires a valid private member SHA-256 selector");
  });

  it("preserves release identity in a distinct opaque target namespace", () => {
    const name = createHostedRunnerSlotName("next-release", "small");
    expect(name).toMatch(/^runner-small--v-next-release--[a-f0-9]{32}$/u);
    expect(isHostedRunnerTargetName(name)).toBe(true);
    expect(readHostedRunnerTargetIdentity(name)).toEqual({ releaseId: "next-release", region: "GLOBAL" });
    expect(name).not.toContain(selected);
  });

  it("never routes a small target through the default or next namespace", () => {
    const unexpected = { getByName() { throw new Error("wrong namespace"); } };
    const name = createHostedRunnerSlotName("next-release", "small");
    const input = { exactUser: unexpected, next: unexpected, standby: null };
    expect(() => createHostedRunnerContainerNamespaceRouter(input)!.getByName(name))
      .toThrow("small runner container binding is unavailable");
    const small = { getByName(actual: string) {
      expect(actual).toBe(name);
      throw new Error("selected small namespace");
    } };
    expect(() => createHostedRunnerContainerNamespaceRouter({ ...input, small })!.getByName(name))
      .toThrow("selected small namespace");
  });
});
