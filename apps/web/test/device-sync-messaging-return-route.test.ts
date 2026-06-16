import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "../app/api/device-sync/messaging-return/route";

const originalLinqConversationPhoneNumbers =
  process.env.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS;
const originalMurphTelegramUsernameOverride = process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE;
const originalTelegramBotUsername = process.env.TELEGRAM_BOT_USERNAME;

describe("device sync messaging return route", () => {
  afterEach(() => {
    if (originalLinqConversationPhoneNumbers === undefined) {
      delete process.env.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS;
    } else {
      process.env.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS =
        originalLinqConversationPhoneNumbers;
    }

    if (originalTelegramBotUsername === undefined) {
      delete process.env.TELEGRAM_BOT_USERNAME;
    } else {
      process.env.TELEGRAM_BOT_USERNAME = originalTelegramBotUsername;
    }

    if (originalMurphTelegramUsernameOverride === undefined) {
      delete process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE;
    } else {
      process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE = originalMurphTelegramUsernameOverride;
    }
  });

  it("returns Linq/iMessage-originated device links to the Murph Messages line with a prefilled status", async () => {
    process.env.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS =
      "+15550100001,+15550100002";

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=imessage&deviceSyncStatus=connected&deviceSyncProvider=whoop",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await response.text();
    expect(html).toContain(
      '<meta http-equiv="refresh" content="0;url=sms:+15550100001?body=I%20just%20connected%20my%20WHOOP">',
    );
    expect(html).toContain('href="sms:+15550100001?body=I%20just%20connected%20my%20WHOOP"');
    expect(html).toContain("WHOOP is connected");
    expect(html).not.toContain("<script");
  });

  it("uses the member-specific Murph Messages line when the signed connect-link route provides it", async () => {
    process.env.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS =
      "+15550100001,+15550100999";

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=imessage&recipient=%2B15550100999&deviceSyncStatus=connected&deviceSyncProvider=oura",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      '<meta http-equiv="refresh" content="0;url=sms:+15550100999?body=I%20just%20connected%20my%20Oura">',
    );
    expect(html).toContain('href="sms:+15550100999?body=I%20just%20connected%20my%20Oura"');
  });

  it("ignores arbitrary Messages recipients that are not configured Murph lines", async () => {
    process.env.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS = "+15550100001";

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=imessage&recipient=%2B15550999999&deviceSyncProvider=oura",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('href="sms:+15550100001?body=I%20just%20connected%20my%20Oura"');
    expect(html).not.toContain("+15550999999");
  });

  it("attempts to return Telegram-originated device links to the configured bot with a prefilled status", async () => {
    process.env.TELEGRAM_BOT_USERNAME = "@murph_bot";

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=telegram&deviceSyncStatus=connected&deviceSyncProvider=oura",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('content="0;url=https://t.me/murph_bot?text=I+just+connected+my+Oura"');
    expect(html).toContain('href="https://t.me/murph_bot?text=I+just+connected+my+Oura"');
    expect(html).toContain("Oura is connected");
  });

  it("prefers the Murph Telegram username override over the bot environment", async () => {
    process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE = "@murphdevelopment_bot";
    process.env.TELEGRAM_BOT_USERNAME = "@murph_bot";

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=telegram&deviceSyncStatus=connected",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      'content="0;url=https://t.me/murphdevelopment_bot?text=I+just+connected+my+device"',
    );
    expect(html).toContain(
      'href="https://t.me/murphdevelopment_bot?text=I+just+connected+my+device"',
    );
    expect(html).not.toContain("murph_bot");
  });

  it("falls back to the configured Telegram bot when the override is invalid", async () => {
    process.env.MURPH_TELEGRAM_USERNAME_OVERRIDE = "not valid";
    process.env.TELEGRAM_BOT_USERNAME = "@murph_bot";

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=telegram&deviceSyncStatus=connected",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      'content="0;url=https://t.me/murph_bot?text=I+just+connected+my+device"',
    );
    expect(html).toContain(
      'href="https://t.me/murph_bot?text=I+just+connected+my+device"',
    );
  });

  it("does not auto-open a connected-success message when device connection returns an error", async () => {
    process.env.TELEGRAM_BOT_USERNAME = "@murph_bot";

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=telegram&deviceSyncStatus=error&deviceSyncProvider=oura",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Oura connection did not finish");
    expect(html).not.toContain("http-equiv=\"refresh\"");
    expect(html).not.toContain("I+just+connected+my+Oura");
    expect(html).not.toContain(">Text Murph</a>");
    expect(html).toContain('href="/home"');
  });

  it("falls back to the Murph Telegram bot when a configured bot username is unavailable", async () => {
    delete process.env.TELEGRAM_BOT_USERNAME;

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=telegram",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('content="0;url=https://t.me/withmurph_bot?text=I+just+connected+my+device"');
    expect(html).toContain('href="https://t.me/withmurph_bot?text=I+just+connected+my+device"');
  });

  it("ignores unsafe provider display values on supported targets", async () => {
    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=imessage&deviceSyncStatus=connected&deviceSyncProvider=%3Cscript%3E",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Device is connected");
    expect(html).not.toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("rejects unsupported targets", async () => {
    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=mailto",
    ));

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("Return link unavailable");
    expect(html).not.toContain("http-equiv=\"refresh\"");
    expect(html).not.toContain("<script>");
  });
});
