import { describe, expect, it } from "vitest";

import {
  buildExperimentStartMessage,
  MURPH_EXPERIMENT_CONTACT_EMAIL,
  MURPH_EXPERIMENT_TELEGRAM_URL,
  resolveExperimentStartContactAction,
  resolveExperimentStartContactChannels,
} from "@/src/lib/experiments/start-experiment-contact";

describe("experiment start contact resolver", () => {
  it("offers every connected Murph channel without placing user identifiers in hrefs", () => {
    const action = resolveExperimentStartContactAction({
      accountContainer: {
        linkedAccounts: [
          {
            latest_verified_at: 1771977600,
            phone_number: "+14045550123",
            type: "phone",
          },
          {
            id: "tg_user_123",
            type: "telegram",
            username: "member_handle",
          },
          {
            address: "member@example.test",
            latest_verified_at: 1771977600,
            type: "email",
          },
        ],
      },
      murphEmailAddress: "assistant+private@mail.example.test",
      murphPhoneNumber: "+15550100001",
      protocolTitle: "Finnish Dry Sauna",
    });

    expect(action.kind).toBe("choose");

    if (action.kind !== "choose") {
      return;
    }

    expect(action.options.map((option) => option.kind)).toEqual([
      "text",
      "telegram",
      "email",
    ]);
    expect(action.options.find((option) => option.kind === "text")?.href)
      .toMatch(/^sms:\+15550100001\?body=/u);
    expect(action.options.find((option) => option.kind === "telegram")?.href)
      .toEqual(expect.stringContaining(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`));
    expect(action.options.find((option) => option.kind === "email")?.href)
      .toContain("mailto:assistant+private@mail.example.test");
    for (const option of action.options) {
      expect(decodeURIComponent(option.href.replaceAll("+", "%20")))
        .toContain("I want to start the Finnish Dry Sauna experiment.");
      expect(option.href).not.toContain("sha256");
    }

    const outboundText = action.options
      .flatMap((option) => [option.description, option.href])
      .join("\n");
    expect(outboundText).not.toContain("+14045550123");
    expect(outboundText).not.toContain("member@example.test");
    expect(outboundText).not.toContain("tg_user_123");
    expect(outboundText).not.toContain("member_handle");
  });

  it("opens the single connected channel directly", () => {
    const action = resolveExperimentStartContactAction({
      accountContainer: {
        linkedAccounts: [
          {
            address: "member@example.test",
            latest_verified_at: 1771977600,
            type: "email",
          },
        ],
      },
      protocolTitle: "Norwegian 4x4",
    });

    expect(action).toMatchObject({
      kind: "open",
      option: {
        kind: "email",
      },
    });
    if (action.kind !== "open") {
      return;
    }
    expect(action.option.href).toContain(`mailto:${MURPH_EXPERIMENT_CONTACT_EMAIL}`);
    expect(decodeURIComponent(action.option.href)).toContain(
      "Please send me a private Murph reply.",
    );
    expect(decodeURIComponent(action.option.href)).not.toContain(
      "I want to start the Norwegian 4x4 experiment.",
    );
  });

  it("does not enable unverified email as a start channel", () => {
    const action = resolveExperimentStartContactAction({
      accountContainer: {
        linkedAccounts: [
          {
            address: "member@example.test",
            type: "email",
          },
        ],
      },
      protocolTitle: "Norwegian 4x4",
    });

    expect(action).toMatchObject({
      kind: "open",
      option: {
        href: expect.stringContaining(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`),
        kind: "telegram",
      },
    });
  });

  it("can route from minimized channel flags without raw linked-account records", () => {
    const action = resolveExperimentStartContactAction({
      initialContactChannels: {
        email: true,
        telegram: true,
        text: false,
      },
      protocolTitle: "Norwegian 4x4",
    });

    expect(action.kind).toBe("choose");

    if (action.kind !== "choose") {
      return;
    }

    expect(action.options.map((option) => option.kind)).toEqual(["telegram", "email"]);
  });

  it("derives minimized channel flags from linked accounts", () => {
    expect(resolveExperimentStartContactChannels({
      linkedAccounts: [
        {
          latest_verified_at: 1771977600,
          phone_number: "+14045550123",
          type: "phone",
        },
        {
          address: "member@example.test",
          latest_verified_at: 1771977600,
          type: "email",
        },
      ],
    })).toEqual({
      email: true,
      telegram: false,
      text: true,
    });
  });

  it("falls back to Telegram for phone-only users when Murph has no routed text number", () => {
    const action = resolveExperimentStartContactAction({
      accountContainer: {
        linkedAccounts: [
          {
            latest_verified_at: 1771977600,
            phone_number: "+14045550123",
            type: "phone",
          },
        ],
      },
      protocolTitle: "Red Light Glasses Before Bed",
    });

    expect(action).toMatchObject({
      kind: "open",
      option: {
        href: expect.stringContaining(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`),
        kind: "telegram",
      },
    });
  });

  it("normalizes invalid Murph text targets before building sms links", () => {
    const action = resolveExperimentStartContactAction({
      accountContainer: {
        linkedAccounts: [],
      },
      murphPhoneNumber: "+15550100001?body=Injected",
      protocolTitle: "Red Light Glasses Before Bed",
    });

    expect(action).toMatchObject({
      kind: "open",
      option: {
        href: expect.stringContaining(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`),
        kind: "telegram",
      },
    });
  });

  it("falls back to Telegram when no connected channel or text number is resolved", () => {
    const action = resolveExperimentStartContactAction({
      accountContainer: {
        linkedAccounts: [],
      },
      protocolTitle: "Red Light Glasses Before Bed",
    });

    expect(action).toMatchObject({
      kind: "open",
      option: {
        href: expect.stringContaining(`${MURPH_EXPERIMENT_TELEGRAM_URL}?text=`),
        kind: "telegram",
      },
    });
  });

  it("falls back to Messages when a Murph text number is available", () => {
    const action = resolveExperimentStartContactAction({
      accountContainer: {
        linkedAccounts: [],
      },
      murphPhoneNumber: "+15550100001",
      protocolTitle: "Red Light Glasses Before Bed",
    });

    expect(action).toMatchObject({
      kind: "open",
      option: {
        href: expect.stringMatching(/^sms:\+15550100001\?body=/u),
        kind: "text",
      },
    });
  });

  it("keeps the public draft to the human-readable experiment name", () => {
    const message = buildExperimentStartMessage(
      "Standard, Tiny, And Fallback Bedtime Transition",
    );

    expect(message).toBe(
      "I want to start the Standard, Tiny, And Fallback Bedtime Transition experiment.",
    );
    expect(message).not.toContain("Protocol reference");
    expect(message).not.toContain("sha256");
  });
});
