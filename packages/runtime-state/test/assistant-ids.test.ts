import { describe, expect, it } from "vitest";

import * as runtimeStateRoot from "@murphai/runtime-state";
import {
  isValidAssistantOpaqueId,
  normalizeAssistantOpaqueId,
} from "@murphai/runtime-state/assistant-ids";

describe("assistant opaque id helpers", () => {
  it("normalizes and validates trimmed assistant ids on the dedicated subpath", () => {
    expect(normalizeAssistantOpaqueId("  session_01JNV40W8VFYQ2H7CMJY5A9R4K  ")).toBe(
      "session_01JNV40W8VFYQ2H7CMJY5A9R4K",
    );
    expect(isValidAssistantOpaqueId("session_01JNV40W8VFYQ2H7CMJY5A9R4K")).toBe(true);
    expect(isValidAssistantOpaqueId("turn-01JNV40W8VFYQ2H7CMJY5A9R4K")).toBe(true);
    expect(isValidAssistantOpaqueId(" session_01JNV40W8VFYQ2H7CMJY5A9R4K ")).toBe(true);
  });

  it("rejects empty, blank, or unsafe values", () => {
    expect(normalizeAssistantOpaqueId("")).toBeNull();
    expect(normalizeAssistantOpaqueId("   ")).toBeNull();
    expect(normalizeAssistantOpaqueId("../session")).toBeNull();
    expect(normalizeAssistantOpaqueId("session/child")).toBeNull();
    expect(isValidAssistantOpaqueId("")).toBe(false);
    expect(isValidAssistantOpaqueId(" ")).toBe(false);
    expect(isValidAssistantOpaqueId("../session")).toBe(false);
    expect(isValidAssistantOpaqueId("session/child")).toBe(false);
    expect(isValidAssistantOpaqueId(null)).toBe(false);
    expect(isValidAssistantOpaqueId(undefined)).toBe(false);
  });

  it("does not leak assistant opaque id helpers through the runtime-state root barrel", () => {
    expect("normalizeAssistantOpaqueId" in runtimeStateRoot).toBe(false);
    expect("isValidAssistantOpaqueId" in runtimeStateRoot).toBe(false);
  });
});
