Below is the final migration guide I’d use. It intentionally **does not add a provider bridge**, **does not add a second intercept layer**, and **does not introduce signed egress leases in the first cut**. The clean target is: make Codex’s process env stable, keep provider egress on the existing Cloudflare intercept, and stabilize only the existing hosted CLI bridge because Codex shell commands need it.

## Final goal

```text
UserRunner Durable Object
  -> owns active write fence

RunnerContainer
  -> owns warm container lifecycle, health, wake, reset

container-entrypoint
  -> owns one active invocation slot and /proc cleanup

assistant-runtime
  -> owns hosted runtime invocation
  -> owns one stable hosted CLI bridge for local Murph CLI/device commands

assistant-engine
  -> owns one single-slot warm Codex app-server

runner-egress-intercept
  -> owns provider allowlists, active write-fence validation, and real credential injection
```

No local provider proxy. No new generic capability server. No signed egress lease until metrics prove the existing write-fence validation is too expensive.

The uploaded plan’s key invariant still stands: a warm Codex process must never carry stale write-fence authority, CLI bridge authority, workspace identity, or config state into a later turn. 

## Current main blockers

Main already has direct hosted invocation and warm Codex machinery, so the remaining work is not “delete node-runner” again. The remaining blockers are these:

1. **Codex provider authority is still per-invocation env/config.** Hosted runtime builds `baseRuntimeEnv` with `attemptId`, `boundUserId`, `leaseGeneration`, and `workspaceVersion`.  Hosted Codex config then maps those env vars into OpenAI headers via `env_http_headers`.  Warm Codex identity hashes full env/config, so a normal second message changes identity and restarts Codex. 

2. **The hosted CLI bridge is still per-invocation.** It creates a new random token, new loopback port, and new server each invocation.  Codex shell env includes `HOSTED_CLI_BRIDGE_URL` and `HOSTED_CLI_BRIDGE_TOKEN`, so a warm Codex process would otherwise hold stale bridge values. 

3. **Provider rewrites should be uniformly authority-checked.** OpenAI already validates active write-fence authority before injecting the real credential.  The shown Mapbox path rewrites the injected query sentinel to the real token after route/sentinel checks, without the same active write-fence validation visible there. 

## Non-goals

Do not add:

```text
local provider bridge
second OpenAI intercept layer
signed egress lease in this migration
generic HostedRuntimeCapabilityServer
provider base URL proxy for every provider
new scheduler / queue / runtime service
Cloudflare-owned Codex state
DO-bypass authority model
```

Do keep:

```text
existing Cloudflare provider intercept
existing injected credential sentinel
existing UserRunner write-fence authority
existing container one-active-invocation gate
existing container /proc cleanup
assistant-engine single-slot warm Codex ownership
```

## Migration guide

### Phase 1 — remove provider write-fence authority from Codex env/config

Delete these from the long-lived Codex process env:

```text
MURPH_HOSTED_CODEX_BOUND_USER_ID
MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID
MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION
MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION
```

They should not be part of `baseRuntimeEnv` for Codex anymore.

Remove this block from hosted Codex config generation:

```toml
env_http_headers = {
  "x-hosted-runner-bound-user-id" = "...",
  "x-hosted-runtime-attempt-id" = "...",
  "x-hosted-runtime-lease-generation" = "...",
  "x-hosted-runtime-workspace-version" = "..."
}
```

Keep provider credential sentinel behavior. Codex should still see:

```text
OPENAI_API_KEY=__cloudflare_injected__
MAPBOX_ACCESS_TOKEN=__cloudflare_injected__
...
```

Provider authority should be enforced by the existing Cloudflare intercept, not by headers baked into Codex config.

### Phase 2 — make provider rewrites uniformly authority-checked

For every provider path that replaces `__cloudflare_injected__` with a real secret, require active authority first.

Required rule:

```text
No active write fence => no real provider credential injection.
```

OpenAI already does this through `requestOwnsRuntimeWriteFence(...)`. Apply the same rule to Mapbox and any other injected-credential rewrite path that does not already validate authority.

For this migration, accept the existing DO validation cost. Model/provider latency should be measured before adding signed egress leases or other hot-path optimizations.

Add diagnostics around provider authorization:

```text
providerKind
writeFenceValidationDurationMs
providerRequestAuthorized
providerUpstreamDurationMs
providerTotalDurationMs
```

Only consider signed egress leases later if this proves meaningful.

### Phase 3 — refactor the hosted CLI bridge into a stable bridge

Do not create a new abstraction. Refactor the existing `startHostedCliRuntimeBridge(...)`.

Current shape:

```text
per invocation:
  random token
  random loopback port
  new HTTP server
  env returned to Codex/runtime
```

Target shape:

```text
per warm container process:
  one stable token
  one stable loopback port
  one stable HTTP server

per invocation:
  temporarily bind active deviceSyncPort + messagingReturnTarget
```

API shape:

```ts
const cliBridge = await getOrCreateHostedCliRuntimeBridge();

const runtimeEnv = {
  ...hostedCodexRuntime.runtimeEnv,
  ...cliBridge.env, // stable HOSTED_CLI_BRIDGE_URL + HOSTED_CLI_BRIDGE_TOKEN
};

await cliBridge.runWithInvocation(
  {
    deviceSyncPort: guardedRuntime.platform.deviceSyncPort ?? null,
    messagingReturnTarget: () => hostedCliBridgeMessagingReturnTarget,
    signal: runtimeAbortController.signal,
  },
  async () => {
    return await runHostedWorkspaceRuntimeJobInProcess(...);
  },
);
```

The bridge should keep exactly one mutable field:

```ts
let active:
  | {
      deviceSyncPort: HostedRuntimeDeviceSyncPort | null;
      messagingReturnTarget:
        () => HostedRuntimeDeviceSyncMessagingReturnTarget | null;
      signal: AbortSignal;
    }
  | null = null;
```

Bridge behavior:

```text
active exists:
  route CLI requests to active runtime ports

active missing:
  return unauthorized/unavailable

request with wrong token:
  unauthorized

active invocation ends:
  clear active in finally
```

This keeps local-Murph-like behavior: Codex can run normal Murph CLI commands, and hosted runtime supplies the backing device-sync/control-plane capability through a stable local endpoint.

### Phase 4 — order hosted runtime setup around stable env

Currently hosted runtime prepares Codex env before starting the per-invocation CLI bridge. That must change.

New order:

```text
1. get/create stable hosted CLI bridge
2. build stable runtime env, including stable bridge env
3. prepareHostedCodexRuntimeEnvironment(stable env)
4. bind cliBridge.runWithInvocation(...)
5. run hosted workspace runtime job
6. clear active bridge binding in finally
```

The bridge server can be process-lifetime; the active invocation binding is per-run.

### Phase 5 — stabilize Codex process identity

Replace full env hashing:

```ts
envDigest: hashStableCodexIdentity(input.env)
```

with a stable projection:

```ts
envDigest: hashStableCodexIdentity(
  projectHostedCodexStableIdentityEnv(input.env),
)
```

Include:

```text
CODEX_HOME
PATH policy
CA bundle paths
HOME / TMPDIR / VAULT if stable per warm workspace
model/provider id
model id
sandbox / approval policy
generated config.toml stable content
skills root
stable HOSTED_CLI_BRIDGE_URL
stable HOSTED_CLI_BRIDGE_TOKEN identity/fingerprint
test app-server command in NODE_ENV=test
workingDirectory / vault root until proven safe to relax
```

Exclude:

```text
attemptId
leaseGeneration
workspaceVersion
active write-fence headers
per-invocation CLI bridge values
provider authority headers
temporary progress/turn state
```

This is what enables:

```text
message 1 -> Codex pid P
message 2 ten seconds later -> same Codex pid P
```

### Phase 6 — remove authority env from direct CLI env allowlist

Remove these from `HOSTED_CODEX_DIRECT_CLI_ENV_NAMES`:

```text
MURPH_HOSTED_CODEX_BOUND_USER_ID
MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID
MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION
MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION
```

Keep stable CLI bridge env in the allowlist:

```text
HOSTED_CLI_BRIDGE_URL
HOSTED_CLI_BRIDGE_TOKEN
```

Provider credentials remain sentinels, not real secrets.

### Phase 7 — add strict stale-bridge guards

The stable CLI bridge must be safe after invocation completion.

Rules:

```text
CLI bridge request outside active invocation:
  return unauthorized/unavailable

CLI bridge request outside active invocation from warm Codex:
  poison warm Codex or mark container poisoned

active invocation cleanup:
  clear active bridge binding in finally

active invocation aborts ambiguously:
  clear active binding and do not keep container warm unless cleanup proves safe
```

Keep this simple. No queues. No long-lived active state. No request replay.

### Phase 8 — keep assistant-engine as the only Codex lifecycle owner

Do not move Codex lifecycle to assistant-runtime or Cloudflare.

Keep this split:

```text
assistant-engine:
  owns Codex process, JSON-RPC, active turn, poisoning, reuse

container-entrypoint:
  asks assistant-engine for expected root process snapshot
  runs /proc cleanup
  preserves only verified expected root
```

Current main’s single warm slot and expected-root cleanup model are the right ownership shape.  The container cleanup already preserves only the expected Codex root and treats other descendants or same-UID orphans as leaks. 

### Phase 9 — keep `/health` boring

Do not put bridge/Codex deep validation in health.

Health should stay:

```text
process alive
architecture version
active job count
poisoned flag
last cleanup status
bundle metadata if already cached
```

Expensive proof belongs:

```text
after invocation
before keeping warm state
on explicit reset/shutdown
```

### Phase 10 — tests before deploy

Add tests for the exact goal:

```text
same user
same warm container
message 1 completes with Codex pid P
message 2 arrives 10 seconds later
same Codex pid P is reused
OpenAI request in message 2 is authorized by active message 2 write fence
device-connect CLI command in message 2 uses stable bridge URL/token
device-connect CLI command resolves message 2 active deviceSyncPort
```

Add focused tests:

```text
Codex identity ignores attemptId changes
Codex identity ignores leaseGeneration changes
Codex identity ignores workspaceVersion changes
Codex identity includes model/provider/config changes
Codex identity includes stable bridge URL/token changes
Codex config has no env_http_headers for write-fence authority
provider rewrites deny without active write fence
Mapbox rewrite denies without active write fence
stable CLI bridge returns unauthorized outside active invocation
stable CLI bridge active binding clears on success/failure/abort
late CLI bridge request after invocation poisons or prevents warm reuse
```

Keep existing cleanup tests:

```text
unexpected descendants killed
same-UID daemonized orphans killed
expected Codex root preserved only when verified
failed cleanup poisons/destroys warm shell
```

## Rollout plan

1. Land provider authority removal from Codex env/config behind tests.
2. Land Mapbox/uniform provider authority checks.
3. Land stable CLI bridge refactor.
4. Land stable Codex identity projection.
5. Run hosted-local E2E for:

   ```text
   OpenAI Codex turn
   second message same warm container
   Mapbox provider call
   device-connect CLI command
   runtime wake while active
   direct R2 smoke
   cleanup leak tests
   ```
6. Deploy with normal architecture-version warm-container reset.
7. Monitor:

   ```text
   Codex process reuse rate
   Codex identity mismatch reasons
   provider write-fence validation latency
   provider authorization failures
   CLI bridge unauthorized/off-invocation requests
   warm container poisoned count
   process cleanup failures
   ```

## What to defer

Defer signed egress leases until metrics show write-fence validation latency matters.

Defer local provider proxy indefinitely unless the existing intercept cannot support a provider cleanly.

Defer relaxing `workingDirectory` / `vaultRoot` from Codex identity until tests prove Codex app-server can safely context-switch across those roots.

## Final target state

```text
Warm container keeps:
  stable hosted CLI bridge
  stable Codex env/config
  single warm Codex app-server

Per invocation changes:
  active write fence in UserRunner
  active CLI bridge binding
  runtime wake signal
  runtime workspace/checkpoint state

Provider secrets:
  still injected only by existing Cloudflare egress intercept

Codex process:
  no per-invocation authority in env/config
  reusable across follow-up messages in same warm container
```

This is the smallest clean architecture that satisfies the goal: reliable Codex app-server reuse across messages, provider tools still authorized, device-connect CLI still works, and no extra provider bridge or second intercept layer.
