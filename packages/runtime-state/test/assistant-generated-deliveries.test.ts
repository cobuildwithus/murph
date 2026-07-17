import { describe, expect, it } from "vitest";

import {
  ASSISTANT_GENERATED_DELIVERY_DIRECTORY,
  isAssistantGeneratedDeliveryRef,
  isNormalizedAssistantVaultFileRef,
} from "@murphai/runtime-state/assistant-generated-deliveries";

describe("assistant generated-delivery refs", () => {
  it("accepts one flat file under the exact assistant runtime owner", () => {
    const ref = `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/report.pdf`;

    expect(ASSISTANT_GENERATED_DELIVERY_DIRECTORY).toBe(
      ".runtime/operations/assistant/generated-deliveries",
    );
    expect(isAssistantGeneratedDeliveryRef(ref)).toBe(true);
    expect(isNormalizedAssistantVaultFileRef(ref)).toBe(true);
    expect(isNormalizedAssistantVaultFileRef("documents/report.pdf")).toBe(true);
  });

  it("rejects every other hidden, nested, temporary, or unsafe ref", () => {
    for (const ref of [
      ".runtime/operations/assistant/generated-deliveries",
      ".runtime/operations/assistant/generated-deliveries-backup/report.pdf",
      ".runtime/operations/assistant/generated-deliveries/nested/report.pdf",
      ".runtime/operations/assistant/generated-deliveries/.hidden.pdf",
      ".runtime/operations/assistant/generated-deliveries/secrets",
      ".runtime/operations/assistant/generated-deliveries/quarantine",
      ".runtime/operations/assistant/generated-deliveries/tmp",
      ".runtime/operations/assistant/generated-deliveries/report.pdf.tmp",
      ".runtime/operations/assistant/outbox/intent.json",
      ".hidden/report.pdf",
      "../report.pdf",
      "/report.pdf",
      "C:/report.pdf",
    ]) {
      expect(isAssistantGeneratedDeliveryRef(ref), ref).toBe(false);
      expect(isNormalizedAssistantVaultFileRef(ref), ref).toBe(false);
    }
  });
});
