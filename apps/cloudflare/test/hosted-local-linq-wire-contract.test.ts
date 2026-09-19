import { createLinqChat, sendLinqChatMessage } from "@murphai/operator-config/linq-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL } from "../src/runner-injected-credential.js";
import {
  startHostedLocalLinqStub,
  type HostedLocalLinqStub,
} from "./helpers/hosted-local-linq-support.js";

// Independent contract: Linq v3 /chats/{chatId}/messages and /chats, verified
// against the published API and pinned @linqapp/sdk generated resource types.
// https://docs.linqapp.com/channel/imessage/guides/messaging/sending-messages/
const apiToken = "linq-local-wire-contract-token";
const messagePath = "/chats/chat_wire_contract/messages";
let stub: HostedLocalLinqStub;

afterEach(async () => {
  await stub?.stop();
});

async function startStub(): Promise<void> {
  stub = await startHostedLocalLinqStub({ expectedAuthorizationToken: apiToken });
}

function postMessage(message: Record<string, unknown>, token: string | null = apiToken) {
  return fetch(`${stub.baseUrl}${messagePath}`, {
    body: JSON.stringify({ message }),
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      "content-type": "application/json",
    },
    method: "POST",
  });
}

const textPart = { type: "text", value: "Synthetic wire contract reply." };

describe("Linq HTTP provider contract", () => {
  it.each([null, "wrong-synthetic-token", HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL])(
    "rejects absent or non-provider credentials (%s) before acceptance",
    async (token) => {
      await startStub();
      const response = await postMessage({ parts: [textPart] }, token);
      expect(response.status).toBe(401);
      expect(stub.acceptedSendRequests).toHaveLength(0);
    },
  );

  it.each([
    { label: "missing media source", parts: [textPart, { type: "media" }] },
    { label: "unknown part", parts: [textPart, { type: "unknown", value: "bad" }] },
    { label: "HTTP media source", parts: [textPart, { type: "media", url: "http://example.test/image.png" }] },
    { label: "ambiguous media source", parts: [textPart, { type: "media", url: "https://example.test/image.png", attachment_id: "attachment" }] },
    { label: "mixed link and text", parts: [textPart, { type: "link", value: "https://example.test/" }] },
    { label: "consecutive text", parts: [textPart, textPart] },
    { label: "oversized text", parts: [{ type: "text", value: "x".repeat(10_001) }] },
  ])("rejects $label", async ({ parts }) => {
    await startStub();
    const response = await postMessage({ parts });
    expect(response.status).toBe(400);
    expect(stub.acceptedSendRequests).toHaveLength(0);
  });

  it("does not grant idempotency to identical sends without a provider key", async () => {
    await startStub();
    stub.armNextPostAcceptLostAcknowledgment({
      expectedPath: messagePath,
      matchRequest: () => true,
      responseCount: 1,
    });
    expect((await postMessage({ parts: [textPart] })).status).toBe(503);
    expect((await postMessage({ parts: [textPart] })).status).toBe(200);
    expect(stub.countAcceptedSends(messagePath)).toBe(2);
    expect(new Set(stub.listObservedMessageIds("chat_wire_contract")).size).toBe(2);
  });

  it("lets the production SDK client recover a lost acknowledgement with one acceptance", async () => {
    await startStub();
    stub.armNextPostAcceptLostAcknowledgment({
      expectedPath: messagePath,
      matchRequest: () => true,
      responseCount: 1,
    });
    const response = await sendLinqChatMessage({
      chatId: "chat_wire_contract",
      idempotencyKey: "delivery-wire-contract",
      message: textPart.value,
    }, {
      env: { LINQ_API_BASE_URL: stub.baseUrl, LINQ_API_TOKEN: apiToken },
    });
    expect(response).not.toHaveProperty("data");
    expect(response.message?.id).toBe(stub.requireLatestObservedMessageId("chat_wire_contract"));
    expect(stub.countAcceptedSends(messagePath)).toBe(1);
    expect(stub.countObservedSends(messagePath)).toBe(2);
    expect(stub.observedRequests.every((request) => request.authorizationStatus === "expected")).toBe(true);
  });

  it("preserves create-chat idempotency through the production SDK client", async () => {
    await startStub();
    const input = {
      from: "+15550000000",
      idempotencyKey: "new-chat-wire-contract",
      message: textPart.value,
      to: ["+15551112222"],
    };
    const dependencies = {
      env: { LINQ_API_BASE_URL: stub.baseUrl, LINQ_API_TOKEN: apiToken },
    };
    const first = await createLinqChat(input, dependencies);
    const replay = await createLinqChat(input, dependencies);
    expect(replay).toEqual(first);
    expect(first.chatId).not.toBeNull();
    expect(stub.listObservedMessageIds(first.chatId!)).toHaveLength(1);
  });

  it("returns one canonical provider response envelope", async () => {
    await startStub();
    const response = await postMessage({ parts: [textPart] });
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual(["chat_id", "message"]);
  });

  it("accepts valid mixed media and a single native rich link", async () => {
    await startStub();
    for (const parts of [
      [textPart, { type: "media", url: "https://example.test/image.png" }, textPart],
      [{ type: "media", attachment_id: "attachment_local_1" }],
      [{ type: "link", value: "https://example.test/" }],
    ]) {
      expect((await postMessage({ parts })).status).toBe(200);
    }
    expect(stub.countAcceptedSends(messagePath)).toBe(3);
  });

  it("reuses a chat for the same sender and recipient set without dropping a new message", async () => {
    await startStub();
    const dependencies = {
      env: { LINQ_API_BASE_URL: stub.baseUrl, LINQ_API_TOKEN: apiToken },
    };
    const input = {
      from: "+15550000000",
      message: textPart.value,
      to: ["+15551112222", "+15553334444"],
    };
    const first = await createLinqChat({ ...input, idempotencyKey: "first" }, dependencies);
    const next = await createLinqChat({
      ...input,
      idempotencyKey: "next",
      to: [...input.to].reverse(),
    }, dependencies);
    expect(next.chatId).toBe(first.chatId);
    expect(next.messageId).not.toBe(first.messageId);
    expect(stub.countAcceptedSends("/chats")).toBe(2);
  });
});
