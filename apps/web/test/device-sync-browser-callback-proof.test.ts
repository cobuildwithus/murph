import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedDeviceSyncAppCompletionProof,
  buildHostedDeviceSyncCallbackProof,
  readHostedDeviceSyncAppCompletionProofError,
  readHostedDeviceSyncCallbackState,
  readHostedDeviceSyncCallbackProofError,
} from "@/src/lib/device-sync/browser-callback-proof";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-07-28T12:00:00.000Z");
const STATE = "callback_state_1234567890";

describe("hosted device-sync browser callback proof", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("binds a short-lived proof to provider, state, member, and app session", () => {
    const { cookie, expiresAt } = buildHostedDeviceSyncCallbackProof({
      memberId: "member_a",
      now: NOW,
      provider: "oura",
      sessionId: "session_a",
      state: STATE,
    });
    const request = requestWithCookie(cookie);
    const common = {
      memberId: "member_a",
      now: new Date("2026-07-28T12:14:59.000Z"),
      provider: "oura",
      request,
      sessionId: "session_a",
      state: STATE,
    };

    expect(expiresAt.toISOString()).toBe("2026-07-28T12:15:00.000Z");
    expect(readHostedDeviceSyncCallbackProofError(common)).toBeNull();
    expect(readHostedDeviceSyncCallbackProofError({
      ...common,
      memberId: "member_b",
    })).toBe("CALLBACK_PROOF_MISMATCH");
    expect(readHostedDeviceSyncCallbackProofError({
      ...common,
      sessionId: "session_b",
    })).toBe("CALLBACK_PROOF_MISMATCH");
    expect(readHostedDeviceSyncCallbackProofError({
      ...common,
      provider: "whoop",
    })).toBe("CALLBACK_PROOF_MISSING");
    expect(readHostedDeviceSyncCallbackProofError({
      ...common,
      state: "different_state_12345678",
    })).toBe("CALLBACK_PROOF_MISMATCH");
  });

  it("keeps the app's completion proof and the browser cookie from standing in for each other", () => {
    const binding = {
      memberId: "member_a",
      now: NOW,
      provider: "junction",
      sessionId: "session_a",
      state: STATE,
    };
    const appProof = buildHostedDeviceSyncAppCompletionProof(binding);
    const { cookie } = buildHostedDeviceSyncCallbackProof(binding);
    const cookieValue = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";")));
    const check = { ...binding, now: new Date("2026-07-28T12:14:59.000Z") };

    expect(appProof.startsWith("murph_device_sync_app_completion_v1.")).toBe(true);
    expect(cookieValue.startsWith("murph_device_sync_callback_v1.")).toBe(true);
    expect(readHostedDeviceSyncAppCompletionProofError({ ...check, completionProof: appProof })).toBeNull();
    expect(readHostedDeviceSyncAppCompletionProofError({ ...check, completionProof: cookieValue }))
      .toBe("CALLBACK_PROOF_MALFORMED");
    // The same authenticator under the other prefix still fails: the signing domain differs.
    expect(readHostedDeviceSyncAppCompletionProofError({
      ...check,
      completionProof: cookieValue.replace("murph_device_sync_callback_v1", "murph_device_sync_app_completion_v1"),
    })).toBe("CALLBACK_PROOF_MISMATCH");
    expect(readHostedDeviceSyncCallbackProofError({
      ...check,
      request: requestWithCookie(cookie.replace(encodeURIComponent(cookieValue), encodeURIComponent(appProof))),
    })).toBe("CALLBACK_PROOF_MALFORMED");
    expect(readHostedDeviceSyncCallbackProofError({
      ...check,
      request: requestWithCookie(cookie.replace(
        encodeURIComponent(cookieValue),
        encodeURIComponent(appProof.replace("murph_device_sync_app_completion_v1", "murph_device_sync_callback_v1")),
      )),
    })).toBe("CALLBACK_PROOF_MISMATCH");
    expect(readHostedDeviceSyncAppCompletionProofError({ ...check, completionProof: null }))
      .toBe("CALLBACK_PROOF_MISSING");
    expect(readHostedDeviceSyncAppCompletionProofError({ ...check, completionProof: appProof, sessionId: "session_b" }))
      .toBe("CALLBACK_PROOF_MISMATCH");
    expect(readHostedDeviceSyncAppCompletionProofError({
      ...check,
      completionProof: appProof,
      now: new Date("2026-07-28T12:15:00.000Z"),
    })).toBe("CALLBACK_PROOF_EXPIRED");
  });

  it("keeps concurrent browser sessions bound to their independent callback states", () => {
    const sessionA = buildHostedDeviceSyncCallbackProof({
      memberId: "member_a",
      now: NOW,
      provider: "junction",
      sessionId: "session_a",
      state: "callback_state_session_a",
    });
    const sessionB = buildHostedDeviceSyncCallbackProof({
      memberId: "member_a",
      now: NOW,
      provider: "junction",
      sessionId: "session_b",
      state: "callback_state_session_b",
    });

    expect(readHostedDeviceSyncCallbackProofError({
      memberId: "member_a",
      now: NOW,
      provider: "junction",
      request: requestWithCookie(sessionA.cookie),
      sessionId: "session_a",
      state: "callback_state_session_a",
    })).toBeNull();
    expect(readHostedDeviceSyncCallbackProofError({
      memberId: "member_a",
      now: NOW,
      provider: "junction",
      request: requestWithCookie(sessionB.cookie),
      sessionId: "session_b",
      state: "callback_state_session_b",
    })).toBeNull();
  });

  it("rejects expired and tampered proofs", () => {
    const { cookie } = buildHostedDeviceSyncCallbackProof({
      memberId: "member_a",
      now: NOW,
      provider: "junction",
      sessionId: "session_a",
      state: STATE,
    });
    const request = requestWithCookie(cookie);
    const input = {
      memberId: "member_a",
      provider: "junction",
      request,
      sessionId: "session_a",
      state: STATE,
    };

    expect(readHostedDeviceSyncCallbackProofError({
      ...input,
      now: new Date("2026-07-28T12:15:00.000Z"),
    })).toBe("CALLBACK_PROOF_EXPIRED");
    expect(readHostedDeviceSyncCallbackProofError({
      ...input,
      now: new Date("2026-07-28T12:01:00.000Z"),
      request: requestWithCookie(
        `${cookie.split(";", 1)[0]?.slice(0, -1) ?? ""}x`,
      ),
    })).toBe("CALLBACK_PROOF_MISMATCH");
  });

  it("classifies rejected proof without returning browser secrets", () => {
    const { cookie } = buildHostedDeviceSyncCallbackProof({
      memberId: "member_a", provider: "junction", sessionId: "session_a", state: STATE, now: NOW,
    });
    const input = { memberId: "member_a", provider: "junction", sessionId: "session_a",
      state: STATE, now: NOW, request: requestWithCookie(cookie) };
    expect(readHostedDeviceSyncCallbackProofError({ ...input, state: null })).toBe("CALLBACK_STATE_INVALID");
    expect(readHostedDeviceSyncCallbackProofError({ ...input, request: new Request("https://app.example.test") })).toBe("CALLBACK_PROOF_MISSING");
    expect(readHostedDeviceSyncCallbackProofError({ ...input, request: requestWithCookie("murph-device-sync-junction=malformed") })).toBe("CALLBACK_PROOF_MALFORMED");
    expect(readHostedDeviceSyncCallbackProofError({ ...input, now: new Date(NOW.getTime() + 15 * 60_000) })).toBe("CALLBACK_PROOF_EXPIRED");
    expect(readHostedDeviceSyncCallbackProofError({ ...input, state: "other_callback_state_123456" })).toBe("CALLBACK_PROOF_MISMATCH");
    expect(readHostedDeviceSyncCallbackProofError({ ...input, now: new Date(NOW.getTime() - 1) })).toBe("CALLBACK_PROOF_MALFORMED");
  });

  it("uses a secure host-only production cookie and clears the same provider slot", () => {
    vi.stubEnv("NODE_ENV", "production");

    const { cookie } = buildHostedDeviceSyncCallbackProof({
      memberId: "member_a",
      now: NOW,
      provider: "junction",
      sessionId: "session_a",
      state: STATE,
    });

    expect(cookie).toMatch(/^__Host-murph-device-sync-junction=/u);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });

  it("accepts only bounded callback-state query values", () => {
    expect(readHostedDeviceSyncCallbackState(
      new URL(`https://app.example.test/callback?murph_state=${STATE}`),
    )).toBe(STATE);
    expect(readHostedDeviceSyncCallbackState(
      new URL("https://app.example.test/callback?state=short"),
    )).toBeNull();
  });
});

function requestWithCookie(setCookie: string): Request {
  return new Request("https://app.example.test/callback", {
    headers: {
      cookie: setCookie.split(";", 1)[0] ?? "",
    },
  });
}
