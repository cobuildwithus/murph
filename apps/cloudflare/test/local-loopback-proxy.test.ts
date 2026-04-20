import { describe, expect, it } from "vitest";

import {
  isLocalLoopbackProxyProtocol,
} from "../src/local-loopback-proxy.ts";

describe("isLocalLoopbackProxyProtocol", () => {
  it("only accepts http(s) protocols for the surviving local internal proxy shim", () => {
    expect(isLocalLoopbackProxyProtocol("http:")).toBe(true);
    expect(isLocalLoopbackProxyProtocol("https:")).toBe(true);
    expect(isLocalLoopbackProxyProtocol("ws:")).toBe(false);
  });
});
