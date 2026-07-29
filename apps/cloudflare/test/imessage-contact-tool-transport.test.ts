import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH,
} from "@murphai/hosted-execution/routes";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  createHostedRuntimeIMessageContactToolPort,
} from "../src/runtime-platform/imessage-contact-tool-port.ts";
import {
  createHostedExecutionTestEnv,
} from "./hosted-execution-fixtures.ts";

describe("hosted iMessage contact tool transport", () => {
  it("crosses the signed direct Web boundary through the real control transport", async () => {
    const environment = readHostedExecutionEnvironment(
      createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
    );
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(
        `https://web.example.test${HOSTED_RUNTIME_IMESSAGE_CONTACT_TOOL_PATH}`,
      );
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({
        assistantInputId: `ain_${"a".repeat(32)}`,
      }));
      const headers = new Headers(init?.headers);
      expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_bound");
      expect(headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBeTruthy();

      return new Response(JSON.stringify({
        phoneNumber: "+15550100001",
        status: "existing",
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    const port = createHostedRuntimeIMessageContactToolPort({
      boundUserId: "member_bound",
      fetchImpl,
      timeoutMs: 2_000,
      transport: {
        callbackSigning: environment.webCallbackSigning,
        mode: "direct",
        webControlBaseUrl: "https://web.example.test",
        workspaceCheckpointBridge: null,
      },
    });

    await expect(port.ensure({
      assistantInputId: `ain_${"a".repeat(32)}`,
    })).resolves.toEqual({
      phoneNumber: "+15550100001",
      status: "existing",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
