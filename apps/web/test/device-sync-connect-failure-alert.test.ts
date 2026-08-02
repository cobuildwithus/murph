import { describe, expect, it, vi } from "vitest";

import { sendHostedDeviceConnectFailureAlert } from "@/src/lib/device-sync/connect-failure-alert";
import type { sendHostedResendPlainTextEmail } from "@/src/lib/hosted-onboarding/resend-plain-text-email";

type SendAlertEmailInput = Parameters<typeof sendHostedResendPlainTextEmail>[0];

const alertEnv = {
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
  HOSTED_PRODUCT_FEEDBACK_DIGEST_EMAILS:
    "product@example.test, founder@example.test",
  RESEND_API_KEY: "re_test",
};

describe("hosted device connect failure alert", () => {
  it("emails the product feedback digest recipients when a connection fails", async () => {
    const sent: SendAlertEmailInput[] = [];

    await expect(sendHostedDeviceConnectFailureAlert({
      connectSourceId: "eight-sleep",
      env: alertEnv,
      errorCode: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
      httpStatus: 500,
      memberId: "hbm_member_1",
      now: new Date("2026-07-31T16:19:41.000Z"),
      provider: "junction",
      sendEmail: async (input) => {
        sent.push(input);
        return { providerMessageId: "email_1" };
      },
    })).resolves.toBe("sent");

    expect(sent).toHaveLength(1);
    const call = sent[0];
    if (!call) {
      throw new Error("expected the alert email to be sent");
    }
    expect(call.to).toEqual(["product@example.test", "founder@example.test"]);
    expect(call.subject).toBe(
      "Murph device connection failed — eight-sleep: DEVICE_SYNC_JOB_PAYLOAD_INVALID",
    );
    expect(call.text).toContain("member: hbm_member_1");
    expect(call.text).toContain("error code: DEVICE_SYNC_JOB_PAYLOAD_INVALID");
    expect(call.idempotencyKey).toBe(
      "hosted-device-connect-failure/junction/eight-sleep/hbm_member_1/DEVICE_SYNC_JOB_PAYLOAD_INVALID/2026-07-31T16",
    );
  });

  it("dedupes retries within the hour through the idempotency key", async () => {
    const keys: string[] = [];

    for (const minute of ["16:19", "16:45"]) {
      await sendHostedDeviceConnectFailureAlert({
        connectSourceId: "eight-sleep",
        env: alertEnv,
        errorCode: "DEVICE_SYNC_JOB_PAYLOAD_INVALID",
        memberId: "hbm_member_1",
        now: new Date(`2026-07-31T${minute}:00.000Z`),
        provider: "junction",
        sendEmail: async (input) => {
          keys.push(input.idempotencyKey);
          return { providerMessageId: "email_1" };
        },
      });
    }

    expect(new Set(keys).size).toBe(1);
  });

  it("skips benign replayed-state callbacks", async () => {
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(sendHostedDeviceConnectFailureAlert({
      env: alertEnv,
      errorCode: "OAUTH_STATE_REPLAYED",
      provider: "junction",
      sendEmail,
    })).resolves.toBe("ignored_code");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips silently when the alert email is not configured", async () => {
    const sendEmail = vi.fn(async () => ({ providerMessageId: "email_1" }));

    await expect(sendHostedDeviceConnectFailureAlert({
      env: {},
      errorCode: "JUNCTION_LINK_FAILED",
      provider: "junction",
      sendEmail,
    })).resolves.toBe("not_configured");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
