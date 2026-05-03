# Make hosted CLI device connect use the runtime device-connect capability

Status: active
Created: 2026-05-03
Updated: 2026-05-03

## Goal

Make `vault-cli device connect <target> --format json` the single assistant-visible way to create a wearable connection link, while preserving the existing authority split:

- Hosted runtime creates hosted links through the existing hosted runtime/web control-plane path.
- Local CLI creates local links through the managed local `device-syncd` daemon.
- The model no longer has to choose between a hosted helper and a daemon-shaped CLI command.

Physical `vault-cli` remains canonical. The CLI command registry stays unified, and runtime-aware service composition selects the authority below the model.

The core architectural result is a narrow invocation-scoped hosted CLI bridge for hosted child processes, not a new hosted OAuth implementation, not a second model-visible command surface, and not a broad hosted web/control proxy in the CLI.

## Success criteria

- In hosted runtime, `vault-cli device connect whoop --format json` returns a normalized hosted connect-link result with `backend: "hosted"` and an `authorizationUrl`.
- In hosted runtime, the command does not call `ensureManagedDeviceSyncControlPlane` or start `device-syncd`.
- In hosted runtime with no device-connect capability, the command returns a bounded hosted-unavailable error instead of `DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED`.
- In local runtime, `vault-cli device connect whoop --format json` keeps using the local daemon path and returns `backend: "local-daemon"`.
- Explicit CLI `--baseUrl` targeting remains local-only. Ambient local daemon env such as `DEVICE_SYNC_BASE_URL` is denied from hosted model-facing CLI env so inherited env cannot pierce the hosted boundary.
- The CLI manifest and prompt guidance stop describing `device connect` as a Murph-managed daemon command in hosted context.
- `authorizationUrl` is treated as a sensitive, state-bearing action URL: it is allowed in user-facing command JSON and final user responses, but query/fragment details are redacted from logs, fixtures, snapshots, diagnostics, prompts, manifests, and error payloads.
- No provider client secrets, provider tokens, hosted web callback-signing keys, broad runner proxy tokens, full authorization headers, local account usernames, home paths, standalone hosted OAuth state fields, or OAuth state internals are exposed in command output, generated docs, prompts, logs, or tests.

## Scope

In scope:

- CLI device-connect command semantics, result contract, and tests.
- A small hosted runtime capability bridge that lets a hosted child `vault-cli` process ask the already-injected `HostedRuntimeDeviceSyncPort` to create a connect link.
- Hosted Codex direct-CLI environment projection needed for that narrow capability only.
- Runtime-aware CLI service composition in the existing `createVaultCliWithOptions` / default service injection path.
- Hosted assistant CLI-surface manifest/prompt wording so the model sees one semantic connect primitive.
- Focused hosted-local proof that exercises the model-facing CLI command, not only the pre-model hosted helper.

Out of scope:

- New hosted OAuth/provider code in `packages/cli`.
- Passing hosted provider credentials, provider tokens, callback-signing keys, or broad Cloudflare runner proxy tokens to Codex shell commands.
- Merging hosted and local account stores.
- Making `device account list` synthesize hosted accounts from landed wearable data.
- Making `device daemon *`, explicit local reconcile, explicit local disconnect, or explicit local daemon start silently call hosted.
- Public `--runtime hosted|local|auto` flags. Runtime selection should be injected below the model.

## Constraints

- `apps/web` remains the canonical hosted device-sync control plane and keeps durable hosted device-sync facts in Postgres.
- `apps/cloudflare` remains the hosted execution plane; it may invoke the existing signed hosted web callbacks but must not become a second device-sync control plane.
- `packages/cli` must not import `apps/web` internals or provider OAuth implementations.
- The hosted child process cannot use the in-memory `HostedRuntimeDeviceSyncPort` directly; because the model runs physical `vault-cli`, a process-boundary seam is the minimal way for the command to reach hosted runtime authority. If this were an in-process assistant tool only, no bridge would be needed.
- The process-boundary bridge must be narrower than the existing runner web-control proxy: the first cut should expose only `device.connectLink`.
- The bridge authority must be invocation-scoped, bound to `127.0.0.1`/`::1` or a runtime-temp Unix socket path that does not include home/user identifiers, protected by a random token, and torn down after the hosted turn/invocation.
- The Codex shell env allowlist may include only the new narrow bridge endpoint/token names, not `HOSTED_EXECUTION_*`, `HOSTED_WEB_CALLBACK_SIGNING_*`, or Cloudflare runner proxy tokens.
- Hosted CLI bridge env names must be denied from user-provided/forwarded env input and injected only by the hosted runtime/platform.
- Hosted model-facing CLI env must also deny local daemon env keys such as `DEVICE_SYNC_BASE_URL`, `DEVICE_SYNC_CONTROL_TOKEN`, `DEVICE_SYNC_SECRET`, and `DEVICE_SYNC_STATE_DB_PATH`.

## Risks and mitigations

1. Risk: The bridge becomes a second broad hosted control proxy.
   Mitigation: Use a `HostedCliRuntimeBridge` transport with a hard first-cut allowlist of only `device.connectLink`; reject every other path/method with a typed error. Keep the existing Cloudflare web-control allowlist untouched.
2. Risk: The model can inspect the capability token from the hosted shell.
   Mitigation: Treat the token as authority to create short-lived connect links only, not as provider-token or web-control authority. Keep it single-invocation, loopback-only, and free of provider secrets.
3. Risk: Hosted `--open` behavior implies a browser can open inside the runner.
   Mitigation: Preserve the option for local compatibility, but hosted results should not attempt browser launch and should omit `openedBrowser` or set it to `false` with `backend: "hosted"`.
4. Risk: Existing local automation expects `baseUrl` and `state`.
   Mitigation: Make the output schema discriminated by `backend`; keep local fields present for `local-daemon`, make them optional in the shared result, and add tests for local JSON compatibility where callers still use local mode.
5. Risk: Assistant prompt text keeps telling the model to avoid CLI connect, so the model ignores the fixed primitive.
   Mitigation: Update hosted capability guidance and generated CLI contract together; test the prompt/manifest strings.
6. Risk: The capability server remains active after a turn or can be reused across users.
   Mitigation: Scope it to one runtime invocation, include user/attempt metadata in the server-side closure, stop it in `finally`, and verify wrong/missing token plus post-stop requests fail.
7. Risk: User-provided env spoofs hosted bridge configuration.
   Mitigation: Strip `MURPH_HOSTED_CLI_BRIDGE_*` and the hosted runtime marker from user/forwarded env before injecting runtime-owned values, and test that hostile forwarded values are ignored.
8. Risk: `authorizationUrl` contains OAuth state in its query string.
   Mitigation: Classify it as a user-action URL. Return it only in command JSON/final user response paths, never as a separate state field, and redact query/fragment details anywhere it is logged, snapshotted, embedded in manifests, or included in diagnostics.
9. Risk: Ambient local daemon env leaks into hosted CLI execution.
   Mitigation: Strip `DEVICE_SYNC_*` from hosted model-facing env. In hosted-marked runtime, only explicit command-line `--baseUrl` may force the local daemon path; inherited local daemon env never does.
10. Risk: Bridge token values are persisted or echoed in diagnostics.
   Mitigation: Add the bridge token env to secret classification/redaction tests and log only booleans such as `tokenPresent`, never token values or full authorization headers.

## Tasks

1. Normalize the device-connect result contract.
   - Make `deviceConnectResultSchema` a backend-discriminated runtime-neutral link result, with common fields `status: "ok"`, `kind: "device_connect_link"`, `provider`, optional `providerLabel`, `authorizationUrl`, and `expiresAt`.
   - Hosted branch: `backend: "hosted"` and no local daemon fields.
   - Local branch: `backend: "local-daemon"` plus local diagnostics such as `baseUrl`, `state`, and `openedBrowser`; prefer nesting under `local` for the greenfield shape, but inventory existing consumers before deciding whether a temporary local-only compatibility shim is needed.
   - Do not emit hosted OAuth state as a separate `state` field. The `authorizationUrl` may contain provider-required state, but it is an action URL whose query/fragment must be redacted outside user-facing output.
   - Do not add UI-shaped `presentation` fields in this architecture cut unless an existing renderer already requires them.
2. Inventory and migrate result consumers.
   - Audit all `DeviceConnectResult` consumers, generated CLI contracts, snapshots, scripts, and tests that assume `baseUrl`, `state`, or `openedBrowser` are required top-level fields.
   - Update consumers to use the semantic link fields first and local diagnostics only after checking the local branch.
   - Confirm the model/prompt does not need to inspect `backend`; it should send the returned `authorizationUrl`.
3. Rename the local implementation path internally.
   - Split the current `connect()` body into a clearly named local helper such as `connectViaLocalDaemon` or `createLocalDaemonDeviceConnectAuthority`.
   - Keep explicit `--baseUrl` and normal local-runtime `DEVICE_SYNC_BASE_URL` behavior local-only.
4. Add the device-connect authority seam and runtime-aware CLI service composition.
   - Introduce a `DeviceConnectAuthority` with a `createConnectLink` method that accepts `connectTarget`, `returnTo`, and `open`.
   - Compose `DeviceSyncServices.connect()` from an injected authority instead of calling the local daemon path directly.
   - Use the existing `createVaultCliWithOptions` and default service construction path; do not create a parallel command registry or hosted-only CLI.
5. Add the hosted CLI bridge contract.
   - Add the bridge env names and transport/client contract in a hosted-execution owner package, preferably `@murphai/hosted-execution` or a dedicated hosted CLI contract subpath. Keep CLI result schemas/errors in `@murphai/operator-config`; keep device-sync hosted payload types with the device-sync hosted-runtime owner.
   - Suggested environment names:
     - `MURPH_HOSTED_RUNTIME_PROCESS=1`
     - `MURPH_HOSTED_CLI_BRIDGE_URL`
     - `MURPH_HOSTED_CLI_BRIDGE_TOKEN`
   - Suggested initial request shape: `POST /device/connect-link` with `{ connectTarget: string, returnTo?: string | null }`.
   - Treat the bridge as generic hosted CLI infrastructure, but expose only this single `device.connectLink` capability in the first cut.
   - Do not encode provider secrets, web-control URLs, callback-signing details, or broad runner proxy tokens in this contract.
   - Treat `MURPH_HOSTED_CLI_BRIDGE_TOKEN` as a secret in redaction/classification code and tests; diagnostics may record only `tokenPresent`.
6. Implement the hosted CLI bridge server.
   - Start an invocation-local Unix socket or loopback server, or equivalent private local transport, while hosted assistant provider turns can run.
   - Reject `0.0.0.0`, external hosts, wrong methods, non-JSON or oversized bodies, missing/wrong tokens, and unknown capability paths.
   - Bind its `device.connectLink` handler to the existing `HostedRuntimeDeviceSyncPort.createConnectLink`.
   - Derive `messagingReturnTarget` only from the server closure's current hosted active input when it is known and unambiguous; otherwise omit it and use the hosted web route's normal settings return path.
   - Ignore or reject any model/CLI-supplied messaging return target so the model cannot redirect completion UX to the wrong channel.
   - Stop the server in `finally` and reject missing/wrong tokens.
7. Thread only the narrow bridge env to hosted Codex shell commands.
   - Strip bridge env names and hosted runtime markers from user/forwarded env first, then inject runtime-owned bridge values.
   - Add the bridge env names to the hosted process/direct-CLI projection path and the Codex shell `include_only` list.
   - Keep `HOSTED_EXECUTION_*`, `HOSTED_WEB_CALLBACK_SIGNING_*`, provider OAuth secrets, and broad runner proxy tokens denied.
   - Deny all local daemon env keys, including `DEVICE_SYNC_BASE_URL`, `DEVICE_SYNC_CONTROL_TOKEN`, `DEVICE_SYNC_SECRET`, and `DEVICE_SYNC_STATE_DB_PATH`, from hosted model-facing CLI env.
   - Assert bridge tokens and endpoint paths are absent from Codex config files, generated manifests, snapshots, stdout/stderr failure payloads, and test fixtures. If a socket path is logged, redact it to avoid user/home path leakage.
8. Make `DeviceSyncServices.connect` runtime-aware.
   - Resolution order:
     1. explicit CLI `--baseUrl` -> local daemon authority
     2. hosted runtime process marker plus complete bridge env -> hosted bridge authority
     3. hosted runtime process marker with missing, partial, invalid, refused, unauthorized, or schema-invalid bridge config -> bounded hosted-bridge error
     4. normal local process, including local `DEVICE_SYNC_BASE_URL`, -> local daemon authority
   - Hosted branch returns the normalized hosted result and never starts `device-syncd`.
   - Define `--returnTo` behavior in hosted mode: either map supported hosted return targets through the bridge or reject local-daemon-only/unsafe return URLs with a bounded error. Cover `--open` as hosted no-op/`false` behavior.
9. Make the assistant-visible CLI contract honest.
   - Change `device connect` description to "Create a device connection link for this runtime."
   - In hosted context, mark `device daemon *` as local/developer-only or omit it from the hosted assistant-facing contract if the manifest renderer supports a clean contextual overlay.
   - Replace prompt guidance that says supported hosted connect flows must not route through local `device connect`; after this change, the CLI command is the supported semantic primitive.
   - Regenerate or verify generated CLI artifacts such as `packages/cli/src/incur.generated.ts` and the `vault-cli --llms-full --format json` surface after command/schema changes.
10. Keep the existing pre-model hosted helper, but converge its implementation.
   - It may remain as a UX optimization for explicit connect requests.
   - It should share the same domain authority/result normalizer as the hosted CLI path, but it may call `HostedRuntimeDeviceSyncPort.createConnectLink` directly because it is in-process. The bridge is for child processes only.
11. Add focused regression coverage.
   - CLI unit tests for hosted bridge success, missing/partial/invalid/refused/unauthorized/schema-invalid hosted bridge errors, explicit local precedence, `--returnTo`, `--open`, target mapping, and local daemon success/failure.
   - Assistant-runtime tests proving the bridge server calls `HostedRuntimeDeviceSyncPort.createConnectLink`, derives safe messaging return metadata server-side, rejects CLI-supplied messaging overrides, rejects bad tokens, rejects unsupported paths/methods, rejects bad transports/oversized bodies/non-JSON payloads, strips spoofed forwarded bridge env, and shuts down.
   - Cloudflare runner tests proving only the narrow bridge env reaches the child/Codex shell, while runner proxy, callback-signing secrets, provider credentials, and local daemon `DEVICE_SYNC_*` env do not.
   - Assistant-engine manifest/prompt tests proving hosted context no longer says `device connect` is daemon-only.
   - Exact hosted child-process proof: hosted runtime starts a child/Codex shell with projected env, runs `vault-cli device connect whoop --format json`, returns `backend: "hosted"`/`kind: "device_connect_link"`, and proves `ensureManagedDeviceSyncControlPlane` and `startManagedDeviceSyncDaemon` were not called.
   - Provider target tests for at least WHOOP and one unsupported or local-only target, so hosted/local target names cannot drift silently.
   - Output/privacy assertions proving no `client_secret`, provider tokens, standalone hosted OAuth state field, callback signing details, bridge token value, local usernames, or local paths appear. Redact query/fragment details from concrete `authorizationUrl` values in logs/snapshots/diagnostics while preserving full user-facing command JSON.

## Decisions

- Do not add another hosted OAuth implementation. Hosted OAuth/link authority already exists in `apps/web` and is reached through `HostedRuntimeDeviceSyncPort.createConnectLink`.
- Do not pass broad hosted web-control or Cloudflare runner proxy authority into the CLI. The CLI gets only a narrow hosted CLI bridge endpoint/token.
- In hosted runtime, absence or failure of the bridge is an availability/configuration error, not permission to start the local daemon. Explicit local targeting remains the escape hatch for developers.
- Keep one public/model-facing command: `vault-cli device connect <target>`. Avoid public hosted/local runtime flags.
- The result contract should be honest about runtime authority without making the model choose authority. The model consumes the semantic link fields and sends `authorizationUrl`.
- The bridge is a child-process adapter only. In-process hosted helpers can call the hosted runtime port directly if they share the same authority/result normalization.
- Messaging return target is server-owned hosted context, not model input.
- `authorizationUrl` is a permitted user-facing action URL, but concrete query/fragment-bearing values are not durable documentation, prompt, manifest, log, or snapshot content.

## Verification

- Required focused commands will depend on the exact touched files, but expect at minimum:
  - `pnpm typecheck`
  - `pnpm --dir packages/cli verify:coverage` or truthful `pnpm test:diff <touched paths>`
  - `pnpm --dir packages/assistant-runtime test:coverage` or truthful `pnpm test:diff <touched paths>`
  - focused `apps/cloudflare` tests for hosted child/env/capability wiring
  - focused `packages/assistant-engine` prompt/manifest tests
  - generated CLI artifact/manifest verification, including `vault-cli --llms-full --format json`
  - hosted-local child-process device-connect scenario when the implementation touches the Cloudflare-hosted runner path
- Expected outcomes:
  - Hosted CLI connect returns `backend: "hosted"` with a real hosted connect URL in the harness.
  - Local CLI connect remains daemon-backed and local failures keep their local error codes.
  - No verification output, fixture, generated manifest, prompt, or test snapshot contains provider secrets, hosted signing material, bridge token values, full authorization headers, local account usernames, home paths, standalone hosted OAuth state fields, or unredacted authorization URL query/fragment details.
