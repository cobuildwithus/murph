import { describe, expect, it } from "vitest";

import {
  buildExperimentStartMessage,
  MURPH_EXPERIMENT_CONTACT_EMAIL,
  MURPH_EXPERIMENT_TELEGRAM_URL,
  resolveExperimentStartContactAction,
} from "@/src/lib/experiments/start-experiment-contact";

describe("experiment start contact resolver", () => {
  it("offers every connected Murph channel without placing user identifiers in hrefs", () => {
    const action = resolveExperimentStartContactAction({
      initialContactChannels: { email: true, telegram: true, text: true },
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
      initialContactChannels: { email: true, telegram: false, text: false },
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

  it("falls back when the server has not confirmed an email channel", () => {
    const action = resolveExperimentStartContactAction({
      initialContactChannels: { email: false, telegram: false, text: false },
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


  it("falls back to Telegram for phone-only users when Murph has no routed text number", () => {
    const action = resolveExperimentStartContactAction({
      initialContactChannels: { email: false, telegram: false, text: true },
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
      initialContactChannels: { email: false, telegram: false, text: false },
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
      initialContactChannels: { email: false, telegram: false, text: false },
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
      initialContactChannels: { email: false, telegram: false, text: false },
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
