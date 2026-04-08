import { describe, expect, it } from "vitest";

import {
  hostedPrivySessionDebugEnabled,
  readHostedPrivySessionStorageSnapshot,
  sanitizeHostedPrivyDebugError,
  sanitizeHostedPrivyDebugPath,
  summarizeHostedPrivyLinkedAccounts,
} from "@/src/components/hosted-onboarding/privy-session-debug";

describe("privy session debug helpers", () => {
  it("only enables hosted Privy debug logging in development", () => {
    expect(hostedPrivySessionDebugEnabled("development")).toBe(true);
    expect(hostedPrivySessionDebugEnabled("test")).toBe(false);
    expect(hostedPrivySessionDebugEnabled("production")).toBe(false);
  });

  it("summarizes storage presence without exposing token values", () => {
    const snapshot = readHostedPrivySessionStorageSnapshot({
      getItem(key) {
        const values: Record<string, string | null> = {
          "privy:caid": "\"caid-123\"",
          "privy:connections": JSON.stringify([{ type: "wallet" }, { type: "phone" }]),
          "privy:id_token": "\"id-token-value\"",
          "privy:pat": "\"pat-token-value\"",
          "privy:refresh_token": "\"refresh-token-value\"",
          "privy:token": "\"access-token-value\"",
        };
        return values[key] ?? null;
      },
    });

    expect(snapshot).toEqual({
      connectionCount: 2,
      hasAnyAuthState: true,
      hasCaid: true,
      hasIdToken: true,
      hasPat: true,
      hasRefreshToken: true,
      hasToken: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("token-value");
  });

  it("sanitizes invite and join routes before logging", () => {
    expect(sanitizeHostedPrivyDebugPath("/join/rDFaWYP6hygEENOkxIpA")).toBe("/join/[inviteCode]");
    expect(
      sanitizeHostedPrivyDebugPath("/api/hosted-onboarding/invites/rDFaWYP6hygEENOkxIpA/status"),
    ).toBe("/api/hosted-onboarding/invites/[inviteCode]/status");
  });

  it("keeps only safe error metadata", () => {
    const error = Object.assign(new Error("session failed"), {
      code: "MISSING_OR_INVALID_TOKEN",
      status: 401,
      stack: "sensitive-stack",
    });

    expect(sanitizeHostedPrivyDebugError(error)).toEqual({
      code: "MISSING_OR_INVALID_TOKEN",
      message: "session failed",
      name: "Error",
      status: 401,
    });
  });

  it("summarizes linked account types without exposing account payloads", () => {
    const summary = summarizeHostedPrivyLinkedAccounts({
      linkedAccounts: [{ type: "phone", phoneNumber: "+15555550123" }, { type: "wallet" }],
    });

    expect(summary).toEqual({
      hasUser: true,
      linkedAccountCount: 2,
      linkedAccountTypes: ["phone", "wallet"],
    });
    expect(JSON.stringify(summary)).not.toContain("+15555550123");
  });

  it("returns a null-like snapshot when storage cannot be read", () => {
    const snapshot = readHostedPrivySessionStorageSnapshot({
      getItem() {
        throw new Error("blocked");
      },
    });

    expect(snapshot).toEqual({
      connectionCount: null,
      hasAnyAuthState: false,
      hasCaid: false,
      hasIdToken: false,
      hasPat: false,
      hasRefreshToken: false,
      hasToken: false,
    });
  });
});
