import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHostedExecutionLinqConversationMessageWake } from "@murphai/hosted-execution";
import { buildHostedSecureBoxAad, sealHostedSecureBox, serializeHostedSecureBoxEnvelope } from "@murphai/runtime-state";
import { buildHostedMailboxPayloadScope, buildHostedMailboxPayloadSecureBoxAad, HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA } from "@murphai/hosted-execution/runtime-control";
import { parseHostedMailboxFetchResponse } from "@murphai/hosted-execution/parsers";

const mocks = vi.hoisted(() => ({ forward: vi.fn(), fence: vi.fn(), crypto: vi.fn() }));
vi.mock("../src/web-control-plane.ts", async (original) => ({
  ...await original<typeof import("../src/web-control-plane.ts")>(),
  fetchHostedExecutionWebControlPlaneResponse: mocks.forward,
}));
vi.mock("../src/runner-outbound/write-fence.ts", async (original) => ({
  ...await original<typeof import("../src/runner-outbound/write-fence.ts")>(),
  requireRunnerRuntimeWriteFence: mocks.fence,
}));
vi.mock("../src/runner-outbound/shared.ts", async (original) => ({
  ...await original<typeof import("../src/runner-outbound/shared.ts")>(),
  resolveRunnerOutboundUserCryptoContext: mocks.crypto,
}));
import { HOSTED_RUNNER_WEB_CONTROL_ROUTES } from "../src/runner-outbound/shared-web-control-policy.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import { RunnerRuntimeWriteFenceError } from "../src/runner-outbound/write-fence.ts";
import { createHostedWebMailboxPort } from "../src/runtime-platform/mailbox-port.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";

const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const rootKeyId = "udrk:ingress:synthetic-fetch";
const wake = buildHostedExecutionLinqConversationMessageWake({
  eventId: "synthetic-event", occurredAt: "2026-09-10T00:00:00Z", userId: "synthetic-member",
  phoneLookupKey: "synthetic-phone-lookup",
  linqMessage: { chatId: "synthetic-chat", from: "+15550100000", isFromMe: false,
    messageId: "synthetic-message", parts: [{ type: "text", value: "Hello" }] },
});
const requestBody = { requestId: "synthetic-fetch", limitPerLane: 10,
  lanes: [{ lane: "conversation" as const, importedSeq: "0" }] };

async function mailboxFixture(index = 1) {
  const itemWake = index === 1 ? wake : { ...wake, eventId: `synthetic-event-${index}` };
  const item = { createdAt: wake.occurredAt, updatedAt: wake.occurredAt,
    dedupeKey: itemWake.eventId, id: `synthetic-item-${index}`, kind: "conversation.message" as const,
    lane: "conversation" as const, laneSeq: String(index), occurredAt: wake.occurredAt,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA, payloadInlineCiphertext: "",
    payloadRef: null as string | null, consumedAt: null as string | null, userId: wake.userId };
  const metadata = { ...item, itemId: item.id, payloadStorage: "inline" as const };
  const scope = buildHostedMailboxPayloadScope("inline");
  item.payloadInlineCiphertext = serializeHostedSecureBoxEnvelope(await sealHostedSecureBox({
    aad: buildHostedSecureBoxAad({ ...buildHostedMailboxPayloadSecureBoxAad(metadata),
      domain: "ingress", lane: "mailbox-payload", scope, userId: wake.userId }),
    domain: "ingress", lane: "mailbox-payload", scope, rootKey, rootKeyId,
    plaintext: new TextEncoder().encode(JSON.stringify(itemWake)),
  }));
  return { assistantProvider: "openai", fetchedAt: wake.occurredAt, userId: wake.userId, items: [item],
    maxSeqByLane: [{ lane: "conversation", maxSeq: "1" }],
    consumedSeqByLane: [{ lane: "conversation", consumedSeq: "0" }] };
}
async function handle(request: Request) {
  const env = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: { get: async () => null, put: async () => undefined },
    USER_RUNNER: { getByName: () => ({ validateRuntimeWriteFence: async () => true }) },
  };
  return handleRunnerWebControlRequest({ env, environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
    request, url: new URL(request.url), userId: wake.userId });
}
function request(optIn = true) {
  return new Request("http://web-control.worker/api/internal/hosted-mailbox/fetch", {
    method: "POST", body: JSON.stringify({ ...requestBody, ...(optIn ? { decodeInlinePayloads: true } : {}) }),
  });
}
describe("Worker mailbox fetch/decode composition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.fence.mockResolvedValue({ attemptId: "synthetic-attempt", generation: "1", workspaceVersion: "1" });
    mocks.crypto.mockResolvedValue({ resolveKeyById: async (id: string) => id === rootKeyId ? rootKey : null });
  });
  it("returns a parsed wake through one container request, one Web fetch and one fence check", async () => {
    const mailbox = await mailboxFixture();
    mocks.forward.mockImplementation(async () => Response.json(mailbox));
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => handle(new Request(url, init)));
    const port = createHostedWebMailboxPort({ boundUserId: wake.userId, fetchImpl,
      timeoutMs: 1000, transport: { mode: "proxy" } });
    const fetched = await port.fetch(requestBody);
    expect(fetched.items[0]?.decodedWake).toEqual(wake);
    expect(fetched.items[0]?.payloadInlineCiphertext).toBe(mailbox.items[0]!.payloadInlineCiphertext);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mocks.forward).toHaveBeenCalledTimes(1);
    expect(mocks.fence).toHaveBeenCalledTimes(1);
    // Canonical Web parsing never accepts the ephemeral plaintext field.
    expect(parseHostedMailboxFetchResponse(fetched).items[0]).not.toHaveProperty("decodedWake");
  });
  it.each([2, 100])("resolves ingress context once for %i inline items", async (count) => {
    const mailbox = await mailboxFixture();
    for (let index = 2; index <= count; index += 1) {
      const next = await mailboxFixture(index);
      mailbox.items.push(next.items[0]!);
    }
    mailbox.maxSeqByLane[0]!.maxSeq = String(count);
    mocks.forward.mockResolvedValue(Response.json(mailbox));
    const response = await handle(request());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ items: Array.from({ length: count }, (_, index) => ({
      decodedWake: index === 0 ? wake : { ...wake, eventId: `synthetic-event-${index + 1}` },
    })) });
    expect(mocks.crypto).toHaveBeenCalledTimes(1);
  });
  it("leaves old containers on the original fetch contract", async () => {
    const mailbox = await mailboxFixture();
    mocks.forward.mockResolvedValue(Response.json(mailbox));
    expect(await (await handle(request(false))).json()).toEqual(mailbox);
    expect(mocks.crypto).not.toHaveBeenCalled();
  });
  it.each(["consumed", "floor", "sidecar", "corrupt"])("preserves lazy import for %s items", async (kind) => {
    const mailbox = await mailboxFixture();
    if (kind === "consumed") mailbox.items[0]!.consumedAt = wake.occurredAt;
    if (kind === "floor") mailbox.consumedSeqByLane[0]!.consumedSeq = "1";
    if (kind === "sidecar") mailbox.items[0]!.payloadRef = "synthetic-sidecar";
    if (kind === "corrupt") mailbox.items[0]!.payloadInlineCiphertext = "invalid-ciphertext";
    mocks.forward.mockResolvedValue(Response.json(mailbox));
    const response = await handle(request());
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("items.0.decodedWake");
    expect(mocks.crypto).toHaveBeenCalledTimes(kind === "corrupt" ? 1 : 0);
  });
  it.each([
    HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceCheckpoint,
    HOSTED_RUNNER_WEB_CONTROL_ROUTES.usageRecording,
    HOSTED_RUNNER_WEB_CONTROL_ROUTES.browserVaultReplicaPublish,
    HOSTED_RUNNER_WEB_CONTROL_ROUTES.deviceSyncRuntimeSnapshot,
    HOSTED_RUNNER_WEB_CONTROL_ROUTES.vaultShareDeliver,
  ])("rejects GET for POST-only $operation before authority or forwarding", async (route) => {
    expect((await handle(new Request(`http://web-control.worker${route.path}`, { method: "GET" }))).status).toBe(404);
    expect(mocks.fence).not.toHaveBeenCalled();
    expect(mocks.forward).not.toHaveBeenCalled();
  });
  it("rejects a stale write fence before Web or crypto work", async () => {
    mocks.fence.mockRejectedValue(new RunnerRuntimeWriteFenceError());
    expect((await handle(request())).status).toBe(401);
    expect(mocks.forward).not.toHaveBeenCalled();
    expect(mocks.crypto).not.toHaveBeenCalled();
  });
  it("rejects a wrong-user mailbox before decrypting", async () => {
    const mailbox = await mailboxFixture();
    mailbox.items[0]!.userId = "another-synthetic-member";
    mocks.forward.mockResolvedValue(Response.json(mailbox));
    expect((await handle(request())).status).toBe(401);
    expect(mocks.crypto).not.toHaveBeenCalled();
  });
});
