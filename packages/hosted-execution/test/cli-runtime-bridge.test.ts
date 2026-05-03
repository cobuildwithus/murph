import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";

import { describe, it } from "vitest";

import {
  HostedCliBridgeRequestError,
  requestHostedCliDeviceConnectLink,
} from "../src/cli-runtime-bridge.ts";

function isBridgeRequestErrorWithCode(code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof HostedCliBridgeRequestError);
    assert.equal(error.code, code);
    return true;
  };
}

describe("hosted CLI runtime bridge client", () => {
  it("passes a timeout abort signal and maps timeout failures", async () => {
    let signalSeen = false;
    const fetchImpl: typeof fetch = async (_url, init) => {
      signalSeen = init?.signal instanceof AbortSignal;
      throw new DOMException("The operation timed out.", "TimeoutError");
    };

    await assert.rejects(
      requestHostedCliDeviceConnectLink({
        bridge: {
          token: "bridge-token",
          url: "http://127.0.0.1:8787/",
        },
        connectTarget: "whoop",
        fetchImpl,
      }),
      isBridgeRequestErrorWithCode("HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT"),
    );
    assert.equal(signalSeen, true);
  });

  it("maps network failures without exposing low-level fetch messages", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed: socket hang up");
    };

    await assert.rejects(
      requestHostedCliDeviceConnectLink({
        bridge: {
          token: "bridge-token",
          url: "http://127.0.0.1:8787/",
        },
        connectTarget: "whoop",
        fetchImpl,
      }),
      (error: unknown) => {
        assert.ok(error instanceof HostedCliBridgeRequestError);
        assert.equal(error.code, "HOSTED_CLI_BRIDGE_REQUEST_FAILED");
        assert.equal(error.message, "Hosted CLI bridge request failed.");
        return true;
      },
    );
  });

  it("times out when a loopback listener accepts but never responds", async () => {
    const server = createServer();

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected hosted CLI bridge timeout test to bind a TCP port.");
      }

      await assert.rejects(
        requestHostedCliDeviceConnectLink({
          bridge: {
            token: "bridge-token",
            url: `http://127.0.0.1:${address.port}/`,
          },
          connectTarget: "whoop",
          timeoutMs: 50,
        }),
        isBridgeRequestErrorWithCode("HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT"),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("preserves bridge error codes from non-ok responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT",
            message: "Hosted CLI bridge request timed out.",
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 408,
        },
      );

    await assert.rejects(
      requestHostedCliDeviceConnectLink({
        bridge: {
          token: "bridge-token",
          url: "http://127.0.0.1:8787/",
        },
        connectTarget: "whoop",
        fetchImpl,
      }),
      isBridgeRequestErrorWithCode("HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT"),
    );
  });
});
