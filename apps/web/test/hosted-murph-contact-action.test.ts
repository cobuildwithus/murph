import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedMurphContactContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({
  getHostedMurphContactContext: mocks.getHostedMurphContactContext,
}));

import {
  resolveHostedMurphContactOptions,
} from "@/src/components/murph/hosted-murph-contact-action";

describe("generic hosted Murph contact action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHostedMurphContactContext.mockResolvedValue({
      initialContactChannels: {
        email: true,
        telegram: false,
        text: false,
      },
      murphEmailAddress: "assistant+reply@example.test",
      murphPhoneNumber: null,
    });
  });

  it("keeps the generic email action as mailto without a provider shortcut", async () => {
    await expect(resolveHostedMurphContactOptions({
      message: {
        body: "Ready to continue",
        subject: "Continue with Murph",
      },
      preferredKind: "email",
    })).resolves.toEqual([
      {
        copyValue: "assistant+reply@example.test",
        href:
          "mailto:assistant+reply@example.test?subject=Continue%20with%20Murph&body=Ready%20to%20continue",
        kind: "email",
        label: "Email",
        webmail: null,
      },
    ]);
  });

  it("omits SMS without a resolved local line while preserving other channels", async () => {
    mocks.getHostedMurphContactContext.mockResolvedValue({
      initialContactChannels: {
        email: true,
        telegram: true,
        text: true,
      },
      murphEmailAddress: "assistant+reply@example.test",
      murphPhoneNumber: null,
    });

    const options = await resolveHostedMurphContactOptions();

    expect(options.map((option) => option.kind)).toEqual(["telegram", "email"]);
    expect(options).not.toContainEqual(expect.objectContaining({ kind: "text" }));
  });
});
