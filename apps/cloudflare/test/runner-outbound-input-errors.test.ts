import { HOSTED_RUNTIME_ATTEMPT_ID_HEADER, HOSTED_RUNTIME_LEASE_GENERATION_HEADER, HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER } from "../src/runner-outbound/headers.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../src/internal-hosts.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import { HOSTED_RUNNER_WEB_CONTROL_ROUTES } from "../src/runner-outbound/shared-web-control-policy.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as invocationParsers from "@murphai/hosted-execution/parsers";
import * as emailParsers from "@murphai/assistant-runtime/hosted-email";
import * as effectParsers from "../src/runner-effects-contract.ts";
import * as mailboxParsers from "../src/runtime-mailbox-payload-decode-contract.ts";
import * as emailTransport from "../src/hosted-email.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { handleRunnerRuntimeCompletionRequest } from "../src/runner-outbound/runtime-completion.ts";
import { handleRunnerPrivateImageUrlPublishRequest } from "../src/runner-outbound/private-image-urls.ts";
import { handleRunnerProviderEffectsRequest } from "../src/runner-outbound/provider-effects.ts";
import { handleRunnerMailboxPayloadDecodeRequest } from "../src/runner-outbound/mailbox-payload-decode.ts";
import { handleRunnerResultsRequest } from "../src/runner-outbound/results.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

vi.mock("../src/runner-outbound/write-fence.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../src/runner-outbound/write-fence.ts")>(),
  requireRunnerRuntimeWriteFence: vi.fn(async () => undefined),
  requireRunnerRuntimeWriteFenceHeaders: vi.fn(() => ({ attemptId: "synthetic-attempt", generation: "1", workspaceVersion: null })),
}));

function input(body: string) {
  const configured = createHostedExecutionTestEnv();
  const bucket = new MemoryEncryptedR2Bucket();
  const request = new Request("https://results.worker/send", { method: "POST", body });
  return { bucket, env: { ...configured, BUNDLES: bucket }, environment: readHostedExecutionEnvironment(configured),
    request, url: new URL(request.url), userId: "synthetic-owner", pathname: effectParsers.HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH };
}

const routes = [
  { name: "completion", handle: handleRunnerRuntimeCompletionRequest,
    parser: () => vi.spyOn(invocationParsers, "parseHostedWorkspaceInvocationResult") },
  { name: "private image", handle: handleRunnerPrivateImageUrlPublishRequest,
    parser: () => vi.spyOn(effectParsers, "parseHostedRunnerPrivateImageUrlPublishRequest") },
  { name: "provider effect", handle: handleRunnerProviderEffectsRequest,
    parser: () => vi.spyOn(effectParsers, "parseHostedRunnerTelegramGetFileRequest") },
  { name: "mailbox decode", handle: handleRunnerMailboxPayloadDecodeRequest,
    parser: () => vi.spyOn(mailboxParsers, "parseHostedMailboxPayloadDecodeRequest") },
];

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(routes)("runner input boundary: $name", ({ handle, parser }) => {
  it.each(["{", "[]", "{}"])("keeps malformed input as 400: %s", async body => {
    expect((await handle(input(body))).status).toBe(400);
  });

  it.each([TypeError, RangeError, SyntaxError])("propagates a parser bug: %s", async ErrorType => {
    const failure = new ErrorType("Synthetic parser failure.");
    parser().mockImplementationOnce(() => { throw failure; });
    await expect(handle(input("{}"))).rejects.toBe(failure);
  });

  it.each([TypeError, RangeError, SyntaxError])("propagates a body I/O failure: %s", async ErrorType => {
    const context = input("{}");
    const failure = new ErrorType("Synthetic stream failure.");
    vi.spyOn(context.request, "arrayBuffer").mockRejectedValueOnce(failure);
    Object.defineProperty(context.request, "body", { value: new ReadableStream({
      start(controller) { controller.error(failure); },
    }) });
    await expect(handle(context)).rejects.toBe(failure);
  });
});

it("propagates a native base64 decoder bug instead of rejecting the image", async () => {
  const failure = new TypeError("Synthetic decoder failure.");
  vi.stubGlobal("atob", () => { throw failure; });
  await expect(handleRunnerPrivateImageUrlPublishRequest(input(JSON.stringify({
    bytesBase64: "AAAA", contentType: "image/png",
  })))).rejects.toBe(failure);
});

it("does not blame an email caller for server configuration failure", async () => {
  const failure = new TypeError("Synthetic configuration failure.");
  vi.spyOn(emailTransport, "readHostedEmailConfig").mockImplementationOnce(() => { throw failure; });
  const response = await handleRunnerResultsRequest(input("{}"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: "ASSISTANT_EMAIL_PROVIDER_ENTRY_FAILED", deliveryMayHaveSucceeded: false, error: "Hosted email delivery failed before provider entry.", retryable: true });
});

it.each([
  [HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceCheckpoint.path, "{"],
  [HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceCheckpoint.path, "{}"],
  [HOSTED_RUNNER_WEB_CONTROL_ROUTES.mailboxFetch.path, "{"],
  [HOSTED_RUNNER_WEB_CONTROL_ROUTES.mailboxFetch.path, "null"],
  [HOSTED_RUNNER_WEB_CONTROL_ROUTES.usageRecording.path, "{"],
])("rejects malformed web-control input before forwarding: %s %s", async (path, body) => {
  const context = input(body);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const response = await handleRunnerWebControlRequest({ ...context,
    url: new URL(`https://web-control.worker${path}`),
  });
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid request." });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([TypeError, RangeError, SyntaxError])("propagates asynchronous web-control parser faults through the outbound adapter: %s", async ErrorType => {
  const context = input("{}");
  const failure = new ErrorType("Synthetic parser failure.");
  vi.spyOn(invocationParsers, "parseHostedWorkspaceCheckpointRequest").mockImplementationOnce(() => {
    throw failure;
  });
  const request = new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}${HOSTED_RUNNER_WEB_CONTROL_ROUTES.workspaceCheckpoint.path}`, {
    method: "POST", body: "{}",
  });
  await expect(handleRunnerOutboundRequest(request, context.env, context.userId)).rejects.toBe(failure);
});

it.each([
  ["{", 400, "Invalid request."],
  ["[]", 400, "Invalid request."],
  [" ".repeat(4097), 413, "Request body too large."],
] as const)("maps explicit snapshot-reader rejections through the outbound adapter %#", async (body, status, error) => {
  const context = input(body);
  const request = new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/workspace-snapshots/snapshot_test/heartbeat`, {
    method: "POST", body,
    headers: {
      [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_test",
      [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "1",
      [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "0",
    },
  });
  const response = await handleRunnerOutboundRequest(request, context.env, context.userId);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
});

it("preserves the upstream mailbox-array rejection envelope", async () => {
  const context = input("[]");
  const body = { error: { code: "INVALID_REQUEST", message: "Invalid request." } };
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), {
    status: 400, headers: { "cache-control": "no-store", "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetch);
  const response = await handleRunnerWebControlRequest({ ...context,
    url: new URL(`https://web-control.worker${HOSTED_RUNNER_WEB_CONTROL_ROUTES.mailboxFetch.path}`),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual(body);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(["{", "[]", "{}"])("preserves explicit email input rejection: %s", async body => {
  const response = await handleRunnerResultsRequest(input(body));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "ASSISTANT_EMAIL_REQUEST_INVALID", deliveryMayHaveSucceeded: false, retryable: false });
});

it.each(["body", "parser", "provider"])("preserves email delivery evidence at %s", async phase => {
  const context = input("{}");
  const failure = new TypeError("Synthetic failure.");
  const send = vi.spyOn(emailTransport, "sendHostedEmailMessage");
  if (phase === "body") {
    vi.spyOn(context.request, "arrayBuffer").mockRejectedValueOnce(failure);
    Object.defineProperty(context.request, "body", { value: new ReadableStream({ start(controller) { controller.error(failure); } }) });
  }
  else if (phase === "parser") vi.spyOn(emailParsers, "parseHostedEmailSendRequest").mockImplementationOnce(() => { throw failure; });
  else {
    vi.spyOn(emailParsers, "parseHostedEmailSendRequest").mockReturnValueOnce({} as never);
    send.mockRejectedValueOnce(failure);
    await expect(handleRunnerResultsRequest(context)).rejects.toBe(failure);
    return;
  }
  const response = await handleRunnerResultsRequest(context);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "ASSISTANT_EMAIL_PROVIDER_ENTRY_FAILED", deliveryMayHaveSucceeded: false, retryable: true });
  expect(send).not.toHaveBeenCalled();
});

it.each(["{}", '{"reason":7}', '{"reason":"idle_shutdown","expectedWorkspaceVersion":7}'])("rejects malformed snapshot fields: %s", async body => {
  const context = input(body);
  const request = new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/workspace-snapshots/start`, { method: "POST", body,
    headers: { [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_test", [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "1", [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "0" } });
  const response = await handleRunnerOutboundRequest(request, context.env, context.userId);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request." });
});
it("rejects malformed runner result path encoding", async () => {
  const context = input("");
  const request = new Request("https://results.worker/messages/%E0%A4%A");
  const response = await handleRunnerOutboundRequest(request, context.env, context.userId);
  expect(response.status).toBe(400);
});

it.each([
  { encryptedByteSize: 0 }, { encryptedObjectSha256: "invalid" }, { encryptedMd5: "invalid" },
])("rejects invalid snapshot PUT metadata before session lookup: %j", async invalid => {
  const body = JSON.stringify({ snapshotId: "snapshot_test", objectKey: "synthetic", encryptedByteSize: 1, encryptedObjectSha256: "a".repeat(64), ...invalid });
  const context = input(body);
  const request = new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.workspaceSnapshotStore}/workspace-snapshots/snapshot_test/presign-put`, {
    method: "POST", body, headers: { [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_test", [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "1", [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "0" },
  });
  const response = await handleRunnerOutboundRequest(request, context.env, context.userId);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid request." });
});
