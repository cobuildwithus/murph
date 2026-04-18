import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeHostedExecutionSignedRequestPayload,
  readHostedExecutionSignatureHeaders,
} from "../src/auth.ts";
import {
  HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR,
  HOSTED_EXECUTION_EVENT_KINDS,
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_WAKE_LIFECYCLE_STATES,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "../src/contracts.ts";
import {
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "../src/env.ts";
import {
  buildHostedExecutionRunnerCommitPath,
  buildHostedExecutionRunnerEmailMessagePath,
  buildHostedExecutionRunnerSideEffectPath,
} from "../src/routes.ts";

function decodeUtf8(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

describe("hosted execution coverage gaps", () => {
  it("reads signature headers and normalizes signed request payloads", () => {
    const headers = new Headers({
      [HOSTED_EXECUTION_SIGNATURE_HEADER]: "sig_123",
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: "2026-04-07T00:00:00.000Z",
      [HOSTED_EXECUTION_NONCE_HEADER]: "nonce_123",
      [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: "key_123",
    });

    expect(readHostedExecutionSignatureHeaders(headers)).toEqual({
      keyId: "key_123",
      nonce: "nonce_123",
      signature: "sig_123",
      timestamp: "2026-04-07T00:00:00.000Z",
    });

    expect(
      decodeUtf8(
        encodeHostedExecutionSignedRequestPayload({
          method: " patch ",
          nonce: "  nonce_abc  ",
          path: "internal/dispatch",
          payload: "{\"ok\":true}",
          search: "limit=10&sort=desc",
          timestamp: "2026-04-07T00:00:00.000Z",
          userId: "  user_123  ",
        }),
      ),
    ).toBe(JSON.stringify([
      "2026-04-07T00:00:00.000Z",
      "PATCH",
      "/internal/dispatch",
      "?limit=10&sort=desc",
      "user_123",
      "nonce_abc",
      "{\"ok\":true}",
    ]));

    expect(
      decodeUtf8(
        encodeHostedExecutionSignedRequestPayload({
          method: undefined,
          nonce: "   ",
          path: undefined,
          payload: "payload",
          search: "   ",
          timestamp: "2026-04-07T00:00:00.000Z",
          userId: null,
        }),
      ),
    ).toBe(JSON.stringify([
      "2026-04-07T00:00:00.000Z",
      "POST",
      "/",
      "",
      "",
      "",
      "payload",
    ]));
  });

  it("normalizes hosted execution base URLs and string inputs", () => {
    expect(normalizeHostedExecutionString(null)).toBeNull();
    expect(normalizeHostedExecutionString("  ")).toBeNull();
    expect(normalizeHostedExecutionString("  abc  ")).toBe("abc");

    expect(
      normalizeHostedExecutionBaseUrl(" https://Example.com/root/?q=1#frag "),
    ).toBe("https://example.com/root");

    expect(
      normalizeHostedExecutionBaseUrl("http://LOCALHOST:8787/api/?q=1", {
        allowHttpLocalhost: true,
      }),
    ).toBe("http://localhost:8787/api");

    expect(
      normalizeHostedExecutionBaseUrl("http://api.example.com/v1/?q=1", {
        allowHttpHosts: ["API.EXAMPLE.COM"],
      }),
    ).toBe("http://api.example.com/v1");

    expect(() => normalizeHostedExecutionBaseUrl("http://example.com")).toThrow(
      /HTTPS unless the host is explicitly allowlisted/i,
    );
    expect(() => normalizeHostedExecutionBaseUrl("https://user:pass@example.com")).toThrow(
      /embedded credentials/i,
    );
  });

  it("builds hosted execution routes with safe path encoding", () => {
    expect(buildHostedExecutionRunnerCommitPath("evt/123?x=1")).toBe(
      "/events/evt%2F123%3Fx%3D1/commit",
    );
    expect(buildHostedExecutionRunnerSideEffectPath("effect 123")).toBe(
      "/effects/effect%20123",
    );
    expect(buildHostedExecutionRunnerEmailMessagePath("raw/message#1")).toBe(
      "/messages/raw%2Fmessage%231",
    );
  });

  it("exports canonical hosted execution contracts without staged payload helpers", async () => {
    expect(HOSTED_EXECUTION_EVENT_KINDS).toEqual([
      "member.activated",
      "member.channels.updated",
      "assistant.cron.tick",
      "device-sync.wake",
      "vault.share.accepted",
    ]);
    expect(HOSTED_WAKE_LIFECYCLE_STATES).toEqual([
      "queued",
      "backpressured",
      "completed",
      "poisoned",
    ]);
    expect(HOSTED_EXECUTION_DISPATCH_NOT_CONFIGURED_ERROR).toBe(
      "Hosted execution dispatch is not configured.",
    );
    expect(HOSTED_EXECUTION_SIGNATURE_HEADER).toBe("x-hosted-execution-signature");
    expect(HOSTED_EXECUTION_TIMESTAMP_HEADER).toBe("x-hosted-execution-timestamp");
    expect(HOSTED_EXECUTION_NONCE_HEADER).toBe("x-hosted-execution-nonce");
    expect(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER).toBe(
      "x-hosted-execution-signing-key-id",
    );
    expect(HOSTED_EXECUTION_USER_ID_HEADER).toBe("x-hosted-execution-user-id");
    expect(HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER).toBe(
      "x-hosted-execution-runner-proxy-token",
    );

    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      exports?: Record<string, unknown>;
    };

    expect(Object.keys(packageJson.exports ?? {}).sort()).not.toContain("./dispatch-ref");
    expect(Object.keys(packageJson.exports ?? {}).sort()).not.toContain("./client");
    expect(Object.keys(packageJson.exports ?? {}).sort()).not.toContain("./outbox-payload");

    const importBySpecifier = new Function(
      "specifier",
      "return import(specifier);",
    ) as (specifier: string) => Promise<unknown>;
    const rootModule = await import("@murphai/hosted-execution");

    expect("createHostedExecutionDispatchClient" in rootModule).toBe(false);
    expect("buildHostedExecutionOutboxPayload" in rootModule).toBe(false);
    expect("buildHostedWakeLinqMessageReceivedPayload" in rootModule).toBe(false);
    expect("buildHostedWakeTelegramMessageReceivedPayload" in rootModule).toBe(false);
    expect("buildHostedWakeEmailMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeLinqMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeTelegramMessageReceivedPayload" in rootModule).toBe(false);
    expect("parseHostedWakeEmailMessageReceivedPayload" in rootModule).toBe(false);
    await expect(importBySpecifier("@murphai/hosted-execution/dispatch-ref")).rejects.toThrow();
    await expect(importBySpecifier("@murphai/hosted-execution/client")).rejects.toThrow();
    await expect(importBySpecifier("@murphai/hosted-execution/outbox-payload")).rejects.toThrow();
  });
});
