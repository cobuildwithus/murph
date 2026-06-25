# Hosted OpenAI Egress 401 Incident Handoff

All timestamps are UTC. This note is a point-in-time handoff for senior
engineering review. Direct member identifiers, request URLs, and raw payloads
are intentionally omitted.

## Summary

Hosted assistant replies stopped because Codex App Server could not complete
OpenAI calls from inside the Cloudflare runner container. Telegram and Linq were
not the failing provider surfaces; no assistant reply was generated before those
delivery paths.

Cloudflare provider-egress logs show OpenAI requests returning `401` with:

- `writeFenceValidationMode=missing_identity`
- `writeFenceValidationRejectReason=active_user_context_missing`
- `providerRequestAuthorized=false`
- `userIdPresent=false`
- `runtimeAuthorityHeadersPresent=false`
- `providerEgressTokenPresent=false`
- `writeFenceMetadataPresent=false`

This means the Worker refused to inject the Worker-owned OpenAI key because the
tokenless active-user-fence proof failed before any user or write-fence metadata
was recovered.

## Affected Case

- Affected member: `<affected_member_id>`
- User-visible symptom: hosted Murph did not reply over production messaging,
  including Telegram.
- Assistant failure shape: `ASSISTANT_CODEX_FAILED` with Codex app-server status
  `failed` and upstream `401 Unauthorized`.
- First high-level Codex failure observed: `2026-06-25 00:07:23.625`.
- First lower-level OpenAI provider-egress diagnostic observed in the DB:
  `2026-06-25 00:01:42.702`, on `/v1/responses/compact`.

## Current Production State At Last Check

At `2026-06-25 01:54:34`, DB time:

- Production Cloudflare deployment status still reported Worker version
  `a0990de0-8f3f-4830-a83f-e05b481c7caa`.
- That deployment was annotated `production direct deploy git-332eeceb3010`.
- Deployment creation time was `2026-06-25T01:48:26.413925Z`.
- Cloudflare still reported OpenAI egress `401 / missing_identity /
  active_user_context_missing` on version `a0990de0...` after that deploy.
- DB logs showed 3 affected-member `401 Unauthorized` assistant failures after
  `2026-06-25 01:48:26`, latest at `2026-06-25 01:52:39.908`.

Local/current git history then showed rollback commits on `main`:

- `c267ed9cf5` reverts `fix(hosted-egress): recover tokenless openai egress`.
- `fd626ab453` reverts `perf: parallelize hosted runtime startup (#286)`.

At the time this note was written, the observed Cloudflare deployment status had
not yet reflected those rollback commits.

## Confirmed Evidence

### DB Runtime Logs

Relevant projected fields from `hosted_runtime_log` for the affected member:

- `event_code=runner.provider_egress_diagnostic` at
  `2026-06-25 00:01:42.702`, `00:03:02.851`, and `00:05:03.159`.
- These diagnostics were OpenAI requests with `endpointKind=responses_compact`
  and `codexRequestKind=compaction`.
- First assistant-level failure at `2026-06-25 00:07:23.625`:
  `ASSISTANT_CODEX_FAILED`, `failureCodexFailureStage=turn_failed`,
  `failureCodexTurnStatus=failed`, `failureRetryable=false`.
- Redacted safe error shape:
  `Codex app-server turn failed. status failed. unexpected status 401 Unauthorized`.

The DB table did not expose all egress authorization fields for the high-level
assistant rows, but Cloudflare Worker logs did.

### Cloudflare Worker Observability

Querying `cloudflare-workers` for:

- `$metadata.service=murph-hosted`
- `$metadata.message=Hosted runner provider egress completed.`
- `details.providerKind=openai`
- window `2026-06-25T00:00:00Z` to `2026-06-25T01:55:00Z`

returned one aggregate bucket:

- `details.responseStatus=401`
- `details.responseOk=false`
- `details.writeFenceValidationMode=missing_identity`
- `details.writeFenceValidationRejectReason=active_user_context_missing`
- `details.providerRequestAuthorized=false`
- `details.userIdPresent=false`
- `details.runtimeAuthorityHeadersPresent=false`
- `details.providerEgressTokenPresent=false`
- `details.writeFenceMetadataPresent=false`
- count: 1634 events

After the hotfix deployment cutover at `2026-06-25T01:48:26Z`, Cloudflare still
reported the same shape on script version `a0990de0...`:

- count: 78 OpenAI provider-egress events
- all `401 / missing_identity / active_user_context_missing`

## Code Path

The relevant fallback set includes OpenAI as a tokenless active-user-fence
provider:

- `apps/cloudflare/src/runner-egress-intercept.ts:344`

Tokenless OpenAI egress calls:

- `authorizeHostedProviderEgressActiveUserFence`
  in `apps/cloudflare/src/runner-egress-intercept.ts:3324`
- which first calls `readHostedProviderEgressActiveUserFromCurrentContainer`
  in `apps/cloudflare/src/runner-egress-intercept.ts:3423`

Before the hotfix, active-user recovery required:

1. Read `ctx.containerId`.
2. Treat it as a Durable Object id via `RUNNER_CONTAINER.idFromString`.
3. Call the resolved container stub's `readActiveRuntimeUserFence`.
4. Use that active user id to call `USER_RUNNER.validateActiveRuntimeWriteFence`.

`RunnerContainer.readActiveRuntimeUserFence` returns active state from
`workspaceInvocationActiveOperation`:

- `apps/cloudflare/src/runner-container.ts:402`

`invokeHostedExecution` sets that active operation before invoking the container:

- `apps/cloudflare/src/runner-container.ts:1008`

The production error proves this current-container active-user path did not
recover a user id in the outbound handler.

## Hotfix And Why It Did Not Clear Production

Hotfix commit `332eeceb30` added a fallback:

- If current-container active-user lookup is missing, inactive, or throws,
  parse `ctx.containerId` as a versioned runner container name.
- Only accept names containing `--v-`.
- Use `readHostedRunnerContainerIdentity` to recover the user id.
- Still require `USER_RUNNER.validateActiveRuntimeWriteFence({ userId })`.

Relevant files:

- `apps/cloudflare/src/runner-egress-intercept.ts:3483`
- `apps/cloudflare/src/hosted-runner-container-identity.ts:18`

This deployed at `2026-06-25T01:48:26Z` as Worker version `a0990de0...`, but
Cloudflare still logged `missing_identity / active_user_context_missing` on that
same version. Therefore the production outbound `ctx.containerId` seen by the
Worker is probably neither:

- a Durable Object id that round-trips through `idFromString` to the active
  container object, nor
- the versioned runner container name shape expected by the fallback.

This is currently the strongest evidence that the hotfix assumption was wrong
for production's Cloudflare Containers outbound context.

## Likely Trigger Versus Root Cause

The underlying brittle boundary existed before the outage: tokenless Codex
OpenAI calls depended on recovering an active user from the current container
context.

Likely trigger/exposure:

- `9daa097881` (`perf: parallelize hosted runtime startup (#286)`) changed
  hosted runtime startup so Codex runtime preparation could overlap initial
  mailbox import.
- The first user-visible failures started roughly minutes after that commit was
  in the recent history.
- This likely changed timing enough that warm Codex compaction/OpenAI calls
  exercised the tokenless egress path earlier or more reliably.

Amplifier:

- `f58d28e6b8` lowered hosted Codex auto-compact limit from `128k` to `84k`.
- The first lower-level diagnostics were `/v1/responses/compact`.
- This likely increased how often the failing egress path was exercised.

Not the first cause by timing:

- `c0c56db02d` (`feat(hosted): hosted action-approval primitive`) landed after
  the first observed failures and is unlikely to explain the initial onset.

Best current root-cause hypothesis:

The Cloudflare Containers outbound `ctx.containerId` is an opaque container
runtime identifier, not the Durable Object id and not the named container handle
Murph expected. Because tokenless Codex/OpenAI calls cannot attach runtime
write-fence headers or provider-egress tokens, the Worker had no valid identity
proof and correctly failed closed.

## Residual Security Concern Found During Review

The hotfix fallback, while deployed briefly, validated only `userId` against the
active `UserRunner` write fence:

- `apps/cloudflare/src/runner-egress-intercept.ts:3389`
- `apps/cloudflare/src/user-runner/runner-state-store.ts:433`

The active write-fence record stores `runnerContainerName`:

- `apps/cloudflare/src/user-runner/runner-state-store.ts:178`

But `validateActiveWriteFence` does not compare the caller's container name,
attempt id, or lease generation against the active record. If the fallback were
kept, a stale same-user container could potentially borrow a newer active
same-user write fence for tokenless read-only provider egress, assuming that
stale container can still initiate outbound traffic.

No obvious cross-user authorization path was found: bound-user mismatches fail
before validation, and the parsed identity routes to that user's `USER_RUNNER`.
The residual risk is same-user stale authority, not direct wrong-user injection.

## Test Coverage Gaps

Current tests added by the hotfix cover normal OpenAI tokenless egress with a
versioned container-name fallback, missing write fence, and wrong bound user.

Missing or insufficient coverage:

- Tokenless `/v1/responses/compact` with active current-container proof.
- Tokenless `/v1/responses/compact` with missing active runtime, missing runner
  state, missing write fence, and validator errors.
- Exact proof that opaque `ctx.containerId` values fail closed and never fall
  back to bound-user headers or deploy-smoke.
- Cross-boundary test from `createCloudflareHostedProviderFetch` through
  `hostedRunnerIntercept`, both with and without provider-egress token.
- Stale same-user container test: old same-user container/app-server while
  `UserRunner` has a newer active same-user fence.
- Real Codex `env_http_headers` feasibility. Existing config tests assert
  OpenAI auth through `env_key=OPENAI_API_KEY` and no custom header path.

Suggested focused commands:

```bash
pnpm --dir apps/cloudflare test runner-egress-intercept.test.ts -t "active-user-fence|auto-compaction|deploy-smoke|versioned container identity"
pnpm --dir apps/cloudflare test hosted-runner-container-identity.test.ts runner-state-store.bundle-slots.test.ts -t "container identity|active write fences"
pnpm --dir apps/cloudflare test runner-platform.test.ts -t "providerFetch|provider fetch"
```

Useful gated protocol checks, but not sufficient alone for Worker egress:

```bash
MURPH_RUN_HOSTED_CODEX_AUTH_E2E=1 pnpm --dir packages/assistant-runtime test hosted-runtime-codex-config.test.ts -t "hosted Codex runtime authenticates"
MURPH_RUN_HOSTED_CODEX_AUTOCOMPACTION_E2E=1 pnpm --dir packages/assistant-runtime test hosted-runtime-codex-config.test.ts -t "auto-compacts"
pnpm hosted-local e2e codex-long-thread --profile e2e:live
```

## Immediate Mitigation

Rollback `9daa097881` first as the fastest production mitigation, because it is
the likely exposure commit. The operator has already created rollback commits
locally/remotely in `main`.

Do not treat the hotfix as proven effective. Production logs showed the same
`missing_identity` failures after the hotfix deploy reached 100%.

## Recommended Durable Fix Direction

Choose one durable authority path for tokenless Codex OpenAI egress:

1. Preferred if supported by Cloudflare/Codex: make Codex attach a narrow
   provider-egress token or runtime-bound header to both `/v1/responses` and
   `/v1/responses/compact`, and validate that token in the existing Worker
   egress path.
2. If tokenless active-user-fence remains necessary, pass an exact container
   name or active operation identity through a platform-supported channel whose
   semantics are documented and tested. Do not infer it from outbound
   `ctx.containerId` unless Cloudflare documents that it is the named Durable
   Object/container handle.
3. If container-name fallback is retained, require the active write fence's
   `runnerContainerName`, attempt id, or lease generation to match the caller
   proof before authorizing.

Also add a metadata-only diagnostic for the outbound context that records
classification booleans, not raw identifiers:

- `containerIdPresent`
- `containerIdLooksVersionedName`
- `containerIdAcceptedByIdFromString`
- `currentContainerRpcPresent`
- `activeContainerIdentitySource`

Avoid logging raw container ids, user ids, URLs, prompts, request bodies, or
provider payloads.

## Post-Mitigation Verification

After rollback deploy, watch Cloudflare Workers Observability for:

- `$metadata.service=murph-hosted`
- `$metadata.message=Hosted runner provider egress completed.`
- `details.providerKind=openai`

Success signals:

- `details.responseStatus=401` with
  `details.writeFenceValidationMode=missing_identity` stops.
- Either OpenAI egress returns `200`, or no OpenAI egress failures appear while
  assistant replies complete.
- `ASSISTANT_CODEX_FAILED` rows with `401 Unauthorized` stop for the affected
  member.

Also verify delivery:

- fresh Telegram message receives an assistant reply;
- if Linq was affected by the same no-generation path, fresh Linq message
  receives an assistant reply;
- no new `checkpoint.snapshot_failed` or stale write-fence cleanup errors are
  introduced by the rollback.

## Open Questions

- What exact semantics does Cloudflare assign to outbound `ctx.containerId`?
  The docs show it is available in outbound handlers, but this incident suggests
  it cannot be used as either `RUNNER_CONTAINER.idFromString(ctx.containerId)` or
  Murph's versioned named-container handle.
- Did startup parallelization expose a pre-existing issue by letting Codex
  compaction run before the active container RPC path was ready, or did it leave
  a stale warm Codex process making OpenAI calls outside the expected active
  invocation window?
- Can real Codex App Server attach custom `env_http_headers` consistently for
  both `/v1/responses` and `/v1/responses/compact`?
- Should tokenless active-user-fence egress be deleted entirely in favor of
  provider-egress tokens, even for OpenAI, to avoid hidden process/context
  coupling?

