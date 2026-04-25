import { afterEach, describe, expect, it } from "vitest";

import { GET } from "../app/api/device-sync/messaging-return/route";

const originalTelegramBotUsername = process.env.TELEGRAM_BOT_USERNAME;

describe("device sync messaging return route", () => {
  afterEach(() => {
    if (originalTelegramBotUsername === undefined) {
      delete process.env.TELEGRAM_BOT_USERNAME;
    } else {
      process.env.TELEGRAM_BOT_USERNAME = originalTelegramBotUsername;
    }
  });

  it("attempts to return Linq/iMessage-originated device links to Messages", async () => {
    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=imessage&deviceSyncStatus=connected&deviceSyncProvider=whoop",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await response.text();
    expect(html).toContain('<meta http-equiv="refresh" content="0;url=sms:">');
    expect(html).toContain('href="sms:"');
    expect(html).toContain("WHOOP is connected");
    expect(html).toContain("Open Messages");
    expect(html).not.toContain("<script");
  });

  it("attempts to return Telegram-originated device links to the configured bot", async () => {
    process.env.TELEGRAM_BOT_USERNAME = "@murph_bot";

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=telegram&deviceSyncStatus=connected&deviceSyncProvider=oura",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('content="0;url=https://t.me/murph_bot"');
    expect(html).toContain('href="https://t.me/murph_bot"');
    expect(html).toContain("Oura is connected");
    expect(html).toContain("Open Telegram");
  });

  it("falls back to Telegram when a configured bot username is unavailable", async () => {
    delete process.env.TELEGRAM_BOT_USERNAME;

    const response = GET(new Request(
      "https://join.example.test/api/device-sync/messaging-return?target=telegram",
    ));

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('content="0;url=https://t.me"');
    expect(html).toContain('href="https://t.me"');
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
