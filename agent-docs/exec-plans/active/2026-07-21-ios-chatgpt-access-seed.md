# iOS ChatGPT access-token runtime handoff

Status: active
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Let an authenticated Murph iOS companion connect a user-owned ChatGPT/Codex
  subscription to that same member's hosted runtime without sending a refresh
  credential off the phone. The backend accepts only a time-limited access
  credential plus routing metadata and a shorter bounded server lease, encrypts
  it before persistence, and applies it to the Codex app-server in process
  memory.
- Keep the feature internal and disabled for production release until OpenAI
  provides or approves a third-party native client, callback, scopes, and token
  handoff contract.

## Success criteria

- A strict authenticated companion API supports connect/status/disconnect and
  rejects refresh tokens, ID tokens, unknown fields, oversized bodies, malformed
  metadata, and credentials that are already expired or too close to expiry.
- Persisted access authority is ciphertext on first write, bound to the member
  and owning field with authenticated encryption, has an explicit expiry, and is
  never returned by status APIs, logs, mailbox payloads, Temporal inputs, or
  workspace snapshots.
- Each accepted update receives a fresh opaque connection fence. The latest
  committed fence wins across retries and races; exact server-lease expiry
  projects token-free `off` with the expired generation preserved for
  phone-owned renewal, while DELETE advances the generation and invalid state
  or runtime rejection surface as `needs_attention` without extending authority.
  A successful companion mutation acknowledges only its own exact fence;
  same-fence terminal completion is idempotent, while a newer upload or DELETE
  produces a retryable conflict instead of returning the newer credential state.
- A cold or restarted hosted runtime reads the current valid generation through
  an authenticated, write-fenced internal path and applies it through the Codex
  app-server's in-memory token-login surface. A token-free result callback
  rechecks the exact generation, current member policy, usable lease lifetime,
  and authenticated ciphertext before thread start; same-version reads also
  authenticate ciphertext before returning `unchanged`. That callback is the
  turn-authorization linearization point. The flow does not write `auth.json`.
- Disconnect and Murph-account deletion clear the server-side seed. The deleted
  generation cannot authorize a subsequent turn; a disconnect does not preempt
  a turn already authorized and in flight. The companion can still reduce
  authority after its normal hosted access/consent state is lost, provided its
  Murph identity remains valid.
- The legacy web device-code producer cannot overwrite or revive the new state.
- Focused unit/integration tests, direct synthetic runtime proof, repository
  acceptance verification, coverage-write review, ReviewGPT, and CI all pass on
  the exact pushed head.

## Scope

- In scope:
  - Companion bearer-authenticated connect, status, and disconnect endpoints.
  - The existing hosted Codex-auth connection as the one persisted state owner,
    with additive encrypted seed and expiry metadata; its existing attempt ID
    is reused as the connection-generation fence.
  - Narrow shared contracts and signed Web/Cloudflare/runtime transport needed
    to fetch a seed on demand without placing it in durable orchestration data.
  - Memory-only external-token login/logout in the hosted Codex app-server
    lifecycle, including cold-start and generation-change behavior.
  - Account-deletion cleanup, legacy device-code producer removal/disablement,
    focused security and race tests, durable architecture/security docs, and a
    feature/release gate.
- Out of scope:
  - OpenAI client registration, provider approval, or production enablement.
  - The iOS OAuth/Keychain UI implementation, which lives in the companion repo.
  - Storing or refreshing a refresh token on Murph servers.
  - Claiming the OpenAI bearer is Murph-scoped; sending only the access token
    limits lifetime, not capability.
  - A provider revocation call unless OpenAI documents an applicable endpoint.

## Constraints

- Technical constraints:
  - Reuse the current hosted Codex-auth connection owner and hosted private-field
    encryption; do not add another database/service state owner.
  - The public companion DTO contains only access token, ChatGPT account ID,
    and expiry. Refresh tokens, ID tokens, plan hints, and unknown fields are
    never valid input.
  - Authenticate member ownership with the existing Privy bearer helpers. Keep
    POST status-changing authority behind active hosted access/consent; allow
    identity-only DELETE because it reduces authority.
  - Keep secrets out of mailbox events, Temporal state, runner environment,
    error details, analytics, snapshots, and logs. Internal reads are exact-member,
    signed, freshness-bounded, and write-fenced.
  - Hosted runtime state is derived from the database connection fence and
    expiry. Process-local fence caching is an optimization, never an authority.
  - Preserve additive deploy compatibility and fail closed when a consumer does
    not understand the seed contract.
- Product/process constraints:
  - Label the feature internal/experimental and do not imply OpenAI endorsement.
  - Use "Connect OpenAI account" rather than making it Murph primary login.
  - The consent copy must say the refresh credential remains in the phone's
    non-syncing device-only Keychain and that a time-limited access credential,
    account ID, and bounded server lease are sent to the member's Murph cloud
    runtime.
  - Follow the auth/security, reliability, completion, verification, ReviewGPT,
    and deployment-skew gates routed by repository policy.

## Risks and mitigations

1. Risk: The Codex app-server token-login method is explicitly unstable and for
   OpenAI internal use.
   Mitigation: keep the producer disabled outside an explicit internal gate,
   document the unsupported dependency, and require an approved provider
   contract before release.
2. Risk: A leaked bearer can exercise the user's ChatGPT/Codex authority until
   it expires.
   Mitigation: strict small DTO, a two-hour maximum server lease, authenticated
   encryption with member/field AAD, no token-bearing responses/logs/durable
   transports, and immediate server-side deletion plus next-turn generation
   fencing.
3. Risk: concurrent phone refreshes, retries, or delayed runtime messages apply
   stale authority.
   Mitigation: serialize writes under the existing member lock, replace the
   opaque attempt fence on every mutation, fetch current truth by pointer, and
   apply only the latest committed fence.
4. Risk: Web, Cloudflare, runtime, and iOS deploy out of order.
   Mitigation: deploy additive Web storage and the signed read first, keep
   production ingestion gated, deploy Cloudflare/runtime second, and roll back
   producers before consumers.
5. Risk: the phone is unavailable when the server lease or provider bearer expires.
   Mitigation: do not move refresh authority server-side; expire runtime
   authority, project the exact lease-expiry case as `off`, and let the phone
   reseed or refresh/upload on foreground.

## Tasks

1. Trace and document the existing state owner, encryption, auth, deletion,
   runtime transport, and Codex app-server login boundaries.
2. Add strict shared contracts, additive encrypted storage, opaque generation fencing,
   and authenticated companion connect/status/disconnect endpoints.
3. Add the narrow internal current-seed read and runtime consumer, then apply
   valid generations to app-server memory on cold start/update and logout on
   disconnect.
4. Disable the legacy web device-code producer and preserve only the temporary
   read compatibility required for deploy skew.
5. Add adversarial validation, expiry/race/deletion/restart tests and a synthetic
   end-to-end proof without real credentials.
6. Update durable docs, run scoped and repository-wide verification, complete
   coverage-write and ReviewGPT, commit/push the exact head, and open the backend
   PR with rollout/rollback guidance.

## Decisions

- `HostedCodexAuthConnection` remains the single persisted owner. The access seed
  is an expiring operational credential cache, not new user-facing product truth.
- Store that cache as one secure-box ciphertext on the existing Web-owned row.
  A separate Durable Object/R2 credential service would duplicate authority and
  is not justified for this default-off proof.
- The phone remains the only refresh-token owner. The server never accepts an ID
  token or refresh token, and it cannot renew access on its own.
- The runtime applies external ChatGPT auth through app-server memory rather than
  generating a Codex `auth.json` file.
- Token upload uses the existing runtime-recheck signal and does not add an
  auth-specific mailbox payload. The runtime resolves current secret truth just
  in time from Web through an authenticated internal callback.
- No provider-side revocation is promised until a supported OpenAI revocation
  contract exists; disconnect still deletes local/server authority and logs the
  runtime out.
- Deployment order is Web storage/read support with ingestion still disabled,
  then the tolerant runtime/Cloudflare consumer, then the gated iOS producer.
  Rollback disables and clears the producer state before removing consumers.

## Verification

- Evidence recorded before the final `main` merge:
  - focused Web store/route/migration, Cloudflare transport, hosted-execution,
    assistant-runtime, and assistant-engine suites passed, including adversarial
    validation, one-sided encrypted-pair fail-closed behavior, expiry renewal,
    disconnect races, warm/cold runtime authorization, and account deletion;
  - direct synthetic Codex App Server login passed with
    `chatgptAuthTokens`, `auth.json` absent, and no real credential;
  - Prisma generate/validate, package typechecks, scenario integrity, docs and
    privacy checks passed during implementation;
  - the required coverage-write audit found no uncovered acceptance path and
    made no edits;
  - a canonical `test:diff` rerun exposed two unrelated harness conditions: a
    load-only runtime checkpoint timeout that passed focused and whole-file
    reruns, and a prepared-build omission of `assistant-runtime/dist`; building
    that package explicitly made all 406 hosted-local-harness cases pass;
  - the subsequent lower-concurrency run passed every package suite and found a
    genuine expand-migration violation in Web verification. Removing the
    optional `CHECK` constraint left the two nullable columns expand-only;
    focused migration, production guard, and store tests then passed 58/58.
- Commands to run:
  - Focused Vitest suites for each changed owner during implementation.
  - `pnpm test:diff` while iterating on cross-package behavior.
  - `pnpm test:scenario-integrity` after scenario coverage changes.
  - `pnpm verify:acceptance` on the completed backend patch.
  - Direct synthetic hosted-runtime proof using a non-secret fake credential and
    assertions that no token reaches logs, persisted workspace state, or API
    responses.
  - Required coverage-write audit, exact-head ReviewGPT loop, and GitHub CI.
- Expected outcomes:
  - All commands pass; every negative contract case fails closed with a
    secret-safe response; connect/update/disconnect/cold-start proofs show the
    current generation only; no credential-like value appears in the diff or
    generated artifacts.
