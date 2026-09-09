import { describe, expect, it } from "vitest";
import { classifyHostedBrowserCredential, classifyHostedNativeCredential, serializeHostedNativeSessionToken } from "../src/lib/better-auth/transport";

const token = "a".repeat(32);
const native = serializeHostedNativeSessionToken(token);
const browser = (cookie: string | null, authorization: string | null = null) => classifyHostedBrowserCredential({ cookie, authorization, production: true });
const mobile = (authorization: string | null, cookie: string | null = null, legacyAllowed = true) => classifyHostedNativeCredential({ authorization, cookie, legacyAllowed });

describe("authentication transport firewall", () => {
  it("keeps valid legacy browser credentials selected when no replacement was presented", () => {
    expect(browser("__Host-murph-session=legacy-session")).toEqual({ kind: "legacy", token: "legacy-session" });
    expect(browser(null)).toEqual({ kind: "anonymous" });
  });
  it("never falls back from a presented replacement cookie, including malformed values", () => {
    expect(browser("__Host-murph-session=legacy; __Host-murph-auth-session=invalid")).toEqual({ kind: "better-auth", token: "invalid" });
    expect(() => browser("__Host-murph-session=legacy; __Host-murph-auth-session=")).toThrow();
    expect(() => browser("__Host-murph-auth-session=first; __Host-murph-auth-session=second")).toThrow();
  });
  it("isolates browser ambient cookies from native bearer authority in both directions", () => {
    expect(() => browser("__Host-murph-session=legacy", `Bearer ${native}`)).toThrow();
    expect(() => mobile(`Bearer ${native}`, "__Host-murph-auth-session=cookie")).toThrow();
    expect(() => mobile(null, "__Host-murph-session=legacy")).toThrow();
    expect(() => mobile(`Bearer ${native}`, "")).toThrow();
    expect(mobile(`Bearer ${native}`)).toEqual({ kind: "better-auth", token });
  });
  it.each(["murph_auth_v1.invalid", "murph_auth_v2.aaaa.bbbb", "not-a-token", token, "aaaa.bbbb"])(
    "never classifies an invalid replacement or unsupported token as legacy: %s", (invalid) => {
      expect(() => mobile(`Bearer ${invalid}`)).toThrow();
    },
  );
  it("requires explicit legacy native admission and keeps replacement admission independent", () => {
    expect(mobile("Bearer aaaa.bbbb.cccc")).toEqual({ kind: "legacy", token: "aaaa.bbbb.cccc" });
    expect(() => mobile("Bearer aaaa.bbbb.cccc", null, false)).toThrow();
    expect(mobile(`Bearer ${native}`, null, false)).toEqual({ kind: "better-auth", token });
  });
});
