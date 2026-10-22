import { afterEach, describe, expect, it } from "vitest";

import {
  HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import {
  createHostedRuntimeIMessageContactToolPort,
} from "../src/runtime-platform/imessage-contact-tool-port.ts";
import {
  startHostedWebControlStub,
  type HostedWebControlStub,
} from "./helpers/hosted-web-control-support.js";

let webControl: HostedWebControlStub | null = null;

afterEach(async () => {
  await webControl?.stop();
  webControl = null;
});

describe("hosted iMessage contact tool port", () => {

  it.each(["assigned", "existing"] as const)(
    "binds one signed HTTP request to the runtime member and validates the %s response",
    async (status) => {
      webControl = await startHostedWebControlStub({
        respond: () => ({
          body: {
            phoneNumber: "+15550100001",
            status,
            verifiedSenderPhoneHint: "*** 0009",
          },
        }),
      });
      const port = createHostedRuntimeIMessageContactToolPort({
        boundUserId: "member_bound",
        fetchImpl: fetch,
        timeoutMs: 2_000,
        transport: webControl.transport,
      });
      const request = {
        assistantInputId: `ain_${"a".repeat(32)}`,
      };

      await expect(port.ensure(request)).resolves.toEqual({
        phoneNumber: "+15550100001",
        status,
        verifiedSenderPhoneHint: "*** 0009",
      });

      expect(webControl.observedRequests).toHaveLength(1);
      expect(webControl.observedRequests[0]).toMatchObject({
        body: JSON.stringify(request),
        keyId: "v1",
        method: "POST",
        url: HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
        userId: "member_bound",
      });
      expect(webControl.observedRequests[0]?.signature).toMatch(/^[A-Za-z0-9_-]+$/u);
    },
  );

  it("rejects an invalid control-plane response", async () => {
    webControl = await startHostedWebControlStub({
      respond: () => ({
        body: {
          phoneNumber: "+15550100001",
          status: "unavailable",
          verifiedSenderPhoneHint: null,
        },
      }),
    });
    const port = createHostedRuntimeIMessageContactToolPort({
      boundUserId: "member_bound",
      fetchImpl: fetch,
      timeoutMs: 2_000,
      transport: webControl.transport,
    });

    await expect(port.ensure({
      assistantInputId: `ain_${"a".repeat(32)}`,
    })).rejects.toThrow(
      "Hosted iMessage contact tool returned invalid JSON.",
    );
  });
});
