import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_LABS_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import {
  createHostedRuntimeLabsToolPort,
} from "../src/runtime-platform/labs-tool-port.ts";
import {
  startHostedWebControlStub,
  type HostedWebControlStub,
} from "./helpers/hosted-web-control-support.js";

let webControl: HostedWebControlStub | null = null;

afterEach(async () => {
  await webControl?.stop();
  webControl = null;
});

describe("hosted labs tool port", () => {
  it("allows only the bounded POST web-control route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_LABS_TOOL_PATH,
    })).toEqual({
      allowed: true,
      operation: "labs_tool",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_LABS_TOOL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_LABS_TOOL_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("posts the exact signed request with caller cancellation and parses the bounded response", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          action: "search",
          checkedAt: "2026-07-16T15:30:00.000Z",
          items: [],
          orderableThroughMurph: false,
          orderingStatus: "discovery_only",
        },
      }),
    });
    const controller = new AbortController();
    const port = createHostedRuntimeLabsToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });
    const request = {
      action: "search" as const,
      limit: 5,
      query: "lipid",
    };

    await expect(port.request(request, {
      signal: controller.signal,
    })).resolves.toEqual({
      action: "search",
      checkedAt: "2026-07-16T15:30:00.000Z",
      items: [],
      orderableThroughMurph: false,
      orderingStatus: "discovery_only",
    });

    expect(webControl.observedRequests).toHaveLength(1);
    expect(webControl.observedRequests[0]).toMatchObject({
      body: JSON.stringify(request),
      keyId: "v1",
      method: "POST",
      url: HOSTED_RUNTIME_LABS_TOOL_PATH,
      userId: "member_bound",
    });
  });

  it("honors an already-aborted caller signal before provider work", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          action: "locations",
          checkedAt: "2026-07-16T15:30:00.000Z",
          homeCollectionAvailable: false,
          locations: [],
          orderableThroughMurph: false,
          orderingStatus: "discovery_only",
          radiusMiles: 25,
          status: "not_served",
          zipCode: "10001",
        },
      }),
    });
    const controller = new AbortController();
    controller.abort();
    const port = createHostedRuntimeLabsToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });

    await expect(port.request({
      action: "locations",
      zipCode: "10001",
    }, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(webControl.observedRequests).toHaveLength(0);
  });

  it("rejects malformed responses without retaining provider payload details", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          privateProviderPayload: "must-not-escape",
        },
      }),
    });
    const port = createHostedRuntimeLabsToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });

    let thrown: unknown;
    try {
      await port.request({
        action: "locations",
        zipCode: "10001",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (!(thrown instanceof Error)) {
      throw new Error("Expected the Labs port to reject a malformed response.");
    }
    expect(thrown.message).toBe("Hosted labs tool returned invalid JSON.");
    expect(thrown.cause).toBeUndefined();
    expect(thrown.message).not.toContain("must-not-escape");
  });
});
