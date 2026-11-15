import { describe, expect, it } from "vitest";
import { gameAreaCode } from "../src/lib/game/area-code";

describe("self area-code hint", () => {
  it("derives three digits only from verified NANP phones", () => {
    expect(gameAreaCode({ phoneNumber: "+12125550123", phoneNumberVerifiedAt: new Date() })).toBe("212");
    expect(gameAreaCode({ phoneNumber: "+14165550123", phoneNumberVerifiedAt: new Date() })).toBe("416");
  });
  it.each([
    null,
    { phoneNumber: null, phoneNumberVerifiedAt: null },
    { phoneNumber: null, phoneNumberVerifiedAt: new Date() },
    { phoneNumber: "+12125550123", phoneNumberVerifiedAt: null },
    { phoneNumber: "+442079460123", phoneNumberVerifiedAt: new Date() },
    { phoneNumber: "+11235550123", phoneNumberVerifiedAt: new Date() },
    { phoneNumber: "+1212555012", phoneNumberVerifiedAt: new Date() },
    { phoneNumber: "2125550123", phoneNumberVerifiedAt: new Date() },
  ])("omits unknown, unverified or non-NANP hints", identity => {
    expect(gameAreaCode(identity)).toBeUndefined();
  });
});
