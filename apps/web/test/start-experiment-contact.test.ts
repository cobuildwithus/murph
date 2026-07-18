import { describe, expect, it } from "vitest";

import {
  buildExperimentStartMessage,
  MURPH_EXPERIMENT_CONTACT_EMAIL,
  MURPH_EXPERIMENT_TELEGRAM_URL,
  resolveExperimentStartContactAction,
  resolveExperimentStartContactChannels,
} from "@/src/lib/experiments/start-experiment-contact";

const TEST_PROTOCOL_REF = {
  key: "protocol_variant:dry-sauna/murph-standard-3x-week",
  pageRevisionId: `sha256:${"1".repeat(64)}`,
  runSpecRevisionId: `sha256:${"2".repeat(64)}`,
};

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
      murphPhoneNumber: "+15550100001",
      protocolRef: TEST_PROTOCOL_REF,
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
      .toContain(`mailto:${MURPH_EXPERIMENT_CONTACT_EMAIL}`);
    for (const option of action.options) {
      expect(decodeURIComponent(option.href.replaceAll("+", "%20")))
        .toContain(TEST_PROTOCOL_REF.runSpecRevisionId);
    }

    const outboundText = action.options
      .flatMap((option) => [option.description, option.href, option.meta])
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
      protocolRef: TEST_PROTOCOL_REF,
      protocolTitle: "Norwegian 4x4",
    });

    expect(action).toMatchObject({
      kind: "open",
      option: {
        kind: "email",
      },
    });
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
      protocolRef: TEST_PROTOCOL_REF,
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
      protocolRef: TEST_PROTOCOL_REF,
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
      protocolRef: TEST_PROTOCOL_REF,
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
      protocolRef: TEST_PROTOCOL_REF,
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
      protocolRef: TEST_PROTOCOL_REF,
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
      protocolRef: TEST_PROTOCOL_REF,
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

  it("carries exact protocol lineage in a concise parseable draft", () => {
    expect(buildExperimentStartMessage("Finnish Dry Sauna", TEST_PROTOCOL_REF)).toBe([
      "I want to start the Finnish Dry Sauna experiment.",
      "",
      "Protocol reference:",
      `key: ${TEST_PROTOCOL_REF.key}`,
      `pageRevisionId: ${TEST_PROTOCOL_REF.pageRevisionId}`,
      `runSpecRevisionId: ${TEST_PROTOCOL_REF.runSpecRevisionId}`,
    ].join("\n"));
  });

  it("rejects malformed protocol lineage instead of drafting an ambiguous start", () => {
    expect(() => buildExperimentStartMessage("Finnish Dry Sauna", {
      ...TEST_PROTOCOL_REF,
      runSpecRevisionId: "latest",
    })).toThrow("Invalid experiment start protocol reference.");
    expect(() => buildExperimentStartMessage("Finnish Dry Sauna", {
      ...TEST_PROTOCOL_REF,
      key: "Finnish Dry Sauna",
    })).toThrow("Invalid experiment start protocol reference.");
  });
});
