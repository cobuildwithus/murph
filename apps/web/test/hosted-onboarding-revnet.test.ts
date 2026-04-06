import { describe, expect, it, vi } from "vitest";

vi.mock("@cobuild/wire", () => ({
  buildRevnetPayIntent: vi.fn(),
}));

vi.mock("viem", () => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  getAddress: (value: string) => value,
  http: (url: string) => ({ url }),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(),
}));

import {
  isHostedOnboardingRevnetEnabled,
  submitHostedRevnetPayment,
} from "@/src/lib/hosted-onboarding/revnet";

describe("hosted RevNet client safeguards", () => {
  it("keeps hosted RevNet issuance disabled", () => {
    expect(isHostedOnboardingRevnetEnabled()).toBe(false);
  });

  it("rejects submission attempts while issuance is disabled", async () => {
    await expect(
      submitHostedRevnetPayment({
        beneficiaryAddress: "0x00000000000000000000000000000000000000bb",
        chainId: 8453,
        memo: "issuance:hbrv_123",
        paymentAmount: 42n,
        projectId: 1n,
        terminalAddress: "0x0000000000000000000000000000000000000001",
      }),
    ).rejects.toMatchObject({
      code: "REVNET_CONFIG_REQUIRED",
      message: "Hosted RevNet issuance is currently disabled.",
    });
  });
});
