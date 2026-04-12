import { describe, expect, it } from "vitest";

import { isValidAssistantOpaqueId } from "@murphai/runtime-state";

describe("isValidAssistantOpaqueId", () => {
  it("accepts opaque runtime ids", () => {
    expect(isValidAssistantOpaqueId("session_01JNV40W8VFYQ2H7CMJY5A9R4K")).toBe(true);
    expect(isValidAssistantOpaqueId("turn-01JNV40W8VFYQ2H7CMJY5A9R4K")).toBe(true);
    expect(isValidAssistantOpaqueId(" session_01JNV40W8VFYQ2H7CMJY5A9R4K ")).toBe(true);
  });

  it("rejects empty, blank, or unsafe values", () => {
    expect(isValidAssistantOpaqueId("")).toBe(false);
    expect(isValidAssistantOpaqueId(" ")).toBe(false);
    expect(isValidAssistantOpaqueId("../session")).toBe(false);
    expect(isValidAssistantOpaqueId("session/child")).toBe(false);
    expect(isValidAssistantOpaqueId(null)).toBe(false);
    expect(isValidAssistantOpaqueId(undefined)).toBe(false);
  });
});
