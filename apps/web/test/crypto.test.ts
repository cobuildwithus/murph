import { describe, expect, it } from "vitest";

import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "@/src/lib/hosted-web/encryption";

describe("hosted secure-box string adapters", () => {
  it("round-trips hosted member private fields through the secure-box string wrapper", async () => {
    const encrypted = await encryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId: "member_test",
      value: "+15551234567",
    });

    expect(encrypted).toEqual(expect.any(String));
    await expect(decryptHostedWebNullableString({
      field: "hosted-member-identity.phone-number",
      memberId: "member_test",
      value: encrypted,
    })).resolves.toBe("+15551234567");
  });
});
