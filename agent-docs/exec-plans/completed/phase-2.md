# Hosted Provider Effects Phase 2

Status: completed
Completed: 2026-05-05

## Goal

Move hosted Telegram and Linq provider side effects behind host-owned effects capabilities.

Phase 2 should keep the same architectural shape as Phase 1:

> The restored runtime asks for a narrow effect. Cloudflare performs the credentialed provider operation for the active invocation.

Do not remove `platformEnv` in this phase. Phase 2 should make the concrete Telegram/Linq runtime call sites prefer host capabilities and prove they can run without provider tokens in runtime env. Phase 3 can then contract `platformEnv` and remove the remaining raw crypto/provider fallback reachability.

## Code-Grounded Findings

Current main has the right extension point:

- `packages/assistant-runtime/src/hosted-runtime/platform.ts` defines `HostedRuntimeEffectsPort`.
- `apps/cloudflare/src/runtime-platform.ts` already implements `effectsPort.readRawEmailMessage` and `effectsPort.sendEmail`.
- `apps/cloudflare/src/runner-outbound/results.ts` already hosts the email/raw-message effects routes behind the runner outbound proxy.

Current direct provider-token call sites are:

- `packages/assistant-runtime/src/hosted-runtime/channel-activity.ts`
  - builds Telegram env from `forwardedEnv + platformEnv`;
  - starts Telegram typing through env-backed adapters;
  - starts Linq typing through env-backed adapters;
  - marks Linq read through env-backed `markLinqChatRead`.
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
  - injects env-backed Telegram send;
  - does **not** inject Linq send, so Linq delivery can fall through to the assistant-engine default env-backed `sendLinqMessage`.
- `packages/assistant-runtime/src/hosted-runtime/provider-cleanup.ts`
  - deletes Linq provider messages through env-backed cleanup.
- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
  - builds Telegram attachment download from `TELEGRAM_BOT_TOKEN`;
  - builds the Linq attachment driver that can use direct CDN fetch plus token-backed metadata lookup.
- `packages/assistant-runtime/src/hosted-runtime/events/telegram.ts`
  - needs Telegram `getFile(fileId)` and `downloadFile(filePath)`, so one generic "fetch media bytes" method is not the right primitive.

## Plan Corrections

The earlier Phase 2 draft was mostly right, but should be tightened in these ways:

1. Include Linq send and Linq typing. Mark-read/delete alone is not enough because hosted Linq reply delivery can otherwise use env-backed defaults.
2. Replace generic `fetchProviderMedia` with explicit Telegram file methods: `getTelegramFile` and `downloadTelegramFile`.
3. Defer Linq token-backed attachment metadata lookup unless a follow-up PR is explicitly scoped for it. The Linq attachment driver has direct URL fallback, URL allowlisting, byte caps, metadata lookup, and redacted attempt logging; it is a larger seam than Telegram media.
4. Require active invocation lease headers for all provider-effect routes, including credentialed media reads, not only mutating sends/deletes.
5. Preserve Telegram ambiguous-delivery metadata across the Worker route/client boundary. If a partial Telegram send fails and rollback is ambiguous, the runtime must still receive `providerMessageIds`, `cleanupMessages`, `cleanupTargetAliases`, and the delivery error code so the outbox mirror can make the same safe decision it makes today.
6. Do not add a standalone Telegram delete route unless the same PR wires a concrete cleanup consumer. The existing Telegram send helper already rolls back partial sends. A delete route is useful only if Phase 2 also adds persisted Telegram cleanup draining.

## Phase 2 Scope

Phase 2 covers these provider-visible effects:

1. Telegram send.
2. Telegram typing/chat action.
3. Telegram file metadata lookup.
4. Telegram file download.
5. Linq send.
6. Linq typing/chat action.
7. Linq mark-read.
8. Linq message delete/cleanup.

Phase 2 does not cover:

- removing `platformEnv`;
- removing raw crypto context/root routes;
- moving device-sync authority;
- reworking provider routing semantics;
- Linq token-backed attachment metadata lookup, unless a dedicated subphase takes it on with its logging and URL policy intact.

## Target Architecture

Keep one runtime primitive: `effectsPort`.

Do not add `telegramPort`, `linqPort`, a generic `RuntimeHost`, or a stringly RPC such as `transport.call("telegram.send", payload)`.

Runtime code should call typed optional methods:

```ts
export interface HostedRuntimeTelegramSendRequest {
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  target: string;
}

export interface HostedRuntimeTelegramSendResponse {
  cleanupMessages?: Array<{ messageId: string; target: string }> | null;
  cleanupTargetAliases?: string[] | null;
  providerMessageId?: string | null;
  providerMessageIds?: string[] | null;
  providerThreadId?: string | null;
  target?: string | null;
  targetKind?: "explicit" | "participant" | "thread" | null;
}

export interface HostedRuntimeTelegramChatActionRequest {
  action: "typing";
  target: string;
}

export interface HostedRuntimeTelegramFile {
  file_id: string;
  file_path?: string;
  file_size?: number;
}

export interface HostedRuntimeTelegramGetFileRequest {
  fileId: string;
}

export interface HostedRuntimeTelegramDownloadFileRequest {
  filePath: string;
}

export interface HostedRuntimeProviderFileResponse {
  bytesBase64: string;
  contentType: string | null;
  fileName: string | null;
  sha256: string;
}

export interface HostedRuntimeLinqSendRequest {
  fromPhoneNumber?: string | null;
  idempotencyKey?: string | null;
  message: string;
  replyToMessageId?: string | null;
  target: string;
  targetKind?: "explicit" | "participant" | "thread" | null;
}

export interface HostedRuntimeLinqSendResponse {
  providerMessageId?: string | null;
  providerMessageIds?: string[] | null;
  providerThreadId?: string | null;
  target?: string | null;
  targetKind?: "explicit" | "participant" | "thread" | null;
}

export interface HostedRuntimeLinqChatActionRequest {
  action: "typing";
  target: string;
}

export interface HostedRuntimeLinqMarkReadRequest {
  chatId: string;
}

export interface HostedRuntimeLinqDeleteMessagesRequest {
  messageIds: readonly string[];
}
```

Extend `HostedRuntimeEffectsPortBase` with optional methods:

```ts
sendTelegram?(
  request: HostedRuntimeTelegramSendRequest,
): Promise<HostedRuntimeTelegramSendResponse | void>;

sendTelegramChatAction?(
  request: HostedRuntimeTelegramChatActionRequest,
): Promise<void>;

getTelegramFile?(
  request: HostedRuntimeTelegramGetFileRequest,
): Promise<HostedRuntimeTelegramFile | null>;

downloadTelegramFile?(
  request: HostedRuntimeTelegramDownloadFileRequest,
): Promise<HostedRuntimeProviderFileResponse | null>;

sendLinq?(
  request: HostedRuntimeLinqSendRequest,
): Promise<HostedRuntimeLinqSendResponse | void>;

sendLinqChatAction?(
  request: HostedRuntimeLinqChatActionRequest,
): Promise<void>;

markLinqRead?(
  request: HostedRuntimeLinqMarkReadRequest,
): Promise<void>;

deleteLinqMessages?(
  request: HostedRuntimeLinqDeleteMessagesRequest,
): Promise<void>;
```

Keep the methods optional during Phase 2 so local/test env-backed fallbacks continue to work.

## Runtime Package Changes

### 1. Extend the Effects Port

Update:

```txt
packages/assistant-runtime/src/hosted-runtime/platform.ts
packages/assistant-runtime/src/hosted-runtime-contracts.ts
```

Add request/response types near the existing effects-port definitions and export the new public types through `hosted-runtime-contracts.ts`, because `apps/cloudflare/src/runtime-platform.ts` imports the platform contract through that entrypoint.

### 2. Prefer Effects for Typing and Mark-Read

Update:

```txt
packages/assistant-runtime/src/hosted-runtime/channel-activity.ts
```

Change `createHostedAssistantChannelTypingDependencies` to accept:

```ts
effectsPort?: Pick<
  HostedRuntimeEffectsPort,
  "sendTelegramChatAction" | "sendLinqChatAction"
> | null;
```

Prefer effects-backed typing:

- Telegram: call `effectsPort.sendTelegramChatAction({ action: "typing", target })`.
- Linq: call `effectsPort.sendLinqChatAction({ action: "typing", target })`.

Keep env-backed typing as a local/test fallback when the method is absent.

Change `markHostedConversationReadBestEffort` to accept:

```ts
effectsPort?: Pick<HostedRuntimeEffectsPort, "markLinqRead"> | null;
```

Prefer `effectsPort.markLinqRead({ chatId })`, then fall back to env-backed `markLinqChatRead` only when the method is absent.

All typing and mark-read failures remain best-effort and must not fail mailbox import or the assistant pass.

### 3. Pass Effects Port Into Assistant Phases

Update:

```txt
packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts
```

Both currently call `createHostedAssistantChannelTypingDependencies`. Pass:

```ts
effectsPort: input.runtime.platform.effectsPort
```

Also pass effectsPort into `markHostedConversationReadBestEffort` wherever it is called.

### 4. Prefer Effects for Telegram and Linq Delivery

Update:

```txt
packages/assistant-runtime/src/hosted-runtime/callbacks.ts
```

In `dispatchAssistantOutboxIntent`, inject both `sendTelegram` and `sendLinq`.

For Telegram:

- If `input.effectsPort.sendTelegram` exists, call it.
- Assert liveness before and after the call.
- Return the result in the same shape accepted by `AssistantChannelDependencies["sendTelegram"]`.
- If the method is absent, keep the current env-backed fallback.

For Linq:

- If `input.effectsPort.sendLinq` exists, call it.
- Pass `fromPhoneNumber`, `idempotencyKey`, `target`, `targetKind`, `message`, and `replyToMessageId`.
- Assert liveness before and after the call.
- If the method is absent, let the existing assistant-engine default remain the local/test fallback.

Do not let the Worker/client collapse structured provider failures into a plain HTTP error when the old in-process path carried useful delivery context. Telegram ambiguous send errors in particular must keep enough fields for `readTelegramAmbiguousDeliveryFromError` in assistant-engine to work.

### 5. Prefer Effects for Linq Cleanup

Update:

```txt
packages/assistant-runtime/src/hosted-runtime/provider-cleanup.ts
packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts
```

Pass:

```ts
effectsPort?: Pick<HostedRuntimeEffectsPort, "deleteLinqMessages"> | null;
```

Prefer:

```ts
await input.effectsPort.deleteLinqMessages({ messageIds });
```

Fallback to `deleteHostedLinqMessages` only when the method is absent.

### 6. Prefer Effects for Telegram Media

Update:

```txt
packages/assistant-runtime/src/hosted-runtime/events/telegram.ts
packages/assistant-runtime/src/hosted-runtime/events/conversation.ts
```

Add an effects-backed Telegram attachment driver:

```ts
createHostedTelegramEffectsAttachmentDownloadDriver({
  effectsPort,
})
```

It should implement the current `TelegramAttachmentDownloadDriver` shape:

- `getFile(fileId)` calls `effectsPort.getTelegramFile({ fileId })`.
- `downloadFile(filePath)` calls `effectsPort.downloadTelegramFile({ filePath })` and decodes `bytesBase64`.

In `events/conversation.ts`, prefer the effects-backed driver when available. Keep the existing env-backed driver as local/test fallback.

Do not route Telegram through a generic provider media method. The current inbox connector expects `getFile` then `downloadFile`, and the effects contract should match that.

### 7. Defer Linq Attachment Metadata

Keep `createHostedLinqAttachmentDownloadDriver` env-backed for now unless a dedicated subphase migrates it.

Reason: it owns more than a token fetch. It has:

- direct CDN URL fallback;
- CDN URL allowlisting;
- metadata lookup fallback;
- byte limit enforcement;
- categorized redacted attempt logging;
- local-host override behavior for hosted-local tests.

Moving it behind effects is worthwhile, but it should be its own bounded change with tests that preserve those behaviors.

## Cloudflare App Changes

### 1. Add an App-Local Effects Contract

Create:

```txt
apps/cloudflare/src/runner-effects-contract.ts
```

Keep route constants and strict parsers here. Do not create a new package.

Suggested paths:

```ts
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_SEND_PATH =
  "/telegram/send";
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_CHAT_ACTION_PATH =
  "/telegram/chat-action";
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH =
  "/telegram/files/get";
export const HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH =
  "/telegram/files/download";
export const HOSTED_EXECUTION_RUNNER_LINQ_SEND_PATH =
  "/linq/send";
export const HOSTED_EXECUTION_RUNNER_LINQ_CHAT_ACTION_PATH =
  "/linq/chat-action";
export const HOSTED_EXECUTION_RUNNER_LINQ_MARK_READ_PATH =
  "/linq/chats/mark-read";
export const HOSTED_EXECUTION_RUNNER_LINQ_DELETE_MESSAGES_PATH =
  "/linq/messages/delete";
```

### 2. Extend `runtime-platform.ts`

Update:

```txt
apps/cloudflare/src/runtime-platform.ts
```

Add effectsPort methods that call the `results.worker` internal host with `createCloudflareHostedRuntimeFetch`.

For every provider-effect call:

1. Read the current lease from `workspaceCheckpointBridge`.
2. If no lease exists, throw a clear configuration/liveness error.
3. Add active lease headers. Prefer the existing `writeRunnerActiveInvocationLeaseHeaders` helper instead of duplicating header names.
4. POST strict JSON for send/action/delete methods.
5. POST strict JSON for Telegram get/download too. These are credentialed provider reads and should still require active lease.
6. Parse responses with app-local strict parsers.
7. On non-2xx, throw a safe error that preserves structured delivery context when the route returns a structured provider-delivery failure.

### 3. Keep `results.ts` as Dispatch, Move Route Bodies Out

Current `apps/cloudflare/src/runner-outbound/results.ts` is small and handles email/raw-message effects.

For Phase 2, add a small handler module:

```txt
apps/cloudflare/src/runner-outbound/provider-effects.ts
```

Let `results.ts` dispatch to it for the new paths. This keeps the effects host cohesive without turning `results.ts` into a provider implementation file.

Each route handler should:

1. Require the expected method.
2. Parse strict bounded JSON.
3. Require `item.userId` or route user agreement when the request carries user context.
4. Require active invocation lease with `requireRunnerActiveInvocationLease`.
5. Use Worker-owned provider env from `input.env` / `readHostedExecutionEnvironment`, never runtime `platformEnv`.
6. Call the existing provider runtime helper where possible.
7. Return normalized response JSON, not raw provider payloads.
8. Avoid logging provider request bodies, provider tokens, file bytes, raw attachment URLs, or raw provider responses.

### 4. Provider Implementation Notes

Telegram send:

- Prefer calling the existing `sendTelegramMessage` helper with Worker env so chunking, target normalization, and rollback behavior stay identical.
- If it throws an ambiguous delivery error, return a structured error response or throw a client error object that preserves `code`, `providerMessageIds`, `cleanupMessages`, `cleanupTargetAliases`, and `target`.
- Do not reduce that path to only `HTTP 502`; the runtime outbox needs the ambiguity metadata to avoid unsafe resends.

Telegram chat action:

- Use the existing Telegram runtime helper if available.
- If a tiny Worker-side helper is needed, keep it app-local and provider-specific.

Telegram file lookup/download:

- `getTelegramFile` returns only normalized Telegram file metadata needed by the inbox connector.
- `downloadTelegramFile` returns `{ bytesBase64, contentType, fileName, sha256 }`.
- Enforce a size cap before returning bytes. Use a conservative cap aligned with the current Linq attachment cap unless a smaller Telegram-specific cap is justified.

Linq send:

- Prefer existing Linq runtime helpers for `createLinqChat` and `sendLinqChatMessage`, or reuse `sendLinqMessage` if that is the smallest way to preserve current target-kind behavior.
- The Worker supplies `LINQ_API_TOKEN`; the runtime must not need it for hosted send.

Linq chat action and mark-read:

- Use existing Linq runtime helpers where available.
- These are best-effort from the runtime perspective, but the route itself should still validate auth, lease, and request shape strictly.

Linq delete:

- Use the existing Linq delete helper.
- Preserve current retry behavior in `provider-cleanup.ts`: route/client failures should let cleanup state remain for retry.

## PR Breakdown

### PR 2A: Delivery and Lightweight Channel Effects

Scope:

- Extend `HostedRuntimeEffectsPort`.
- Add Cloudflare route/client methods for:
  - Telegram send;
  - Telegram chat action;
  - Linq send;
  - Linq chat action;
  - Linq mark-read.
- Update `callbacks.ts` for Telegram and Linq delivery.
- Update `channel-activity.ts` and assistant phase callers for typing and mark-read.
- Add tests proving these paths use effects when present and fall back only when absent.

This is the highest-value first PR because it covers the obvious provider-token delivery paths, including the currently missing Linq send injection.

### PR 2B: Linq Cleanup

Scope:

- Add `deleteLinqMessages`.
- Update `provider-cleanup.ts`.
- Add tests proving cleanup uses effects when present and preserves retry state on route failure.

This can be included in PR 2A if the diff stays small.

### PR 2C: Telegram Media

Scope:

- Add `getTelegramFile` and `downloadTelegramFile`.
- Add effects-backed Telegram attachment driver.
- Update conversation import to prefer effects-backed Telegram media.
- Add tests proving Telegram attachment import works without runtime `TELEGRAM_BOT_TOKEN` when effects methods exist.

### Deferred: Linq Attachment Metadata

Defer token-backed Linq attachment metadata lookup until after Phase 2C unless it blocks `LINQ_API_TOKEN` removal. When it is implemented, preserve the existing direct URL fallback, URL policy, byte limit, local-host behavior, and redacted attempt logging.

## Fail-Closed Policy

During Phase 2:

- Local/test fallback remains allowed when effects methods are absent.
- Hosted Cloudflare should always provide methods for paths that Phase 2 claims migrated.
- Tests should run migrated hosted paths with empty `platformEnv` and no provider token in runtime env.
- Do not silently downgrade structured provider failures into generic transport errors.

Before Phase 3 removes provider tokens from runtime env/config:

- Add explicit fail-closed guards for migrated hosted provider effects, similar in spirit to Phase 1's mailbox decoder requirement.
- Remove or block env fallback for hosted Cloudflare mode while leaving local/test fallback explicit.

## Tests To Add

Runtime tests:

1. `createHostedAssistantChannelTypingDependencies` uses `effectsPort.sendTelegramChatAction`.
2. `createHostedAssistantChannelTypingDependencies` uses `effectsPort.sendLinqChatAction`.
3. Typing falls back to env only when the matching effects method is absent.
4. `markHostedConversationReadBestEffort` uses `effectsPort.markLinqRead`.
5. `drainHostedCommittedAssistantDeliveriesAfterCommit` uses `effectsPort.sendTelegram`.
6. Telegram delivery does not call env-backed `sendTelegramMessage` when `effectsPort.sendTelegram` is present.
7. `drainHostedCommittedAssistantDeliveriesAfterCommit` injects `sendLinq` and uses `effectsPort.sendLinq`.
8. Linq delivery does not fall through to env-backed `sendLinqMessage` when `effectsPort.sendLinq` is present.
9. `drainHostedProviderCleanupAfterCommit` uses `effectsPort.deleteLinqMessages`.
10. Telegram conversation import uses effects-backed `getTelegramFile` and `downloadTelegramFile` when present.
11. Legacy env fallback remains available for local/test mode.

Cloudflare route tests:

1. Each provider-effect route rejects missing proxy authorization through the existing outbound proxy path.
2. Each provider-effect route rejects missing active lease headers.
3. Each provider-effect route rejects stale attempt, stale lease generation, and stale workspace version.
4. Each provider-effect route rejects malformed JSON.
5. Telegram send returns normalized provider message fields.
6. Telegram ambiguous send preserves provider message ids and cleanup metadata.
7. Telegram chat action returns no provider secret material.
8. Telegram file download enforces the byte cap and returns base64 plus sha256 only.
9. Linq send returns normalized message/thread fields.
10. Linq mark-read/delete do not echo provider tokens or request bodies.
11. Unsupported effects paths return 404.

Invariant/regression tests:

1. Hosted Telegram send works without runtime `TELEGRAM_BOT_TOKEN` when effects methods exist.
2. Hosted Telegram typing works without runtime `TELEGRAM_BOT_TOKEN` when effects methods exist.
3. Hosted Telegram attachment import works without runtime `TELEGRAM_BOT_TOKEN` when effects methods exist.
4. Hosted Linq send works without runtime `LINQ_API_TOKEN` when effects methods exist.
5. Hosted Linq typing and mark-read work without runtime `LINQ_API_TOKEN` when effects methods exist.
6. Hosted Linq cleanup works without runtime `LINQ_API_TOKEN` when effects methods exist.

Do not assert full absence of `platformEnv` yet. That is Phase 3.

## Acceptance Criteria

Phase 2 is complete when:

- Hosted Telegram send uses `effectsPort.sendTelegram`.
- Hosted Telegram typing uses `effectsPort.sendTelegramChatAction`.
- Hosted Telegram media import uses `effectsPort.getTelegramFile` and `effectsPort.downloadTelegramFile`.
- Hosted Linq send uses `effectsPort.sendLinq`.
- Hosted Linq typing uses `effectsPort.sendLinqChatAction`.
- Hosted Linq mark-read uses `effectsPort.markLinqRead`.
- Hosted Linq cleanup uses `effectsPort.deleteLinqMessages`.
- Migrated hosted paths can run without provider tokens in runtime `platformEnv`.
- Local/test env-backed fallback remains explicit and covered.
- Cloudflare remains a narrow credentialed effects adapter, not a second runtime.
- No generic provider RPC or broad runtime host abstraction is introduced.
- Raw provider tokens, raw provider request bodies, attachment bytes, and raw provider responses are never logged or returned.

This is the clean Phase 2 seam: extend the existing `effectsPort`, migrate concrete call sites, keep provider authority in the Worker, and leave broader `platformEnv` deletion for Phase 3.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
