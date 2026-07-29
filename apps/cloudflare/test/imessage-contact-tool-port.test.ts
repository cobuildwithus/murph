import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedWebControlPlaneJson: vi.fn(),
}));

vi.mock("../src/runtime-platform/web-control-transport.ts", () => ({
  fetchHostedWebControlPlaneJson: mocks.fetchHostedWebControlPlaneJson,
}));

import {
  HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import {
  createHostedRuntimeIMessageContactToolPort,
} from "../src/runtime-platform/imessage-contact-tool-port.ts";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";

describe("hosted iMessage contact tool port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows only the exact bounded POST route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
    })).toEqual({
      allowed: true,
      operation: "imessage_contact_tool",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH}/arbitrary`,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: "/api/internal/hosted-execution/unrelated/tool",
    }).allowed).toBe(false);
  });

  it("binds the request to the runtime member and validates the response", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      phoneNumber: "+15550100001",
      status: "assigned",
      verifiedSenderPhoneHint: "*** 0009",
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const port = createHostedRuntimeIMessageContactToolPort({
      boundUserId: "member_bound",
      fetchImpl,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });
    const request = {
      assistantInputId: `ain_${"a".repeat(32)}`,
    };

    await expect(port.ensure(request)).resolves.toEqual({
      phoneNumber: "+15550100001",
      status: "assigned",
      verifiedSenderPhoneHint: "*** 0009",
    });
    expect(mocks.fetchHostedWebControlPlaneJson).toHaveBeenCalledWith({
      body: request,
      boundUserId: "member_bound",
      description: "Hosted iMessage contact tool",
      fetchImpl,
      path: HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });
  });

  it("rejects an invalid control-plane response", async () => {
    mocks.fetchHostedWebControlPlaneJson.mockResolvedValue({
      phoneNumber: "+15550100001",
      status: "unavailable",
      verifiedSenderPhoneHint: null,
    });
    const port = createHostedRuntimeIMessageContactToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });

    await expect(port.ensure({
      assistantInputId: `ain_${"a".repeat(32)}`,
    })).rejects.toThrow(
      "Hosted iMessage contact tool returned invalid JSON.",
    );
  });
});
