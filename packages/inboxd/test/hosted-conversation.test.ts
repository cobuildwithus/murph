import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { normalizeHostedEmailConversationCapture } from "../src/connectors/hosted-conversation.ts";
import { parseRawEmailMessage, readRawEmailHeaderValue } from "../src/connectors/email/parsed.ts";

const receivedAt = "2026-11-11T12:00:00.000Z";
const email = (headers: string[], body: string) => [
  "From: sender@example.test", "To: assistant@example.test", "Message-ID: <synthetic@example.test>",
  ...headers, "", body,
].join("\r\n");

describe("hosted email capture", () => {
  it.each(["Mon, 01 Jan 2001 12:00:00 +0000", "Tue, 01 Jan 2041 12:00:00 +0000", "invalid"])(
    "uses trusted receipt time independently of Date: %s", async (date) => {
      const rawMessage = email([`Date: ${date}`], "Synthetic body");
      expect(parseRawEmailMessage(rawMessage).receivedAt).toBeNull();
      const capture = await normalizeHostedEmailConversationCapture({ rawMessage, receivedAt });
      expect(capture.receivedAt).toBe(receivedAt);
      expect(capture.text).toBe("Synthetic body");
    },
  );

  it("preserves charset bytes and raw binary attachment bytes", () => {
    const source = Buffer.concat([
      Buffer.from(email([
        "Subject: Café", "Content-Type: multipart/mixed; boundary=synthetic",
      ], [
        "--synthetic", "Content-Type: text/plain; charset=iso-8859-1",
        "Content-Transfer-Encoding: 8bit", "", "caf",
      ].join("\r\n"))),
      Buffer.from([0xe9]),
      Buffer.from("\r\n--synthetic\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=sample.bin\r\nContent-Transfer-Encoding: binary\r\n\r\n"),
      Buffer.from([0xff, 0x00, 0x0d, 0x0a, 0xfe]),
      Buffer.from("\r\n--synthetic--\r\n"),
    ]);
    const parsed = parseRawEmailMessage(source);
    expect(parsed.text).toBe("café");
    expect(parsed.subject).toBe("Café");
    expect(parsed.attachments[0]?.data).toEqual(new Uint8Array([0xff, 0x00, 0x0d, 0x0a, 0xfe]));
  });

  it.each(["", "--"])("preserves a binary boundary lookalike ending in %s and NBSP", (suffix) => {
    const attachment = Buffer.concat([
      Buffer.from(`before\r\n--synthetic${suffix}`),
      Buffer.from([0xa0]),
      Buffer.from("\r\nafter"),
    ]);
    const parsed = parseRawEmailMessage(Buffer.concat([
      Buffer.from(email(["Content-Type: multipart/mixed; boundary=synthetic"], [
        "--synthetic \t", "Content-Type: application/octet-stream",
        "Content-Disposition: attachment; filename=sample.bin",
        "Content-Transfer-Encoding: binary", "", "",
      ].join("\r\n"))),
      attachment,
      Buffer.from("\r\n--synthetic--\t \r\n"),
    ]));

    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.data).toEqual(new Uint8Array(attachment));
  });

  it("keeps sequential mixed parts and does not duplicate alternative representations", () => {
    const parsed = parseRawEmailMessage(email(["Content-Type: multipart/mixed; boundary=outer"], [
      "--outer", "Content-Type: multipart/alternative; boundary=inner", "",
      "--inner", "Content-Type: text/plain", "", "First paragraph",
      "--inner", "Content-Type: text/html", "", "<p>First paragraph</p>", "--inner--",
      "--outer", "Content-Type: text/plain", "", "Second paragraph", "--outer--",
    ].join("\r\n")));
    expect(parsed.text).toBe("First paragraph\n\nSecond paragraph");
    expect(parsed.html).toBe("<p>First paragraph</p>");
  });

  it("preserves duplicate From detection independently of MIME body decoding", () => {
    const raw = email(["From: second@example.test"], "body");
    expect(readRawEmailHeaderValue(raw, "from")).toEqual({ repeated: true, value: null });
  });
});
