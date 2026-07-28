import { afterEach, describe, expect, it } from "vitest";

import {
  startHostedLocalResendStub,
  type HostedLocalResendStub,
} from "./hosted-local-resend-support.js";

let stub: HostedLocalResendStub | null = null;

afterEach(async () => {
  await stub?.stop();
  stub = null;
});

describe("hosted local Resend support", () => {
  it("models lost acknowledgements and Resend idempotency conflicts", async () => {
    stub = await startHostedLocalResendStub();
    stub.armNextPostAcceptLostAcknowledgment({
      matchRequest: () => true,
    });
    const body = JSON.stringify({
      from: "Murph Alerts <alerts@example.test>",
      subject: "Hosted runtime reply latency",
      text: "Murph reply latency alert.",
      to: ["operator@example.test"],
    });

    const lost = await postEmail({
      body,
      idempotencyKey: "latency/incident",
    });
    const retried = await postEmail({
      body,
      idempotencyKey: "latency/incident",
    });
    const changed = await postEmail({
      body: JSON.stringify({
        from: "Murph Alerts <alerts@example.test>",
        subject: "Hosted runtime reply latency",
        text: "Murph reply latency alert.",
        to: ["replacement@example.test"],
      }),
      idempotencyKey: "latency/incident",
    });

    expect(lost.status).toBe(503);
    expect(retried.status).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({
      id: expect.stringMatching(/^resend_local_/u),
    });
    expect(changed.status).toBe(409);
    expect(stub.acceptedRequests).toHaveLength(1);
    expect(stub.observedRequests).toHaveLength(3);
  });

  it("fails closed without Resend authorization", async () => {
    stub = await startHostedLocalResendStub();

    const response = await fetch(`${stub.baseUrl}/emails`, {
      body: JSON.stringify({
        from: "Murph Alerts <alerts@example.test>",
        subject: "Hosted runtime reply latency",
        text: "Murph reply latency alert.",
        to: ["operator@example.test"],
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "latency/unauthorized",
      },
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect(stub.acceptedRequests).toHaveLength(0);
  });
});

async function postEmail(input: {
  body: string;
  idempotencyKey: string;
}): Promise<Response> {
  if (!stub) {
    throw new Error("Hosted local Resend stub was not initialized.");
  }
  return await fetch(`${stub.baseUrl}/emails`, {
    body: input.body,
    headers: {
      authorization: "Bearer re_test",
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    method: "POST",
  });
}
