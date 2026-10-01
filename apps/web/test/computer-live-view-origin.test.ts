import { describe, expect, it } from "vitest";

import {
  inspectComputerLiveViewUrl,
  isAllowedComputerLiveViewUrl,
  KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES,
  KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES,
  KERNEL_COMPUTER_LIVE_VIEW_HOST_SUFFIXES,
} from "../src/lib/computer-use/live-view-origin";

describe("hosted computer live-view origins", () => {
  it("uses Kernel's documented live-view CSP sources", () => {
    expect(KERNEL_COMPUTER_LIVE_VIEW_HOST_SUFFIXES).toEqual([
      "kernel.sh",
      "onkernel.com",
    ]);
    expect(KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES).toEqual([
      "https://*.kernel.sh:8443",
      "https://*.onkernel.com:8443",
    ]);
    expect(KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES).toEqual([
      "https://*.kernel.sh:8443",
      "wss://*.kernel.sh:8443",
      "https://*.onkernel.com:8443",
      "wss://*.onkernel.com:8443",
    ]);
  });

  it.each([
    "https://proxy.jfk-friendly-booth.kernel.sh:8443/browser/live/token",
    "https://proxy.jfk-friendly-booth.onkernel.com:8443/browser/live/token",
  ])("allows Kernel wildcard live-view proxy URLs: %s", (url) => {
    expect(isAllowedComputerLiveViewUrl({ url })).toBe(true);
  });

  it.each([
    "https://onkernel.com:8443/browser/live/token",
    "https://evil-onkernel.com:8443/browser/live/token",
    "https://kernel.sh:8443/browser/live/token",
    "https://evil-kernel.sh:8443/browser/live/token",
    "https://proxy.example.com:8443/browser/live/token",
    "https://proxy.onkernel.com/browser/live/token",
    "http://proxy.onkernel.com:8443/browser/live/token",
    "not a url",
  ])("rejects non-Kernel live-view URLs: %s", (url) => {
    expect(isAllowedComputerLiveViewUrl({ url })).toBe(false);
  });

  it("describes only the safe validation dimensions of a rejected URL", () => {
    expect(inspectComputerLiveViewUrl({
      url: "https://api.onkernel.com/browser/live/private-capability",
    })).toEqual({
      allowed: false,
      hostnameAllowed: true,
      parsed: true,
      portAllowed: false,
      protocolAllowed: true,
    });
  });
});
