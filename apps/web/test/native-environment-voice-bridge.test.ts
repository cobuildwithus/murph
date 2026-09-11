import { afterEach, expect, test, vi } from "vitest";
import { requestNativeEnvironment } from "@/src/lib/environment/native-voice-bridge";
afterEach(() => vi.unstubAllGlobals());
test("passes only an operation and body through the native reply bridge", async () => {
  const postMessage = vi.fn().mockResolvedValue({ status: 202, body: "{}", contentType: "application/json" });
  vi.stubGlobal("window", { webkit: { messageHandlers: { environment: { postMessage } } } });
  const response = await requestNativeEnvironment("save", "{\"topics\":[]}");
  expect(response.status).toBe(202);
  expect(postMessage).toHaveBeenCalledWith({ operation: "save", body: "{\"topics\":[]}" });
});
test("ordinary browsers cannot bootstrap a private interview", async () => {
  vi.stubGlobal("window", {});
  await expect(requestNativeEnvironment("bootstrap")).rejects.toThrow("Murph app");
});
test("rejects malformed native replies", async () => {
  vi.stubGlobal("window", { webkit: { messageHandlers: { environment: { postMessage: vi.fn().mockResolvedValue({ status: 999 }) } } } });
  await expect(requestNativeEnvironment("bootstrap")).rejects.toThrow("unavailable");
});
