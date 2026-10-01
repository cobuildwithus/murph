import { randomInt, randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { areHostedDomainRootProviderCallsDisabled } from "../../src/lib/hosted-crypto/domain-root-unwrap-cache";
import type { HostedAuthSmsVerification } from "../../src/lib/better-auth/twilio-verify";

/** Models only the external, single-use Verify boundary; PostgreSQL stays real. */
export function syntheticSmsVerification(codes = new Map<string, string>()) {
  const pending = new Map<string, { phoneNumber: string; code: string }>();
  const verification = {
    send: vi.fn<HostedAuthSmsVerification["send"]>(async ({ phoneNumber }) => {
      expect(areHostedDomainRootProviderCallsDisabled()).toBe(false);
      const sid = `VE${randomUUID().replaceAll("-", "")}`;
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      pending.set(sid, { phoneNumber, code });
      codes.set(phoneNumber, code);
      return sid;
    }),
    check: vi.fn<HostedAuthSmsVerification["check"]>(async ({ phoneNumber, verificationSid, code }) => {
      expect(areHostedDomainRootProviderCallsDisabled()).toBe(false);
      const challenge = pending.get(verificationSid);
      if (challenge?.phoneNumber !== phoneNumber || challenge.code !== code) return false;
      pending.delete(verificationSid);
      return true;
    }),
  };
  return { ...verification, codes };
}
