import { describe, expect, it } from "vitest";

import {
  isAllowedComputerLiveViewUrl,
  KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES,
  KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES,
} from "../src/lib/computer-use/live-view-origin";

describe("hosted computer live-view origins", () => {
  it("uses Kernel's documented live-view CSP sources", () => {
    expect(KERNEL_COMPUTER_LIVE_VIEW_FRAME_SOURCES).toEqual([
      "https://*.onkernel.com:8443",
    ]);
    expect(KERNEL_COMPUTER_LIVE_VIEW_CONNECT_SOURCES).toEqual([
      "https://*.onkernel.com:8443",
      "wss://*.onkernel.com:8443",
    ]);
  });

  it("allows Kernel wildcard live-view proxy URLs", () => {
    expect(isAllowedComputerLiveViewUrl({
      url: "https://proxy.jfk-friendly-booth.onkernel.com:8443/browser/live/token",
    })).toBe(true);
  });

  it.each([
    "https://onkernel.com:8443/browser/live/token",
    "https://evil-onkernel.com:8443/browser/live/token",
    "https://proxy.example.com:8443/browser/live/token",
    "https://proxy.onkernel.com/browser/live/token",
    "http://proxy.onkernel.com:8443/browser/live/token",
    "not a url",
  ])("rejects non-Kernel live-view URLs: %s", (url) => {
    expect(isAllowedComputerLiveViewUrl({ url })).toBe(false);
  });
});
