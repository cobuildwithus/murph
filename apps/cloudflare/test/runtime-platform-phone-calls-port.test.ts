import { HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS } from "@murphai/hosted-execution/phone-calls";
import { describe, expect, it } from "vitest";

import { resolveHostedPhoneCallTransportTimeoutMs } from "../src/runtime-platform/phone-calls-port.ts";

describe("resolveHostedPhoneCallTransportTimeoutMs", () => {
  it("lets the phone-call protocol deadline dominate the generic web-control timeout", () => {
    expect(resolveHostedPhoneCallTransportTimeoutMs(30_000)).toBe(
      HOSTED_PHONE_CALL_START_TRANSPORT_TIMEOUT_MS,
    );
    expect(resolveHostedPhoneCallTransportTimeoutMs(60_000)).toBe(60_000);
  });
});
