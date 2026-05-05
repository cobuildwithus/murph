# Hosted Mailbox Payload Decode Phase 1

## Goal

Land Phase 1 as a narrow mailbox-payload decode migration, not as a broad runtime-host or platform refactor.

The long-term primitive for this phase is:

> Replace "runtime can build a mailbox encryption environment from `platformEnv`" with "runtime can call a non-serializable mailbox payload decoder hook."

Do not remove `platformEnv` in this phase. A one-line removal would break mailbox decrypt, Telegram handling, and Junction/device-sync, and it would not solve all device-sync secret exposure because some authority is also serialized through `resolvedConfig`.

Phase 1 should remove the hosted runtime's need for crypto root unwrap and callback-signing authority during mailbox import only. That is the smallest clean step that proves the architecture.

Success criteria:

- Hosted mailbox import can use `decodeMailboxPayload`.
- Hosted mailbox import works with empty `runtime.platformEnv` for mailbox decrypt.
- Hosted runner paths pass the decoder when proxy transport is available.
- The decode route is protected by invocation proxy token and active invocation lease.
- The decode route returns only a parsed wake or blocked result.
- The decode route never returns root keys, private JWKs, callback-signing material, or decrypted arbitrary raw JSON.
- Legacy direct decrypt remains only as fallback for local/test paths.
- No hosted Cloudflare path silently falls back to direct `platformEnv` decrypt when proxy decode is expected.

Implementation refinements from code review:

- Wire the decoder whenever the invocation proxy token is present, even when no local loopback proxy base URL is configured. Direct internal-host mode must not silently fall back to legacy `platformEnv` decrypt.
- Reuse the existing runner outbound ingress crypto context resolver for Worker-side decrypt and adapt it to the mailbox decrypt interface, instead of adding a second root-fetching/cache abstraction.
- Keep request and response validation in the app-local decode contract module so the route and client share one small parser surface.

## Why This Seam

Main branch already has the right seam in `apps/cloudflare/src/runtime-bridge-workspace.ts`.

Today it accepts `readEncryptionEnvironment`, and if none is supplied it builds one from `runtime.platformEnv`. That default path reads Cloudflare crypto/callback-signing env, fetches runtime roots, and throws if `platformEnv` is empty. The same file then uses `decryptHostedMailboxPayloadCiphertext` for both conversation mailbox imports and system mailbox imports.

The minimal clean change is not a general `RuntimeHost` or new global `HostedRuntimePlatform` port. It is to change this bridge option from an authority-shaped hook:

```ts
readEncryptionEnvironment({ userId }) => HostedMailboxEncryptionEnvironment;
```

to a payload-shaped hook:

```ts
decodeMailboxPayload(input) => decoded wake;
```

That preserves the local runtime as the real runtime. Cloudflare only performs a narrow privileged operation: decrypt this mailbox payload for this active invocation.

## Target Invariant

After Phase 1:

- Hosted mailbox import can run without the container reading hosted crypto private JWKs.
- Hosted mailbox import can run without the container reading web callback-signing private JWKs.
- The container receives only the decoded wake payload it already needs to process.
- The container does not receive root keys, private JWKs, callback-signing material, or a root-fetch capability.
- Local/test direct decrypt behavior remains available as an explicit fallback.
- `platformEnv` may still exist for legacy Telegram/device-sync paths until later phases.

## Scope Clarification

The Worker route should return decoded `HostedExecutionWake`, not only `conversation.message`.

Reason: main branch decrypts both conversation mailbox items and non-conversation system mailbox items in `runtime-bridge-workspace.ts`. The system path decrypts the payload, parses it as a hosted wake, checks it against the mailbox item, and enqueues it.

Phase 1 should support:

```ts
HostedExecutionWake;
```

Then the runtime still enforces:

- conversation route must decode to `conversation.message`;
- system route must decode to a non-conversation wake that matches item metadata.

Do not push mailbox-routing semantics into Cloudflare.

## Runtime Bridge Migration

### Add a mailbox decode hook

Add these local types near the existing bridge option types in `apps/cloudflare/src/runtime-bridge-workspace.ts`:

```ts
export interface HostedWorkspaceMailboxPayloadDecodeInput {
  itemRef: {
    dedupeKey: string;
    id: string;
    kind: string;
    lane: string;
    laneSeq: string;
    occurredAt: string;
    userId: string;
  };
  payloadCiphertext: string;
  payloadRequestId: string | null;
  payloadSchema: string;
  payloadSource: "inline" | "sidecar";
}

export type HostedWorkspaceMailboxPayloadDecodeResult =
  | {
      status: "decoded";
      wake: HostedExecutionWake;
    }
  | {
      status: "blocked";
      reasonCode: string;
      retryable: boolean;
    };

export interface HostedWorkspaceMailboxPayloadDecoder {
  decode(
    input: HostedWorkspaceMailboxPayloadDecodeInput,
  ): Promise<HostedWorkspaceMailboxPayloadDecodeResult>;
}
```

Extend `HostedWorkspaceRuntimeBridgeOptionsInput`:

```ts
export interface HostedWorkspaceRuntimeBridgeOptionsInput {
  platform: HostedWorkspaceRuntimeJobOptions["platform"];
  readCurrentLease?: HostedRuntimeBridgeReadCurrentLease;

  // New preferred capability.
  decodeMailboxPayload?: HostedWorkspaceMailboxPayloadDecoder;

  // Legacy fallback only.
  readEncryptionEnvironment?: (
    input: { userId: string },
  ) =>
    | HostedMailboxEncryptionEnvironment
    | Promise<HostedMailboxEncryptionEnvironment>;

  request: HostedWorkspaceInvocationRequest;
  runtime: HostedAssistantRuntimeConfig;
  vaultRoot: string;
  webControlAllowHttpHosts?: readonly string[];
  webControlBaseUrl?: string | null;
  webControlFetch?: typeof fetch;
}
```

In `createHostedWorkspaceRuntimeBridgeJobOptions`, construct a decoder:

```ts
const decodeMailboxPayload =
  input.decodeMailboxPayload ??
  createLegacyHostedMailboxPayloadDecoder({
    readEncryptionEnvironment:
      input.readEncryptionEnvironment ??
      createHostedMailboxEncryptionEnvironmentReader({
        runtime,
        webControlAllowHttpHosts: input.webControlAllowHttpHosts,
        webControlBaseUrl: input.webControlBaseUrl ?? null,
        webControlFetch: input.webControlFetch,
      }),
  });
```

Then pass `decodeMailboxPayload` into `createHostedWorkspaceBridgeMailboxImporter`.

Keep `readEncryptionEnvironment` only to build the legacy decoder. Do not keep both threaded through the importer.

### Refactor the mailbox importer

Change `createHostedWorkspaceBridgeMailboxImporter` input from:

```ts
readEncryptionEnvironment: (...);
```

to:

```ts
decodeMailboxPayload: HostedWorkspaceMailboxPayloadDecoder;
```

For conversation mailbox items, adapt the broad decoder to the existing conversation-specific decoder:

```ts
const importConversationItem = createHostedConversationMailboxImportItem({
  decodePayload: {
    decode: async (decodeInput) => {
      const decoded = await input.decodeMailboxPayload.decode({
        itemRef: decodeInput.itemRef,
        payloadCiphertext: decodeInput.payloadCiphertext,
        payloadRequestId: decodeInput.payloadRequestId,
        payloadSchema: decodeInput.payloadSchema,
        payloadSource: decodeInput.payloadSource,
      });

      if (decoded.status === "blocked") {
        return decoded;
      }

      if (decoded.wake.kind !== "conversation.message") {
        return {
          reasonCode: "payload.decode_mismatch",
          retryable: false,
          status: "blocked",
        };
      }

      return {
        status: "decoded",
        wake: decoded.wake,
      };
    },
  },
  ...
});
```

For system mailbox items:

```ts
const decoded = await input.decodeMailboxPayload.decode({
  itemRef: {
    dedupeKey: input.item.item.dedupeKey,
    id: input.item.item.id,
    kind: input.item.item.kind,
    lane: input.item.item.lane,
    laneSeq: input.item.item.laneSeq,
    occurredAt: input.item.item.occurredAt,
    userId: input.item.item.userId,
  },
  payloadCiphertext: input.item.payload.payloadCiphertext,
  payloadRequestId: input.item.payload.requestId,
  payloadSchema: input.item.payload.payloadSchema,
  payloadSource: input.item.payload.source,
});

if (decoded.status === "blocked") {
  return decoded;
}

const wake = decoded.wake;

if (!decodedSystemWakeMatchesMailboxItem(wake, input.item)) {
  return {
    reasonCode: "payload.decode_mismatch",
    retryable: false,
    status: "blocked",
  };
}

return await enqueueHostedSystemMailboxItem({
  item: input.item,
  vaultRoot: input.vaultRoot,
  wake,
});
```

This keeps mailbox semantics inside the runtime bridge.

### Add a legacy decoder helper

Still in `runtime-bridge-workspace.ts`, add:

```ts
function createLegacyHostedMailboxPayloadDecoder(input: {
  readEncryptionEnvironment: (
    input: { userId: string },
  ) =>
    | HostedMailboxEncryptionEnvironment
    | Promise<HostedMailboxEncryptionEnvironment>;
}): HostedWorkspaceMailboxPayloadDecoder {
  return {
    async decode(decodeInput) {
      const decodedPayload = await decryptHostedMailboxPayloadCiphertext({
        ciphertext: decodeInput.payloadCiphertext,
        environment: await input.readEncryptionEnvironment({
          userId: decodeInput.itemRef.userId,
        }),
        metadata: {
          dedupeKey: decodeInput.itemRef.dedupeKey,
          itemId: decodeInput.itemRef.id,
          kind: decodeInput.itemRef.kind,
          lane: decodeInput.itemRef.lane,
          laneSeq: decodeInput.itemRef.laneSeq,
          occurredAt: decodeInput.itemRef.occurredAt,
          payloadSchema: decodeInput.payloadSchema,
          payloadStorage:
            decodeInput.payloadSource === "inline" ? "inline" : "sidecar",
          userId: decodeInput.itemRef.userId,
        },
      });

      return {
        status: "decoded",
        wake: parseHostedExecutionWake(decodedPayload),
      };
    },
  };
}
```

This preserves local/test compatibility while making the new hosted path a drop-in replacement.

## Worker-Side Decode Route

### Add an internal decode contract

Add a local Cloudflare route constant in a small app-local contract module:

```txt
apps/cloudflare/src/runtime-mailbox-payload-decode-contract.ts
```

```ts
export const HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH =
  "/internal/hosted-runtime/mailbox-payload/decode";
```

Keep this app-local for now. Do not create a new package. Phase 1 does not need a broad protocol package.

### Handle the route locally

In `apps/cloudflare/src/runner-outbound/web-control.ts`, add a local handler before the generic allowlist/forwarding block:

```ts
if (input.url.pathname === HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH) {
  return handleRunnerMailboxPayloadDecodeRequest({
    env: input.env,
    environment: input.environment,
    request: input.request,
    userId: input.userId,
  });
}
```

This route belongs before `isAllowedHostedRunnerWebControlRequest` because it is not a web-control-plane route forwarded to `apps/web`. It is a Worker-owned hosted-runner capability.

The request is still protected by the existing runner outbound proxy path before it reaches `handleRunnerWebControlRequest`, because `handleRunnerOutboundRequest` requires internal proxy authorization for hosted runtime internal hostnames.

### Add `runner-outbound/mailbox-payload-decode.ts`

Create:

```txt
apps/cloudflare/src/runner-outbound/mailbox-payload-decode.ts
```

Responsibilities:

1. Accept `POST` only.
2. Parse a strict JSON body.
3. Validate `itemRef.userId === route userId`.
4. Read active lease proof headers:
   - `x-hosted-runtime-attempt-id`
   - `x-hosted-runtime-lease-generation`
   - `x-hosted-runtime-workspace-version`
5. Check `USER_RUNNER` owns the active lease.
6. Decrypt with Worker-owned crypto/callback-signing environment.
7. Parse decrypted payload as `HostedExecutionWake`.
8. Verify `wake.userId === userId`.
9. Return `{ status: "decoded", wake }`.

Do not log ciphertext. Do not log plaintext. Do not return keys.

Request body:

```ts
interface HostedMailboxPayloadDecodeRequest {
  itemRef: {
    dedupeKey: string;
    id: string;
    kind: string;
    lane: string;
    laneSeq: string;
    occurredAt: string;
    userId: string;
  };
  payloadCiphertext: string;
  payloadRequestId: string | null;
  payloadSchema: string;
  payloadSource: "inline" | "sidecar";
}
```

Response body:

```ts
type HostedMailboxPayloadDecodeResponse =
  | {
      status: "decoded";
      wake: HostedExecutionWake;
    }
  | {
      status: "blocked";
      reasonCode: string;
      retryable: boolean;
    };
```

In practice, the Worker route should usually return only `decoded` on success. Most transport, auth, and decrypt failures should be HTTP errors, not `blocked`.

Reserve `blocked` for valid requests whose payload is semantically not importable. The runtime still owns most semantic mismatch blocking, so this route should rarely return `blocked`.

### Add an active lease helper

Create:

```txt
apps/cloudflare/src/runner-outbound/active-lease.ts
```

```ts
export interface RunnerActiveInvocationLeaseHeaders {
  attemptId: string;
  leaseGeneration: string;
  workspaceVersion: string;
}

export function readRunnerActiveInvocationLeaseHeaders(
  request: Request,
): RunnerActiveInvocationLeaseHeaders | null;

export async function requireRunnerActiveInvocationLease(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<RunnerActiveInvocationLeaseHeaders>;
```

Internally it should use the same `resolveRunnerOutboundUserRunnerStub` and `ownsActiveInvocationLease` pattern already present in `web-control.ts`.

The `web-control.ts` checkpoint code can optionally use the helper too, but do not over-refactor in Phase 1. Minimal change is acceptable: use the helper only in the new decode route.

## Worker-Owned Decryption

The existing decrypt primitive is good: `decryptHostedMailboxPayloadCiphertext` takes ciphertext, a `HostedMailboxEncryptionEnvironment`, and mailbox crypto metadata.

The unsafe part is the current environment source: `readHostedMailboxEncryptionEnvironmentFromRuntime` reads `runtime.platformEnv` and extracts crypto/callback-signing authority.

For the Worker route, create a Worker-owned environment builder:

```ts
function createHostedMailboxEncryptionEnvironmentFromWorker(input: {
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  userId: string;
  fetchImpl?: typeof fetch;
}): HostedMailboxEncryptionEnvironment;
```

It should use `environment.hostedCrypto`, `environment.hostedWebBaseUrl`, `environment.webCallbackSigning`, and `fetchHostedWorkerRuntimeRootByRootKeyId`, rather than reading anything from runtime config.

If `fetchHostedWorkerRuntimeRootByRootKeyId` still needs the exact `HostedWorkerCryptoEnv` object, construct it from Worker environment values in this handler. The architectural rule is: the container never sees that object.

## Runner-Side Decoder Wiring

### Add a client-side decoder helper

Create:

```txt
apps/cloudflare/src/runtime-bridge-mailbox-payload-decode.ts
```

Export:

```ts
export function createCloudflareHostedMailboxPayloadDecoder(input: {
  fetchImpl: typeof fetch;
  readCurrentLease: () =>
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  timeoutMs: number;
}): HostedWorkspaceMailboxPayloadDecoder;
```

Implementation:

1. Read current lease.
2. If no lease exists, throw. Do not return `blocked`; this is invocation/liveness state, not a mailbox-item semantic failure.
3. POST to `HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH`.
4. Include active lease headers.
5. Parse the response strictly.
6. On non-2xx, throw a safe error.

Use `createCloudflareHostedRuntimeFetch(...)` as the fetch implementation so the existing internal proxy token is attached for internal hostnames.

### Wire child and in-process runner paths

Update:

```txt
apps/cloudflare/src/node-runner-child.ts
apps/cloudflare/src/node-runner.ts
```

In `node-runner-child.ts`, pass the decoder when `internalWorkerProxyToken` and `localInternalProxyBaseUrl` are present:

```ts
decodeMailboxPayload: createCloudflareHostedMailboxPayloadDecoder({
  fetchImpl: webControlFetch,
  readCurrentLease: () => currentLease,
  timeoutMs: readHostedRunnerCommitTimeoutMs(...),
});
```

Use the same `currentLease` object that is updated on checkpoint.

In `node-runner.ts`, pass the same decoder into `createHostedWorkspaceRuntimeBridgeJobOptions` when `webControlFetch` exists.

This keeps both runner modes consistent.

## Error Handling Policy

Throw on capability, transport, and auth errors. These should fail the invocation rather than permanently block a mailbox item:

- missing proxy token;
- bad proxy token;
- missing active lease;
- stale attempt;
- stale lease generation;
- stale workspace version;
- malformed decode request;
- Worker decrypt exception;
- route returns non-2xx.

Reason: these are runtime/system failures, not proof that the mailbox item itself is bad.

Return `blocked` only for semantic item/payload mismatches:

- decoded conversation route is not `conversation.message`;
- decoded system wake does not match mailbox item;
- decoded wake has wrong kind/user/timestamp/dedupe.

This matches current behavior where explicit mismatch returns `status: "blocked"`.

## Out Of Scope

Do not remove `platformEnv` in Phase 1.

After Phase 1, `platformEnv` is no longer needed for mailbox decrypt, but it may still be needed for:

- Telegram attachment/channel paths;
- Junction/device-sync runtime;
- legacy device-sync serialized config behavior.

The next milestone is to prove mailbox decrypt no longer consumes `platformEnv`, not to remove it from the job immediately.

## Tests To Add

Bridge unit tests:

1. `createHostedWorkspaceRuntimeBridgeJobOptions` prefers `decodeMailboxPayload` over `readEncryptionEnvironment`.
2. Conversation mailbox import succeeds with `runtime.platformEnv = {}` when decoder is provided.
3. System mailbox import succeeds with `runtime.platformEnv = {}` when decoder is provided.
4. `readEncryptionEnvironment` is not called when decoder is provided.
5. Legacy direct decrypt still works when no decoder is provided.

Route tests:

1. Decode route rejects non-POST.
2. Decode route rejects missing proxy token.
3. Decode route rejects wrong user.
4. Decode route rejects missing active-lease headers.
5. Decode route rejects stale attempt/lease/workspace version.
6. Decode route does not return root key, root key id, private JWK, callback-signing details, or raw plaintext JSON.
7. Decode route returns `status: "decoded"` with a parsed `HostedExecutionWake`.

Runner integration tests:

1. `node-runner-child.ts` passes decoder when proxy plumbing exists.
2. Hosted mailbox import works without calling `readHostedMailboxEncryptionEnvironmentFromRuntime`.
3. Current local/test direct-decrypt path still works.
4. Phase 0 invariant test no longer flags mailbox crypto private JWK as semantically required for mailbox decode, even if still present elsewhere until later phases.

## Suggested PR Boundaries

### PR 1: Runtime bridge hook

Files:

```txt
apps/cloudflare/src/runtime-bridge-workspace.ts
apps/cloudflare/test/runtime-bridge-workspace*.test.ts
```

Changes:

- add `decodeMailboxPayload` option;
- add legacy decoder adapter;
- refactor conversation/system imports to use decoded wake;
- prove local fallback still works.

This PR has no Worker route yet. Use fake decoder tests.

### PR 2: Cloudflare hosted decoder

Files:

```txt
apps/cloudflare/src/runtime-mailbox-payload-decode-contract.ts
apps/cloudflare/src/runtime-bridge-mailbox-payload-decode.ts
apps/cloudflare/src/runner-outbound/active-lease.ts
apps/cloudflare/src/runner-outbound/mailbox-payload-decode.ts
apps/cloudflare/src/runner-outbound/web-control.ts
apps/cloudflare/src/node-runner-child.ts
apps/cloudflare/src/node-runner.ts
apps/cloudflare/test/*
```

Changes:

- add route;
- add client decoder;
- wire hosted runner;
- add auth/lease/decode tests.

This keeps the bridge refactor independent from the proxy implementation.

## Acceptance Criteria

Phase 1 is done when all of this is true:

- Hosted mailbox import can use `decodeMailboxPayload`.
- Hosted mailbox import works with empty `runtime.platformEnv` for mailbox decrypt.
- Hosted runner paths pass the decoder when proxy transport is available.
- Decode route is protected by invocation proxy token and active invocation lease.
- Decode route returns only a parsed wake or blocked result.
- Decode route never returns root keys, private JWKs, callback-signing material, or decrypted arbitrary raw JSON.
- Legacy direct decrypt remains only as fallback for local/test paths.
- No hosted Cloudflare path silently falls back to direct `platformEnv` decrypt when proxy decode is expected.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
