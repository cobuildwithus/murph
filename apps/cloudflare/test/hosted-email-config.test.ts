import { describe, expect, it } from "vitest";

import { readHostedEmailConfig } from "../src/hosted-email/config.ts";

describe("readHostedEmailConfig", () => {
  it("defaults the hosted email subject and local part", () => {
    expect(readHostedEmailConfig({})).toMatchObject({
      defaultSubject: "Murph update",
      localPart: "assistant",
      publicAddress: "mail@mail.withmurph.ai",
    });
  });

  it("normalizes the configured sender identity through the shared hosted-email helper", () => {
    expect(
      readHostedEmailConfig({
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
        HOSTED_EMAIL_FROM_ADDRESS: "Murph <Assistant@Mail.Example.Test>",
      }).fromAddress,
    ).toBe("assistant@mail.example.test");
  });

  it("normalizes hosted email routing segments to lowercase", () => {
    expect(readHostedEmailConfig({
      HOSTED_EMAIL_DEFAULT_SUBJECT: "  Murph update  ",
      HOSTED_EMAIL_DOMAIN: " Reply.Example.COM ",
      HOSTED_EMAIL_LOCAL_PART: " Murph ",
      HOSTED_EMAIL_SIGNING_SECRET: " secret ",
    })).toEqual({
      defaultSubject: "Murph update",
      domain: "reply.example.com",
      fromAddress: "murph@reply.example.com",
      localPart: "murph",
      publicAddress: "mail@mail.withmurph.ai",
      signingSecret: "secret",
    });
  });
});
